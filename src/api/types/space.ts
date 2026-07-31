export type SpaceSort =
  | 'recently-updated'
  | 'recently-created'
  | 'alphabetical-az'
  | 'alphabetical-za';

export type ListOptions = {
  search?: string;
  sort: SpaceSort;
};
