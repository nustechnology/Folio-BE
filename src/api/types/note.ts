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

export type CreateNoteInput = {
  title?: string;
  content: string;
};
