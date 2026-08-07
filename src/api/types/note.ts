export type NoteSort =
  | 'recently-updated'
  | 'recently-created'
  | 'alphabetical-az'
  | 'alphabetical-za';

export type ListNotesOptions = {
  search?: string;
  sort: NoteSort;
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
