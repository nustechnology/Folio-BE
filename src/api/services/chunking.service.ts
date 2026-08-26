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
export type Unit = {
  text: string;
  blockIndex: number;
  order: number;
  headingPath: string[];
};

export type AssembledPassage = {
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

// Stages 5-6 without embeddings: heading changes alone. A spreadsheet's rows
// are atomic and equidistant, so measuring distance between them decides
// nothing the token ceiling in `assemblePassages` would not decide for free.
export const structuralBreakpoints = (units: Unit[]): Set<number> => {
  const breakpoints = new Set<number>();
  for (let i = 0; i < units.length - 1; i++) {
    if (sectionKey(units[i]) !== sectionKey(units[i + 1])) {
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
// once the running passage reaches `targetTokens` so passages stay within the
// embedding model's input limit.
//
// `targetTokens` is a parameter rather than a read of `CHUNK_TARGET_TOKENS`
// inside the loop: it makes the boundary rule a pure function of its inputs,
// which is the only part of this pipeline testable without a database or a
// model provider. `chunkAndEmbed` supplies the configured value.
export const assemblePassages = (
  units: Unit[],
  breakpoints: Set<number>,
  targetTokens: number
): AssembledPassage[] => {
  const passages: AssembledPassage[] = [];
  let start = 0;

  // Each unit is counted once and accumulated. Re-joining the growing slice and
  // re-counting it every iteration was quadratic in the document length — cheap
  // while `estimateTokens` was a division on `text.length`, but it now scans
  // every character to price non-ASCII separately, and a large source blocks the
  // event loop for the duration.
  //
  // The running sum trades the join spaces for per-unit rounding, so it drifts
  // from the old per-slice estimate by a token or two in either direction
  // (measured −1..+2 over synthetic passages) — inside the estimator's own
  // error bar, and it no longer re-scans the whole prefix every iteration.
  const unitTokens = units.map((unit) => estimateTokens(unit.text));
  let running = 0;

  for (let i = 0; i < units.length; i++) {
    running += unitTokens[i];
    if (breakpoints.has(i) || running >= targetTokens) {
      passages.push(buildPassage(units.slice(start, i + 1)));
      start = i + 1;
      running = 0;
    }
  }

  if (start < units.length) {
    passages.push(buildPassage(units.slice(start)));
  }
  return passages;
};

// Entry point for the pipeline. Performs up to TWO embedding passes:
//   Pass 1 — embed pre-split units to find semantic breakpoints (job-scoped,
//            never stored). Skipped for the structured types below.
//   Pass 2 — embed the final assembled passages and persist them in pgvector.
// The source is only activated (→ ready) after this completes successfully.
//
// Callers forward whatever type the extractor recorded; which of those skip
// pass 1 is decided here.
export const chunkAndEmbed = async (
  blocks: Block[],
  sourceId: string,
  options: { structuredType?: string } = {}
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

  // Stage 4-6 — find breakpoints. Skipping pass 1 halves the model passes a
  // spreadsheet costs to ingest.
  const breakpoints =
    options.structuredType === 'sheets'
      ? structuralBreakpoints(units)
      : computeBreakpoints(units, await embedBatches(units.map((u) => u.text)));

  // Stage 7-8 — assemble passages with locator metadata.
  const passages = assemblePassages(
    units,
    breakpoints,
    Number(env.CHUNK_TARGET_TOKENS)
  );

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
