import prisma from '~/prisma/prisma.client';

export type NewCitation = {
  sourceId: string;
  supportingPassage: string;
  passageId: string;
  pageReference?: string | null;
  sectionReference?: string | null;
  passageLocator?: string | null;
};

/**
 * Persists the evidence behind one answer. Rows are written when the answer is
 * generated (not when it is saved) so a note can link straight to them, and so
 * the cited text survives a later re-ingestion of the source.
 */
const createMany = async (citations: NewCitation[]) => {
  return prisma.$transaction(
    citations.map((citation) => prisma.citation.create({ data: citation }))
  );
};

const findManyByIds = async (ids: string[]) => {
  if (ids.length === 0) {
    return [];
  }
  return prisma.citation.findMany({ where: { id: { in: ids } } });
};

export default { createMany, findManyByIds };
