import crypto from 'crypto';

import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import AskPrompt from '~/api/services/ask-prompt.service';
import ModelGateway from '~/api/services/model-gateway.service';
import RetrievalService, {
  EvidenceItem
} from '~/api/services/retrieval.service';
import {
  AnswerCitation,
  AskInput,
  MessageFeedback,
  RetrievalScope,
  StoredMessage
} from '~/api/types/ask';
import { ASK } from '~/api/utils/constants';
import logger from '~/config/logger';
import { Prisma } from '~/generated/prisma/client';
import CitationRepository, {
  NewCitation
} from '~/prisma/repositories/citation.repository';
import ConversationRepository, {
  ListConversationsOptions
} from '~/prisma/repositories/conversation.repository';
import SourceRepository from '~/prisma/repositories/source.repository';
import SpaceRepository from '~/prisma/repositories/space.repository';

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

/**
 * Resolves the requested scope against what is actually searchable. A source
 * that is still processing has no complete index, so pinning a question to it
 * would silently return nothing.
 */
const resolveScope = async (spaceId: string, input: AskInput) => {
  if (input.scope !== 'source') {
    return {
      scope: { type: 'space' } as RetrievalScope,
      label: 'Entire space'
    };
  }

  const source = input.sourceId
    ? await SourceRepository.findById(input.sourceId)
    : null;

  if (!source || source.researchSpaceId !== spaceId) {
    throw new AppError(
      'Source not found',
      StatusCodes.NOT_FOUND,
      ErrorCode.SOURCE_NOT_FOUND
    );
  }

  if (source.processingState !== 'ready') {
    throw new AppError(
      'This source is still being processed. Ask again once it is ready.',
      StatusCodes.CONFLICT,
      ErrorCode.SOURCE_NOT_READY
    );
  }

  return {
    scope: { type: 'source', sourceId: source.id } as RetrievalScope,
    label: `Single source: ${source.title}`
  };
};

const getOrCreateConversation = async (
  spaceId: string,
  input: AskInput,
  scope: RetrievalScope
) => {
  if (input.conversationId) {
    const existing = await ConversationRepository.findByIdInSpace(
      input.conversationId,
      spaceId
    );
    if (!existing) {
      throw new AppError(
        'Conversation not found.',
        StatusCodes.NOT_FOUND,
        ErrorCode.CONVERSATION_NOT_FOUND
      );
    }
    return existing;
  }

  return ConversationRepository.create({
    researchSpaceId: spaceId,
    title: input.question.slice(0, ASK.TITLE_MAX_LENGTH),
    scope
  });
};

/**
 * Persists the evidence an answer cited and returns it in citation form.
 * Written at answer time rather than at save time so "Save as note" can link
 * existing rows, and so the quoted text outlives a re-ingestion of the source.
 */
const persistCitations = async (
  evidence: EvidenceItem[]
): Promise<AnswerCitation[]> => {
  if (evidence.length === 0) {
    return [];
  }

  const payload: NewCitation[] = evidence.map((item) => ({
    sourceId: item.passage.sourceId,
    supportingPassage: item.passage.content,
    passageId: item.passage.id,
    pageReference: item.pageReference,
    sectionReference: item.sectionReference,
    passageLocator: item.passage.locator
      ? JSON.stringify(item.passage.locator)
      : null
  }));

  const rows = await CitationRepository.createMany(payload);
  return evidence.map((item, index) =>
    RetrievalService.toCitation(item, rows[index].id)
  );
};

export type AskStreamCallbacks = {
  /** Fires once every precondition has passed and generation is about to start. */
  onStart: (payload: { conversationId: string; messageId: string }) => void;
  onToken: (text: string) => void;
  onDone: (payload: {
    messageId: string;
    content: string;
    citations: AnswerCitation[];
    limitation: string | null;
    stopped: boolean;
  }) => void;
};

/**
 * Answers one question from the evidence in scope, streaming the text as it is
 * generated.
 *
 * Preconditions are checked before `onStart` so a rejection is an ordinary JSON
 * error rather than an SSE frame the client has to unpack. Once generation has
 * begun the turn is always persisted — including when the user presses Stop,
 * which aborts the model call and keeps whatever text had arrived.
 */
