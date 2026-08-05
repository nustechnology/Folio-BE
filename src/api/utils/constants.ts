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

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100
} as const;
