import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { StoredMessage } from '~/api/types/ask';
import {
  CreateNoteInput,
  ListNotesOptions,
  NoteOrigin
} from '~/api/types/note';
import { NOTE } from '~/api/utils/constants';
import {
  sanitizeRichText,
  toPlainText,
  toPreview
} from '~/api/utils/rich-text.util';
import { OriginType } from '~/generated/prisma/client';
import ConversationRepository from '~/prisma/repositories/conversation.repository';
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

/**
 * Resolves the answer a note is being saved from. The message is looked up
 * server-side so its citations come from what was actually generated, and a
 * message that has already been saved is rejected rather than duplicated.
 */
const resolveOrigin = async (
  spaceId: string,
  origin: NoteOrigin
): Promise<StoredMessage> => {
  const messages = await ConversationRepository.getMessages(
    origin.conversationId,
    spaceId
  );
  if (!messages) {
    throw new AppError(
      'Conversation not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.CONVERSATION_NOT_FOUND
    );
  }

  const message = messages.find(
    (item) => item.id === origin.messageId && item.role === 'assistant'
  );
  if (!message) {
    throw new AppError(
      'Answer not found in this conversation.',
      StatusCodes.NOT_FOUND,
      ErrorCode.MESSAGE_NOT_FOUND
    );
  }

  if (message.savedNoteId) {
    throw new AppError(
      'This answer has already been saved as a note.',
      StatusCodes.CONFLICT,
      ErrorCode.MESSAGE_ALREADY_SAVED
    );
  }

  return message;
};

const create = async (
  ownerId: string,
  spaceId: string,
  input: CreateNoteInput
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const originMessage = input.origin
    ? await resolveOrigin(spaceId, input.origin)
    : null;

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
    originType: originMessage
      ? OriginType.SavedAssistantAnswer
      : OriginType.UserCreated,
    originConversationId: input.origin?.conversationId,
    originMessageId: input.origin?.messageId,
    citationIds: originMessage?.citations?.map((citation) => citation.id)
  });

  // Marks the answer as saved so the chat can disable its "Save as note"
  // button — including after a reload, when client state is gone.
  if (input.origin && originMessage) {
    await ConversationRepository.updateMessage(
      input.origin.conversationId,
      input.origin.messageId,
      { savedNoteId: note.id }
    );
  }

  return toDetail(note);
};

export default {
  list,
  getById,
  create
};
