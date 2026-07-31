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
