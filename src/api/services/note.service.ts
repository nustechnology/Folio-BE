import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { StoredMessage } from '~/api/types/ask';
import RetrievalService from '~/api/services/retrieval.service';
import SourceService from '~/api/services/source.service';
import {
  ConvertNoteInput,
  CreateNoteInput,
  ListNotesOptions,
  NoteOrigin,
  SavedCitation,
  UpdateNoteInput
} from '~/api/types/note';
import { NOTE } from '~/api/utils/constants';
import {
  sanitizeRichText,
  toPlainText,
  toPreview
} from '~/api/utils/rich-text.util';
import { assertSpaceAccess } from '~/api/services/space-access';
import { OriginType, Prisma } from '~/generated/prisma/client';
import ConversationRepository from '~/prisma/repositories/conversation.repository';
import NoteRepository, {
  NoteDetailRecord,
  NoteRecord
} from '~/prisma/repositories/note.repository';

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

/**
 * Rebuilds the citation the chat handed out from the row that was linked. The
 * `Citation` holds the passage and its position; everything about the document
 * it came from lives on the joined `Source`, so the two are recombined here
 * rather than denormalized at save time — a renamed source should still print
 * its current title in a note saved months ago.
 */
const toSavedCitation = ({
  citation
}: NoteDetailRecord['citationReferences'][number]): SavedCitation => ({
  id: citation.id,
  sourceId: citation.source.id,
  sourceTitle: citation.source.title,
  sourceType: citation.source.sourceType,
  sourceAuthor: citation.source.author,
  sourceFileType: citation.source.fileType,
  passageId: citation.passageId,
  snippet: citation.supportingPassage,
  locationLabel: RetrievalService.toLocationLabel(
    citation.pageReference,
    citation.sectionReference
  ),
  pageReference: citation.pageReference,
  sectionReference: citation.sectionReference
});

/**
 * A single note carries its evidence in cited order: the body keeps plain `[n]`
 * markers, and position *n* in this list is what they resolve against.
 */
const toDetail = ({ citationReferences, ...note }: NoteDetailRecord) => ({
  ...shared(note),
  content: note.content,
  citations: citationReferences.map(toSavedCitation)
});

/**
 * Sanitize submitted markup and measure the result. The length rules run
 * against the sanitized plain text, not the payload, so a client cannot pad
 * its way past them with tags that get stripped anyway.
 */
const prepareContent = (rawContent: string) => {
  const content = sanitizeRichText(rawContent);
  const contentText = toPlainText(content);

  if (contentText.length < NOTE.CONTENT_MIN_LENGTH) {
    throw new AppError(
      'Content cannot be empty',
      StatusCodes.BAD_REQUEST,
      ErrorCode.NOTE_CONTENT_EMPTY
    );
  }

  if (contentText.length > NOTE.CONTENT_MAX_LENGTH) {
    throw new AppError(
      `Content exceeds maximum length of ${NOTE.CONTENT_MAX_LENGTH.toLocaleString('en-US')} characters`,
      StatusCodes.BAD_REQUEST,
      ErrorCode.NOTE_CONTENT_TOO_LONG
    );
  }

  return { content, contentText };
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

const requireNoteInSpace = async (noteId: string, spaceId: string) => {
  const note = await NoteRepository.findByIdInSpace(noteId, spaceId);
  if (!note) {
    throw new AppError(
      'Note not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.NOTE_NOT_FOUND
    );
  }
  return note;
};

const getById = async (ownerId: string, spaceId: string, noteId: string) => {
  await assertSpaceAccess(spaceId, ownerId);

  return toDetail(await requireNoteInSpace(noteId, spaceId));
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

  const { content, contentText } = prepareContent(input.content);

  const note = await NoteRepository.create({
    researchSpaceId: spaceId,
    title: input.title?.trim() || NOTE.DEFAULT_TITLE,
    content,
    contentText,
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

/**
 * A note that vanished between being addressed and being written is reported as
 * missing, not as a server fault. Without this, two tabs deleting the same note
 * — or a double-click on Delete — answers `500` for the loser: `P2025` is what
 * Prisma raises when the space-scoped `where` matches nothing, and it is exactly
 * the "not found" this API already has a code for.
 */
const asNoteNotFound = (error: unknown): never => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  ) {
    throw new AppError(
      'Note not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.NOTE_NOT_FOUND
    );
  }
  throw error;
};

/**
 * No pre-flight existence check: the repository write is scoped to the space, so
 * the write is the boundary. A check beforehand could only go stale between the
 * read and the write, which is the race that turned into a `500`.
 */
const update = async (
  ownerId: string,
  spaceId: string,
  noteId: string,
  input: UpdateNoteInput
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const data: { title?: string; content?: string; contentText?: string } = {};

  if (input.title !== undefined) {
    data.title = input.title.trim();
  }

  if (input.content !== undefined) {
    const { content, contentText } = prepareContent(input.content);
    data.content = content;
    data.contentText = contentText;
  }

  const note = await NoteRepository.update(noteId, spaceId, data).catch(
    asNoteNotFound
  );

  return toDetail(note);
};

/**
 * Promote a note to a [[source]] (REQ-022). The note itself is untouched and
 * stays out of retrieval — the snapshot source is the retrievable artifact.
 *
 * `toPlainText` is the projection that goes into the source: the ingestion
 * pipeline treats `Manual` content as text, so handing it markup would index
 * tag names as evidence.
 */
const convertToSource = async (
  ownerId: string,
  spaceId: string,
  noteId: string,
  input: ConvertNoteInput
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const note = await requireNoteInSpace(noteId, spaceId);

  return SourceService.createFromNote(
    spaceId,
    ownerId,
    {
      id: note.id,
      title: note.title,
      content: toPlainText(note.content),
      isAssistantAuthored: note.originType === OriginType.SavedAssistantAnswer
    },
    { title: input.title }
  );
};

const remove = async (ownerId: string, spaceId: string, noteId: string) => {
  await assertSpaceAccess(spaceId, ownerId);

  await NoteRepository.remove(noteId, spaceId).catch(asNoteNotFound);
};

export default {
  list,
  getById,
  create,
  update,
  convertToSource,
  remove
};
