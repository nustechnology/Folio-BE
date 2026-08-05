import { OriginType } from '~/generated/prisma/client';

export type NoteSort =
  | 'recently-updated'
  | 'recently-created'
  | 'alphabetical-az'
  | 'alphabetical-za';

/**
 * `all` is the absence of a filter, not a stored `OriginType` value — hence the
 * union rather than a widened enum. Derived from `OriginType` so a new origin
 * cannot become silently unfilterable: copying the members by hand would still
 * compile after the enum grows.
 */
export type NoteOriginFilter = 'all' | OriginType;

export type ListNotesOptions = {
  search?: string;
  sort: NoteSort;
  origin: NoteOriginFilter;
  page: number;
  limit: number;
};

export type CreateNoteInput = {
  title?: string;
  content: string;
};

/**
 * Both fields optional, but the validator requires at least one. `originType`
 * and the origin ids are deliberately absent: a note's provenance is a
 * historical fact, and a writable `originType` would let a saved answer
 * present itself as user-created.
 */
export type UpdateNoteInput = {
  title?: string;
  content?: string;
};
