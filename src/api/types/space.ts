export type SpaceSort =
  | 'recently-updated'
  | 'recently-created'
  | 'alphabetical-az'
  | 'alphabetical-za';

export type ListOptions = {
  search?: string;
  sort: SpaceSort;
  page: number;
  limit: number;
  archived?: boolean;
};

export type UpdateSpaceInput = {
  name?: string;
  researchObjective?: string;
  isArchived?: boolean;
};