const streamAnswer = async (
  ownerId: string,
  spaceId: string,
  input: AskInput,
  callbacks: AskStreamCallbacks,
  signal: AbortSignal
): Promise<void> => {
  const space = await assertSpaceAccess(spaceId, ownerId);
  const { scope, label } = await resolveScope(spaceId, input);

  const readySourceCount = await SourceRepository.countReadyBySpaceId(spaceId);
  if (readySourceCount === 0) {
    throw new AppError(
      'No evidence available. Add a source before asking a question.',
      StatusCodes.BAD_REQUEST,
      ErrorCode.NO_EVIDENCE
    );
  }

  // Retrieval runs while a failure is still an ordinary precondition error: it
  // must not create a conversation or emit `onStart` before it succeeds.
  const evidence = await RetrievalService.retrieveEvidence({
    researchSpaceId: spaceId,
    sourceId: scope.sourceId,
    question: input.question
  });

  const conversation = await getOrCreateConversation(spaceId, input, scope);
  const history = ConversationRepository.parseMessages(conversation.messages);

  const messageId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  callbacks.onStart({ conversationId: conversation.id, messageId });

  const finish = async (raw: string, stopped: boolean) => {
    const processed = AskPrompt.processAnswer(raw, evidence);

    // An answer that cited nothing still gets its retrieved evidence attached,
    // so the reader has something to check it against. See the helper for the
    // cases that must not take this fallback.
    const unlinked = AskPrompt.shouldAttachUnlinkedEvidence({
      content: processed.content,
      usedEvidenceCount: processed.usedEvidence.length,
      evidenceCount: evidence.length,
      limitation: processed.limitation,
      stopped
    });
    const cited = unlinked
      ? evidence.slice(0, ASK.UNLINKED_EVIDENCE_LIMIT)
      : processed.usedEvidence;

    if (unlinked) {
      logger.warn('Ask answer cited no evidence', {
        spaceId,
        conversationId: conversation.id,
        messageId,
        evidenceCount: evidence.length
      });
    }

    const citations = await persistCitations(cited);

    const limitation =
      processed.limitation ??
      AskPrompt.deriveLimitation({
        citations,
        readySourceCount,
        scope: scope.type,
        unlinked
      });

    const assistantMessage: StoredMessage = {
      id: messageId,
      role: 'assistant',
      content: processed.content,
      citations,
      limitation,
      feedback: null,
      savedNoteId: null,
      stopped,
      createdAt: new Date().toISOString()
    };

    await ConversationRepository.appendMessages(conversation.id, [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: input.question,
        createdAt
      },
      assistantMessage
    ]);

    callbacks.onDone({
      messageId,
      content: processed.content,
      citations,
      limitation,
      stopped
    });
  };

  // Nothing retrieved: answer from the absence of evidence rather than letting
  // the model fill the gap from its own knowledge.
  if (evidence.length === 0) {
    callbacks.onToken(ASK.NO_EVIDENCE_ANSWER);
    await finish(ASK.NO_EVIDENCE_ANSWER, false);
    return;
  }

  const messages = AskPrompt.buildMessages({
    question: input.question,
    evidence,
    history,
    researchObjective: space.researchObjective,
    scopeLabel: label
  });

  let raw = '';
  try {
    for await (const delta of ModelGateway.streamChat(messages, { signal })) {
      raw += delta;
      callbacks.onToken(delta);
    }
  } catch (error) {
    // A partial answer is still worth keeping; anything else is a real failure.
    if (!signal.aborted) {
      logger.error('Ask generation failed', {
        spaceId,
        conversationId: conversation.id,
        detail: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  await finish(raw, signal.aborted);
};

/**
 * `findByIdInSpace` filters by space, which is not the same as an ownership
 * check — every caller has to clear `assertSpaceAccess` first.
 */
const conversationNotFound = () =>
  new AppError(
    'Conversation not found.',
    StatusCodes.NOT_FOUND,
    ErrorCode.CONVERSATION_NOT_FOUND
  );

/**
 * A conversation that vanished between being addressed and being written is
 * reported as missing, not as a server fault: `P2025` is what Prisma raises when
 * a space-scoped `where` matches nothing, and two tabs deleting the same
 * conversation would otherwise answer `500` for the loser.
 */
const asConversationNotFound = (error: unknown): never => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  ) {
    throw conversationNotFound();
  }
  throw error;
};

const requireConversationInSpace = async (
  conversationId: string,
  spaceId: string
) => {
  const conversation = await ConversationRepository.findByIdInSpace(
    conversationId,
    spaceId
  );
  if (!conversation) {
    throw conversationNotFound();
  }
  return conversation;
};

/**
 * History list. Rows carry no message count or preview on purpose — see
 * `ConversationRepository.findManyBySpace`.
 */
const listConversations = async (
  ownerId: string,
  spaceId: string,
  options: ListConversationsOptions
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const { conversations, totalCount } =
    await ConversationRepository.findManyBySpace(spaceId, options);

  return {
    conversations,
    pagination: {
      page: options.page,
      limit: options.limit,
      totalCount,
      totalPages: Math.ceil(totalCount / options.limit)
    }
  };
};

const renameConversation = async (
  ownerId: string,
  spaceId: string,
  conversationId: string,
  title: string
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const conversation = await ConversationRepository.updateTitle(
    conversationId,
    spaceId,
    title
  ).catch(asConversationNotFound);

  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
};

/**
 * Notes saved from this conversation survive it — the user kept them
 * deliberately — with both origin columns cleared. See
 * `ConversationRepository.deleteWithNoteDetach`.
 */
const deleteConversation = async (
  ownerId: string,
  spaceId: string,
  conversationId: string
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const deleted = await ConversationRepository.deleteWithNoteDetach(
    conversationId,
    spaceId
  );
  if (!deleted) {
    throw conversationNotFound();
  }

  return { id: conversationId };
};

const getConversation = async (
  ownerId: string,
  spaceId: string,
  conversationId: string
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const conversation = await requireConversationInSpace(
    conversationId,
    spaceId
  );

  return {
    id: conversation.id,
    researchSpaceId: conversation.researchSpaceId,
    title: conversation.title,
    scope: conversation.activeRetrievalScope as RetrievalScope | null,
    messages: ConversationRepository.parseMessages(conversation.messages),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  };
};

/** Records a thumbs up/down against one answer. Re-rating simply overwrites. */
const recordFeedback = async (
  ownerId: string,
  spaceId: string,
  conversationId: string,
  messageId: string,
  rating: MessageFeedback
) => {
  await assertSpaceAccess(spaceId, ownerId);
  await requireConversationInSpace(conversationId, spaceId);

  const message = await ConversationRepository.updateMessage(
    conversationId,
    messageId,
    { feedback: rating }
  );
  if (!message) {
    throw new AppError(
      'Message not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.MESSAGE_NOT_FOUND
    );
  }

  return { messageId, feedback: rating };
};

export default {
  assertSpaceAccess,
  streamAnswer,
  listConversations,
  getConversation,
  renameConversation,
  deleteConversation,
  recordFeedback
};
