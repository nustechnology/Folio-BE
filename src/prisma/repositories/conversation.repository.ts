import { RetrievalScope, StoredMessage } from '~/api/types/ask';
import { Prisma } from '~/generated/prisma/client';
import prisma from '~/prisma/prisma.client';

/**
 * `Conversation.messages` is a JSON column, so every read has to widen it back
 * into the shape the API works with. Anything malformed (hand-edited row, older
 * write) is dropped rather than surfaced as a broken turn.
 */
const isStoredMessage = (value: Prisma.JsonValue): value is StoredMessage => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'string'
  );
};

const parseMessages = (value: Prisma.JsonValue): StoredMessage[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isStoredMessage);
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
 * Both writers below replace the whole `messages` array, so re-reading inside a
 * transaction is not enough on its own: under the default Read Committed
 * isolation two concurrent transactions read the same array and the later commit
 * silently drops the earlier one's turn. `SELECT ... FOR UPDATE` takes a row
 * lock so the second transaction waits, then re-reads the committed array
 * (Read Committed takes a fresh snapshot per statement) before writing.
 *
 * Returns false when the row does not exist.
 */
const lockConversation = async (
  tx: Prisma.TransactionClient,
  id: string
): Promise<boolean> => {
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "Conversation" WHERE "id" = ${id} FOR UPDATE`;
  return locked.length > 0;
};

/**
 * Appends turns to a conversation inside a transaction that locks and re-reads
 * the column first: two answers streaming in the same conversation would
 * otherwise overwrite each other's messages on write-back.
 */
const appendMessages = async (
  id: string,
  messages: StoredMessage[]
): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockConversation(tx, id))) {
      return;
    }
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
    if (!(await lockConversation(tx, id))) {
      return null;
    }
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
