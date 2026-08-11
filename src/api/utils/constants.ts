export const BCRYPT_SALT_ROUNDS = 10;

export const PASSWORD_MIN_LENGTH = 8;

/**
 * bcrypt only reads the first 72 bytes, so this is not a cryptographic bound —
 * it is there so an unauthenticated endpoint cannot be handed a megabyte to
 * hash.
 */
export const PASSWORD_MAX_LENGTH = 128;

/** A signed JWT for this payload is well under a kilobyte. */
export const REFRESH_TOKEN_MAX_LENGTH = 4096;

export const ADDRESS_MAX_LENGTH = 500;

export const NAME = {
  MIN_LENGTH: 1,
  MAX_LENGTH: 100
} as const;

export const OBJECTIVE_MAX_LENGTH = 500;

export const REQUEST_ID_MAX_LENGTH = 128;

export const DURATION_DECIMAL_PRECISION = 2;

export const NANOSECONDS_PER_MILLISECOND = 1_000_000;

export const SERVER_ERROR_THRESHOLD = 500;

/**
 * The range within which an error's self-reported status is believable.
 * Errors from libraries we do not own may carry a `status`; only a client or
 * server error code is honoured, so a stray property cannot pick a `200`.
 */
export const HTTP_STATUS_MIN = 400;
export const HTTP_STATUS_MAX = 599;

/**
 * Transport cap for `application/json` request bodies.
 *
 * This MUST stay above the largest markup cap declared below — today
 * `NOTEBOOK.CONTENT_HTML_MAX_LENGTH`. body-parser rejects an oversized body
 * before any Joi schema runs, so a transport cap under a field cap makes that
 * field cap unreachable: a payload the API documents as acceptable answers
 * `413` instead. Raise this whenever a markup cap is raised.
 *
 * The two are not in the same unit and cannot be, so this dominates the
 * character caps only for predominantly-ASCII markup. A document written
 * entirely in CJK or emoji runs 3–4 bytes per character and could pass the
 * character cap while exceeding this. That payload is not a real one, which is
 * why the mismatch is accepted rather than resolved by moving the field caps
 * to bytes — those stay in the same unit as the field they guard.
 */
export const JSON_BODY_LIMIT = '2mb';

/**
 * Sized for the notebook's debounced auto-save, which fires at most once per
 * 800 ms while a user types — roughly 75 writes a minute at a sustained pace.
 * The headroom covers a flush-on-exit and a concurrent note edit without ever
 * throttling someone who is merely writing quickly.
 */
export const RATE_LIMIT = {
  WRITE_WINDOW_MS: 60_000,
  WRITE_MAX_REQUESTS: 120
} as const;

/** The methods the write limiter counts; everything else is skipped. */
export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

/**
 * Larger than `NOTE` and allowed to be empty: a notebook is a report rather
 * than a capture, and an unwritten notebook is its normal initial state.
 */
export const NOTEBOOK = {
  CONTENT_MAX_LENGTH: 100_000,
  /** Abuse guard on the stored markup, which is larger than its plain text. */
  CONTENT_HTML_MAX_LENGTH: 1_000_000
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
