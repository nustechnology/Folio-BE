/**
 * The whole document, every time. Auto-save sends the full editor content, so
 * a save is a replacement rather than a patch — which is what makes repeating
 * one idempotent when a debounce and an exit flush both fire.
 */
export type SaveNotebookInput = {
  content: string;
};

/**
 * A notebook as the API reports it. `id` and the timestamps are nullable
 * because a space whose notebook has never been saved has no row — that
 * absence is the empty state, and a read must not create one to fill it.
 */
export type NotebookView = {
  id: string | null;
  researchSpaceId: string;
  content: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};
