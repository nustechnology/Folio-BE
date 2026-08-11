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
import CitationRepository, {
  NewCitation
} from '~/prisma/repositories/citation.repository';
import ConversationRepository from '~/prisma/repositories/conversation.repository';
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
    const citations = await persistCitations(processed.usedEvidence);

    const limitation =
      processed.limitation ??
      AskPrompt.deriveLimitation({
        citations,
        readySourceCount,
        scope: scope.type
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

const getConversation = async (
  ownerId: string,
  spaceId: string,
  conversationId: string
) => {
  await assertSpaceAccess(spaceId, ownerId);

  const conversation = await ConversationRepository.findByIdInSpace(
    conversationId,
    spaceId
  );
  if (!conversation) {
    throw new AppError(
      'Conversation not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.CONVERSATION_NOT_FOUND
    );
  }

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

  const conversation = await ConversationRepository.findByIdInSpace(
    conversationId,
    spaceId
  );
  if (!conversation) {
    throw new AppError(
      'Conversation not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.CONVERSATION_NOT_FOUND
    );
  }

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
  getConversation,
  recordFeedback
};
