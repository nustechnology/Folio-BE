import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { CreateNoteInput, ListNotesOptions } from '~/api/types/note';
import { NOTE } from '~/api/utils/constants';
import {
  sanitizeRichText,
  toPlainText,
  toPreview
} from '~/api/utils/rich-text.util';
import { OriginType } from '~/generated/prisma/client';
import NoteRepository, {
  NoteRecord
} from '~/prisma/repositories/note.repository';
import SpaceRepository from '~/prisma/repositories/space.repository';

/**
 * `contentText` is a search projection, not part of the API contract — it would
 * duplicate `content` on the wire for no benefit.
 */
const shared = ({
  _count,
  content: _content,
  contentText: _contentText,
  ...note
}: NoteRecord) => ({
  ...note,
  citationCount: _count.citationReferences
});

/** List items carry an excerpt so a page of notes stays small over the wire. */
const toSummary = (note: NoteRecord) => ({
  ...shared(note),
  contentPreview: toPreview(note.content)
});

const toDetail = (note: NoteRecord) => ({
  ...shared(note),
  content: note.content
});

/**
 * A space the user does not own is reported as missing rather than forbidden,
 * so the API does not disclose which space ids exist.
 */
const assertSpaceAccess = async (spaceId: string, ownerId: string) => {
  const space = await SpaceRepository.findByIdAndOwner(spaceId, ownerId);
  if (!space) {
    throw new AppError(
      'Research space not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.SPACE_NOT_FOUND
    );
  }
  return space;
};

const list = async (
  ownerId: string,
  spaceId: string,
  options: ListNotesOptions
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const { notes, totalCount } = await NoteRepository.findManyBySpace(
    spaceId,
    options
  );

  return {
    notes: notes.map(toSummary),
    pagination: {
      page: options.page,
      limit: options.limit,
      totalCount,
      totalPages: Math.ceil(totalCount / options.limit)
    }
  };
};

const getById = async (ownerId: string, spaceId: string, noteId: string) => {
  await assertSpaceAccess(spaceId, ownerId);

  const note = await NoteRepository.findByIdInSpace(noteId, spaceId);
  if (!note) {
    throw new AppError(
      'Note not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.NOTE_NOT_FOUND
    );
  }

  return toDetail(note);
};

const create = async (
  ownerId: string,
  spaceId: string,
  input: CreateNoteInput
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const content = sanitizeRichText(input.content);
  const plainText = toPlainText(content);

  if (plainText.length < NOTE.CONTENT_MIN_LENGTH) {
    throw new AppError(
      'Content cannot be empty',
      StatusCodes.BAD_REQUEST,
      ErrorCode.NOTE_CONTENT_EMPTY
    );
  }

  if (plainText.length > NOTE.CONTENT_MAX_LENGTH) {
    throw new AppError(
      `Content exceeds maximum length of ${NOTE.CONTENT_MAX_LENGTH.toLocaleString('en-US')} characters`,
      StatusCodes.BAD_REQUEST,
      ErrorCode.NOTE_CONTENT_TOO_LONG
    );
  }

  const note = await NoteRepository.create({
    researchSpaceId: spaceId,
    title: input.title?.trim() || NOTE.DEFAULT_TITLE,
    content,
    contentText: plainText,
    originType: OriginType.UserCreated
  });

  return toDetail(note);
};

export default {
  list,
  getById,
  create
};
