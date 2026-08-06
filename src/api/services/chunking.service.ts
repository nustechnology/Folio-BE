import { env } from '~/config/enviroment';
import ModelGateway from '~/api/services/model-gateway.service';
import { Block } from '~/api/services/normalization.service';
import { estimateTokens, semanticDistance } from '~/api/utils/embedding.util';
import PassageRepository from '~/prisma/repositories/passage.repository';

// Semantic chunking pipeline (see folio-technical-proposal.md, section A).
//
// A "unit" is a small text piece produced by pre-splitting a normalized block.
// Adjacent units within the same section are embedded, their cosine distances
// measured, and topic breakpoints chosen where distance spikes. Units between
// breakpoints are merged into passages, which then get their own embeddings
// and are stored in pgvector.
type Unit = {
  text: string;
  blockIndex: number;
  order: number;
  headingPath: string[];
};

type AssembledPassage = {
  content: string;
  locator: {
    blockRange: [number, number];
    headingPath: string[];
    firstOrder: number;
    lastOrder: number;
  };
};

// Stage 2 — pre-split each normalized block into units using a recursive
// character splitter sized by CHUNK_PRE_SPLIT_TOKENS. @langchain/textsplitters
// is ESM-only, hence the dynamic import. We never merge across blocks, so
// heading boundaries are preserved.
const splitBlock = async (block: Block): Promise<string[]> => {
  const { RecursiveCharacterTextSplitter } =
    await import('@langchain/textsplitters');
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: Number(env.CHUNK_PRE_SPLIT_TOKENS),
    chunkOverlap: 0,
    lengthFunction: estimateTokens
  });
  return splitter.splitText(block.text);
};

// Helper: embed a list of texts in batches of CHUNK_EMBED_BATCH_SIZE to avoid
// sending one enormous request to the model provider.
const embedBatches = async (texts: string[]): Promise<number[][]> => {
  const batchSize = Number(env.CHUNK_EMBED_BATCH_SIZE);
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(
      `CHUNK_EMBED_BATCH_SIZE must be a positive integer, received: ${String(
        env.CHUNK_EMBED_BATCH_SIZE
      )}`
    );
  }
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await ModelGateway.embedTexts(batch);
    results.push(...embeddings);
  }
  return results;
};

// Percentile helper used to derive the semantic breakpoint threshold from the
// distribution of adjacent-unit distances (CHUNK_BREAKPOINT_PERCENTILE).
const percentile = (values: number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx];
};

// Two units belong to the same "section" when they share the same heading path.
const sectionKey = (unit: Unit): string => unit.headingPath.join('>');

// Stages 5-6 — compute the semantic distance (1 − cosine similarity) between
// adjacent units and decide where to break. A breakpoint is placed between
// units i and i+1 when:
//   - their headings differ (section change), or
//   - the distance exceeds the configured percentile threshold (a topic jump).
const computeBreakpoints = (
  units: Unit[],
  embeddings: number[][]
): Set<number> => {
  const breakpoints = new Set<number>();
  const distances: number[] = [];

  for (let i = 0; i < units.length - 1; i++) {
    if (sectionKey(units[i]) === sectionKey(units[i + 1])) {
      distances.push(semanticDistance(embeddings[i], embeddings[i + 1]));
    }
  }

  const threshold = percentile(
    distances,
    Number(env.CHUNK_BREAKPOINT_PERCENTILE)
  );

  for (let i = 0; i < units.length - 1; i++) {
    const sectionChange = sectionKey(units[i]) !== sectionKey(units[i + 1]);
    const distance = semanticDistance(embeddings[i], embeddings[i + 1]);
    if (sectionChange || distance > threshold) {
      breakpoints.add(i);
    }
  }
  return breakpoints;
};

// Stage 8 — merge a group of units into a passage and project citation
// metadata (source block range, heading path, and unit ordering) so passages
// remain resolvable to the original document.
const buildPassage = (group: Unit[]): AssembledPassage => {
  return {
    content: group.map((unit) => unit.text).join(' '),
    locator: {
      blockRange: [group[0].blockIndex, group[group.length - 1].blockIndex],
      headingPath: group[0].headingPath,
      firstOrder: group[0].order,
      lastOrder: group[group.length - 1].order
    }
  };
};

// Stage 7 — cut units into passages at breakpoints, and also force a boundary
// once the running passage reaches CHUNK_TARGET_TOKENS so passages stay within
// the embedding model's input limit.
const assemblePassages = (
  units: Unit[],
  breakpoints: Set<number>
): AssembledPassage[] => {
  const passages: AssembledPassage[] = [];
  const targetTokens = Number(env.CHUNK_TARGET_TOKENS);
  let start = 0;

  for (let i = 0; i < units.length; i++) {
    if (breakpoints.has(i)) {
      passages.push(buildPassage(units.slice(start, i + 1)));
      start = i + 1;
    } else if (
      estimateTokens(
        units
          .slice(start, i + 1)
          .map((u) => u.text)
          .join(' ')
      ) >= targetTokens
    ) {
      passages.push(buildPassage(units.slice(start, i + 1)));
      start = i + 1;
    }
  }

  if (start < units.length) {
    passages.push(buildPassage(units.slice(start)));
  }
  return passages;
};

// Entry point for the pipeline. Performs TWO embedding passes:
//   Pass 1 — embed pre-split units to find semantic breakpoints (job-scoped,
//            never stored).
//   Pass 2 — embed the final assembled passages and persist them in pgvector.
// The source is only activated (→ ready) after this completes successfully.
export const chunkAndEmbed = async (
  blocks: Block[],
  sourceId: string
): Promise<void> => {
  if (blocks.length === 0) {
    // No blocks → no passages; clear any stale rows from a previous run.
    await PassageRepository.replaceBySourceId(sourceId, []);
    return;
  }

  // Stage 1-2 — pre-split every block into units, tracking block index,
  // heading path, and a global order for locator metadata.
  const units: Unit[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const pieces = await splitBlock(block);
    for (const text of pieces) {
      units.push({
        text,
        blockIndex: i,
        order: units.length,
        headingPath: block.headingPath
      });
    }
  }

  if (units.length === 0) {
    await PassageRepository.replaceBySourceId(sourceId, []);
    return;
  }

  // Stage 4-6 — embed units (pass 1) and compute breakpoints.
  const unitEmbeddings = await embedBatches(units.map((u) => u.text));
  const breakpoints = computeBreakpoints(units, unitEmbeddings);

  // Stage 7-8 — assemble passages with locator metadata.
  const passages = assemblePassages(units, breakpoints);

  // Stage 9 — embed the assembled passages (pass 2).
  const passageEmbeddings = await embedBatches(passages.map((p) => p.content));

  // Replace the source's passages transactionally: rows from a previous run are
  // deleted before inserting, so re-ingesting (retry) never leaves stale or
  // duplicated passages. This runs even for zero passages, which clears the
  // source entirely.
  await PassageRepository.replaceBySourceId(
    sourceId,
    passages.map((p, i) => ({
      sourceId,
      content: p.content,
      embedding: passageEmbeddings[i],
      tokenCount: estimateTokens(p.content),
      strategyVersion: env.CHUNK_STRATEGY_VERSION,
      locator: p.locator
    }))
  );
};

export default { chunkAndEmbed };
