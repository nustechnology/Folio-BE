import { AnswerCitation } from '~/api/types/ask';
import ModelGateway from '~/api/services/model-gateway.service';
import { normalizeToBlocks } from '~/api/services/normalization.service';
import { env } from '~/config/enviroment';
import PassageRepository, {
  PassageLocator,
  RetrievedPassage
} from '~/prisma/repositories/passage.repository';
import SourceRepository from '~/prisma/repositories/source.repository';

// Turning a retrieved passage into a citation the reader can verify.
//
// The chunker records a `locator` with the block range the passage came from,
// but not a page: pages only exist as `[page N]` markers the PDF extractor
// leaves in the text. Re-running the same normalization the chunker used gives
// back the identical block list, so the marker in force at a passage's first
// block is the page it sits on.
const PAGE_MARKER = /\[page\s+(\d+)\]/gi;

const findPageForBlock = (blockTexts: string[], blockIndex: number) => {
  let page: string | null = null;
  for (let i = 0; i <= blockIndex && i < blockTexts.length; i++) {
    const matches = [...blockTexts[i].matchAll(PAGE_MARKER)];
    if (matches.length > 0) {
      page = matches[matches.length - 1][1];
    }
  }
  return page;
};

const toSectionReference = (locator: PassageLocator | null): string | null => {
  const path = locator?.headingPath?.filter(Boolean) ?? [];
  return path.length > 0 ? path.join(' › ') : null;
};

/** What the citation modal prints under the source title. */
const toLocationLabel = (
  page: string | null,
  section: string | null
): string | null => {
  if (page) {
    return `Page ${page}`;
  }
  return section;
};

export type EvidenceItem = {
  passage: RetrievedPassage;
  pageReference: string | null;
  sectionReference: string | null;
  locationLabel: string | null;
};

/**
 * Resolves page/section metadata for a batch of passages. Each source's text is
 * normalized once, no matter how many of its passages were retrieved.
 */
const locateEvidence = async (
  passages: RetrievedPassage[]
): Promise<EvidenceItem[]> => {
  const sourceIds = [...new Set(passages.map((p) => p.sourceId))];
  const sources = await SourceRepository.findManyByIds(sourceIds);

  const blocksBySource = new Map<string, string[]>(
    sources.map((source) => [
      source.id,
      normalizeToBlocks(source.content).map((block) => block.text)
    ])
  );

  return passages.map((passage) => {
    const blockTexts = blocksBySource.get(passage.sourceId) ?? [];
    const firstBlock = passage.locator?.blockRange?.[0];
    const pageReference =
      typeof firstBlock === 'number'
        ? findPageForBlock(blockTexts, firstBlock)
        : null;
    const sectionReference = toSectionReference(passage.locator);

    return {
      passage,
      pageReference,
      sectionReference,
      locationLabel: toLocationLabel(pageReference, sectionReference)
    };
  });
};

/**
 * The evidence a question is answered from: the question is embedded once and
 * run through hybrid retrieval, then each hit is annotated with where in its
 * document it lives.
 */
const retrieveEvidence = async (options: {
  researchSpaceId: string;
  sourceId?: string;
  question: string;
}): Promise<EvidenceItem[]> => {
  const [embedding] = await ModelGateway.embedTexts([options.question]);
  if (!embedding) {
    return [];
  }

  const passages = await PassageRepository.searchHybrid({
    researchSpaceId: options.researchSpaceId,
    sourceId: options.sourceId,
    embedding,
    query: options.question,
    candidates: Number(env.ASK_RETRIEVAL_CANDIDATES),
    limit: Number(env.ASK_RETRIEVAL_TOP_K)
  });

  return locateEvidence(passages);
};

/** Projects evidence into the citation shape, once the answer has cited it. */
const toCitation = (
  item: EvidenceItem,
  citationId: string
): AnswerCitation => ({
  id: citationId,
  sourceId: item.passage.sourceId,
  sourceTitle: item.passage.sourceTitle,
  sourceType: item.passage.sourceType,
  sourceAuthor: item.passage.sourceAuthor,
  sourceFileType: item.passage.sourceFileType,
  passageId: item.passage.id,
  snippet: item.passage.content,
  locationLabel: item.locationLabel,
  pageReference: item.pageReference,
  sectionReference: item.sectionReference
});

export default { retrieveEvidence, locateEvidence, toCitation, toLocationLabel };
