import { SourceType } from '~/generated/prisma/client';

/** Which evidence a question is grounded in. */
export type AskScope = 'space' | 'source';

export type RetrievalScope = {
  type: AskScope;
  /** Set only for `source` scope. */
  sourceId?: string;
};

export type AskInput = {
  question: string;
  scope: AskScope;
  sourceId?: string;
  conversationId?: string;
};

/**
 * A citation as the client consumes it. `passageId` is what the reader resolves
 * to `#evidence-passage-{id}`, and `locationLabel` is the human-readable
 * position shown in the citation modal ("Page 14", "Methods › Sampling").
 */
export type AnswerCitation = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: SourceType;
  sourceAuthor: string | null;
  /** Original upload name / MIME type; null for Web and Manual sources. */
  sourceFileName: string | null;
  sourceFileType: string | null;
  passageId: string;
  snippet: string;
  locationLabel: string | null;
  pageReference: string | null;
  sectionReference: string | null;
};

export type MessageFeedback = 'useful' | 'not_useful';

/**
 * One turn as persisted in `Conversation.messages`. The column is JSON rather
 * than a table, so this type is the only contract that keeps it readable.
 */
export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: AnswerCitation[];
  /** Caveat shown above the answer when the evidence is thin or one-sided. */
  limitation?: string | null;
  feedback?: MessageFeedback | null;
  /** Set once the answer has been saved to Notes, so it cannot be saved twice. */
  savedNoteId?: string | null;
  /** True when the user pressed Stop and the text is partial. */
  stopped?: boolean;
  createdAt: string;
};

export type SuggestionScope = {
  scope: AskScope;
  sourceId?: string;
};
