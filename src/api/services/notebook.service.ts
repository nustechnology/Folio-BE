import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { assertSpaceAccess } from '~/api/services/space-access';
import { NotebookView } from '~/api/types/notebook';
import { NOTEBOOK } from '~/api/utils/constants';
import { sanitizeNotebookHtml, toPlainText } from '~/api/utils/rich-text.util';
import NotebookRepository from '~/prisma/repositories/notebook.repository';

/**
 * `Notebook.content` is non-nullable with no default, so "never written"
 * cannot be expressed inside a row — the absence of the row is the empty
 * state. This is what a read returns for it, instead of creating one: a `GET`
 * that writes cannot be retried or prefetched safely, and it would stamp
 * `createdAt` on a notebook the user only ever looked at.
 */
const emptyNotebook = (researchSpaceId: string): NotebookView => ({
  id: null,
  researchSpaceId,
  content: '',
  createdAt: null,
  updatedAt: null
});

/**
 * Sanitize submitted markup, then measure the result. The limit runs against
 * the sanitized plain text, not the payload, so a client cannot pad its way
 * past it with tags that get stripped anyway.
 */
const prepareContent = (rawContent: string) => {
  const content = sanitizeNotebookHtml(rawContent);
  const plainText = toPlainText(content);

  if (plainText.length > NOTEBOOK.CONTENT_MAX_LENGTH) {
    throw new AppError(
      `Content exceeds maximum length of ${NOTEBOOK.CONTENT_MAX_LENGTH.toLocaleString('en-US')} characters`,
      StatusCodes.BAD_REQUEST,
      ErrorCode.NOTEBOOK_CONTENT_TOO_LONG
    );
  }

  /* A document holding only markup — the editor's seeded empty heading, say —
     is stored as empty, so opening a notebook never creates content. */
  return plainText.length === 0 ? '' : content;
};

const get = async (ownerId: string, spaceId: string) => {
  await assertSpaceAccess(spaceId, ownerId);

  const notebook = await NotebookRepository.findBySpace(spaceId);

  return notebook ?? emptyNotebook(spaceId);
};

const save = async (ownerId: string, spaceId: string, rawContent: string) => {
  await assertSpaceAccess(spaceId, ownerId);

  return NotebookRepository.upsert(spaceId, prepareContent(rawContent));
};

export default {
  get,
  save
};
