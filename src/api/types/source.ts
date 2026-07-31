import type { ProcessingState, SourceType } from '~/generated/prisma/enums';

export type SourceSort =
  'recently-added' | 'alphabetical-az' | 'alphabetical-za';

export type ListSourceOptions = {
  sourceType?: SourceType;
  processingState?: ProcessingState;
  search?: string;
  sort: SourceSort;
};
