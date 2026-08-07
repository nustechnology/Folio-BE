export const BCRYPT_SALT_ROUNDS = 10;

export const PASSWORD_MIN_LENGTH = 8;

export const NAME = {
  MIN_LENGTH: 1,
  MAX_LENGTH: 100
} as const;

export const OBJECTIVE_MAX_LENGTH = 500;

export const REQUEST_ID_MAX_LENGTH = 128;

export const DURATION_DECIMAL_PRECISION = 2;

export const NANOSECONDS_PER_MILLISECOND = 1_000_000;

export const SERVER_ERROR_THRESHOLD = 500;

export const NOTE = {
  DEFAULT_TITLE: 'Untitled Note',
  TITLE_MAX_LENGTH: 150,
  CONTENT_MIN_LENGTH: 1,
  CONTENT_MAX_LENGTH: 20_000,
  /** Abuse guard on the stored markup, which is larger than its plain text. */
  CONTENT_HTML_MAX_LENGTH: 200_000,
  PREVIEW_MAX_LENGTH: 280
} as const;

export const ASK = {
  QUESTION_MIN_LENGTH: 1,
  QUESTION_MAX_LENGTH: 1_000,
  /** Conversation titles are the opening question, trimmed to fit a sidebar. */
  TITLE_MAX_LENGTH: 60,
  /** Prior turns replayed for follow-up questions (user + assistant). */
  HISTORY_MESSAGE_LIMIT: 12,
  /** Marker the model ends on when it wants to caveat its own answer. */
  LIMITATION_PREFIX: 'LIMITATION:',
  SUGGESTION_COUNT: 3,
  /** Characters of a document handed to the model when drafting suggestions. */
  SUGGESTION_CONTEXT_CHARS: 4_000,
  NO_EVIDENCE_ANSWER:
    'No indexed evidence in the selected scope bears on that question. Try rephrasing it, widening the scope to the entire space, or adding a source that covers the topic.',
  DEFAULT_SUGGESTIONS: [
    'Summarize all the evidence.',
    'What problems appear most often?',
    'Where do the sources disagree?'
  ]
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100
} as const;

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export const ALLOWED_FILE_EXTENSIONS = [
  'pdf',
  'docx',
  'txt',
  'md',
  'pptx',
  'xlsx',
  'csv',
  'epub'
] as const;

export const MIME_TYPE_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  epub: 'application/epub+zip'
};

export const SOURCE_TITLE_MAX_LENGTH = 255;
export const SOURCE_AUTHOR_MAX_LENGTH = 100;
export const SOURCE_FILE_NAME_MAX_LENGTH = 255;
export const SOURCE_CONTENT_MIN_LENGTH = 10;
export const SOURCE_CONTENT_MAX_LENGTH = 50_000;
export const SOURCE_URL_MAX_LENGTH = 2048;
