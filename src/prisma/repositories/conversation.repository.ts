import { RetrievalScope, StoredMessage } from '~/api/types/ask';
import { Prisma } from '~/generated/prisma/client';
import prisma from '~/prisma/prisma.client';
import { escapeLikePattern } from '~/prisma/repositories/search.util';

export type ListConversationsOptions = {
  search?: string;
  page: number;
  limit: number;
};

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

/**
 * Citation fields added after rows were first written are absent on older
 * turns. Filling them here keeps `AnswerCitation` (and the OpenAPI `required`
 * list) honest for every message the API returns, and write-back paths that
 * re-spread parsed messages backfill the stored rows as a side effect.
 */
const normalizeMessage = (message: StoredMessage): StoredMessage => {
  if (!message.citations) {
    return message;
  }
  return {
    ...message,
    citations: message.citations.map((citation) => ({
      ...citation,
      sourceFileName: citation.sourceFileName ?? null,
      sourceFileType: citation.sourceFileType ?? null
    }))
  };
};

const parseMessages = (value: Prisma.JsonValue): StoredMessage[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isStoredMessage).map(normalizeMessage);
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

/**
 * History rows for one space, most recently answered first.
 *
 * The `select` deliberately omits `messages`. That column holds the entire
 * thread — every answer's full text plus its citation snippets — so a page of
 * long conversations is megabytes of JSON parsed out of Postgres and discarded
 * to render a title and a timestamp. It is also why a row carries no message
 * count or answer preview: both would need the blob back. A count belongs in a
 * denormalised column maintained by `appendMessages`, not in a wider select.
 */
const findManyBySpace = async (
  researchSpaceId: string,
  options: ListConversationsOptions
) => {
  const where: Prisma.ConversationWhereInput = { researchSpaceId };

  if (options.search) {
    where.title = {
      contains: escapeLikePattern(options.search),
      mode: 'insensitive'
    };
  }

  const [conversations, totalCount] = await Promise.all([
    prisma.conversation.findMany({
      where,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
      // `id` breaks ties: `updatedAt` alone leaves rows touched in the same
      // transaction (or the same clock tick) in whatever order the plan
      // produces, which offset pagination turns into rows repeated on one page
      // and missing from another.
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (options.page - 1) * options.limit,
      take: options.limit
    }),
    prisma.conversation.count({ where })
  ]);

  return { conversations, totalCount };
};

/**
 * Scoped by `researchSpaceId` as well as `id`, so the write itself is what keeps
 * a conversation id from another space out — no separate existence check has to
 * stay true between being read and being acted on. A row that is gone raises
 * Prisma `P2025`, which the service maps to `CONVERSATION_NOT_FOUND`.
 */
const updateTitle = async (
  id: string,
  researchSpaceId: string,
  title: string
) => {
  return prisma.conversation.update({
    where: { id, researchSpaceId },
    data: { title }
  });
};

/**
 * Deletes a conversation without taking the notes saved from it.
 *
 * `Note.originConversationId` is an optional relation, so Prisma's implicit
 * `SetNull` would keep the delete from failing on the foreign key. But
 * `originMessageId` is a bare `String?` with no FK — nothing nulls it — and a
 * note left carrying a message id that resolves to nothing is worse than one
 * that plainly has no origin. Both are cleared explicitly, in the same
 * transaction as the delete.
 *
 * `originType` is left as `SavedAssistantAnswer`: the note is still a saved
 * answer, it just no longer has a thread to point at.
 *
 * The row is locked before the detach, which is what makes "both are cleared"
 * true of notes saved concurrently. `Note.originConversationId` is a foreign
 * key, so inserting a note against this conversation takes `FOR KEY SHARE` on
 * this row; `FOR UPDATE` conflicts with that, so the insert blocks here instead
 * of landing between the detach and the delete. Without the lock that insert
 * commits inside the window, the delete's `SetNull` clears its
 * `originConversationId`, and its `originMessageId` is left pointing at a
 * message that no longer exists — the state this function exists to prevent.
 *
 * Scoped by `researchSpaceId` for the same reason as `updateTitle`; returns
 * false when nothing matched, which the service maps to
 * `CONVERSATION_NOT_FOUND`.
 */
const deleteWithNoteDetach = async (
  id: string,
  researchSpaceId: string
): Promise<boolean> => {
  return prisma.$transaction(async (tx) => {
    if (!(await lockConversation(tx, id, researchSpaceId))) {
      return false;
    }
    await tx.note.updateMany({
      where: { originConversationId: id },
      data: { originConversationId: null, originMessageId: null }
    });
    await tx.conversation.delete({ where: { id } });
    return true;
  });
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
 * Returns false when the row does not exist — or, when `researchSpaceId` is
 * given, when it exists in a different space, so callers that must not act
 * across spaces can use the lock as their scope check.
 */
const lockConversation = async (
  tx: Prisma.TransactionClient,
  id: string,
  researchSpaceId?: string
): Promise<boolean> => {
  const scope =
    researchSpaceId === undefined
      ? Prisma.empty
      : Prisma.sql` AND "researchSpaceId" = ${researchSpaceId}`;
  const locked = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id" = ${id}${scope} FOR UPDATE`
  );
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
  findManyBySpace,
  updateTitle,
  deleteWithNoteDetach,
  getMessages,
  appendMessages,
  updateMessage,
  parseMessages
};
