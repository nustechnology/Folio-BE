import { AnswerCitation } from '~/api/types/ask';
import { OriginType } from '~/generated/prisma/client';

/**
 * A citation as a saved note carries it. Same shape the chat uses, except
 * `passageId` may be absent: rows written before the column existed have none,
 * and the reader deep-link is what depends on it — not the evidence text.
 */
export type SavedCitation = Omit<AnswerCitation, 'passageId'> & {
  passageId: string | null;
};

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

/**
 * Present when the note is being saved from a chat answer. The API resolves the
 * message itself rather than trusting the client for its text or citations.
 */
export type NoteOrigin = {
  conversationId: string;
  messageId: string;
};

export type CreateNoteInput = {
  title?: string;
  content: string;
  origin?: NoteOrigin;
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

/**
 * Converting a note takes nothing from the note but a title override: the
 * snapshot content is read from the stored note, never from the request, so a
 * client cannot pass off arbitrary text as "the note that was converted".
 */
export type ConvertNoteInput = {
  title?: string;
};
