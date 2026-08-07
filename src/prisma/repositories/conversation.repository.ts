import { RetrievalScope, StoredMessage } from '~/api/types/ask';
import { Prisma } from '~/generated/prisma/client';
import prisma from '~/prisma/prisma.client';

/**
 * `Conversation.messages` is a JSON column, so every read has to widen it back
 * into the shape the API works with. Anything malformed (hand-edited row, older
 * write) is dropped rather than surfaced as a broken turn.
 */
const parseMessages = (value: Prisma.JsonValue): StoredMessage[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (message): message is StoredMessage =>
      typeof message === 'object' &&
      message !== null &&
      !Array.isArray(message) &&
      typeof (message as { id?: unknown }).id === 'string'
  );
};

const create = async (data: {
  researchSpaceId: string;
  title: string;
  scope: RetrievalScope;
}) => {
  return prisma.conversation.create({
    data: {
      researchSpaceId: data.researchSpaceId,
      title: data.title,
      messages: [],
      activeRetrievalScope: data.scope as unknown as Prisma.InputJsonValue
    }
  });
};

const findByIdInSpace = async (id: string, researchSpaceId: string) => {
  return prisma.conversation.findFirst({ where: { id, researchSpaceId } });
};

const getMessages = async (
  id: string,
  researchSpaceId: string
): Promise<StoredMessage[] | null> => {
  const conversation = await findByIdInSpace(id, researchSpaceId);
  if (!conversation) {
    return null;
  }
  return parseMessages(conversation.messages);
};

/**
 * Appends turns to a conversation inside a transaction that re-reads the
 * column first: two answers streaming in the same conversation would otherwise
 * overwrite each other's messages on write-back.
 */
const appendMessages = async (
  id: string,
  messages: StoredMessage[]
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({ where: { id } });
    if (!conversation) {
      return;
    }
    await tx.conversation.update({
      where: { id },
      data: {
        messages: [
          ...parseMessages(conversation.messages),
          ...messages
        ] as unknown as Prisma.InputJsonValue
      }
    });
  });
};

/** Applies `patch` to one message, leaving the rest of the thread untouched. */
const updateMessage = async (
  id: string,
  messageId: string,
  patch: Partial<StoredMessage>
): Promise<StoredMessage | null> => {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUnique({ where: { id } });
    if (!conversation) {
      return null;
    }

    const messages = parseMessages(conversation.messages);
    const index = messages.findIndex((message) => message.id === messageId);
    if (index === -1) {
      return null;
    }

    const updated = { ...messages[index], ...patch };
    messages[index] = updated;

    await tx.conversation.update({
      where: { id },
      data: { messages: messages as unknown as Prisma.InputJsonValue }
    });

    return updated;
  });
};

export default {
  create,
  findByIdInSpace,
  getMessages,
  appendMessages,
  updateMessage,
  parseMessages
};
