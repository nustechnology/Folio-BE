import * as dotenv from 'dotenv';

dotenv.config();

interface EnvInterface {
  SERVER_PORT: string;
  NODE_ENV: string;
  LOG_LEVEL: string;
  DATABASE_URL: string;
  JWT_TOKEN_SECRET: string;
  REFRESH_TOKEN_SECRET: string;
  ACCESS_TOKEN_EXPIRATION: string;
  REFRESH_TOKEN_EXPIRATION: string;
  CORS_ORIGIN: string;
  SEED_USER_PASSWORD: string;
  MINIO_ENDPOINT: string;
  MINIO_PORT: string;
  MINIO_ROOT_USER: string;
  MINIO_ROOT_PASSWORD: string;
  MINIO_BUCKET_NAME: string;
  MINIO_USE_SSL: string;
  MULTER_TEMP_DIR: string;
  REDIS_HOST: string;
  REDIS_PORT: string;
  MODEL_EMBEDDING_BASE_URL: string;
  MODEL_EMBEDDING_API_KEY: string;
  MODEL_EMBEDDING_MODEL: string;
  MODEL_EMBEDDING_DIMENSIONS: string;
  MODEL_CHAT_BASE_URL: string;
  MODEL_CHAT_API_KEY: string;
  MODEL_CHAT_MODEL: string;
  MODEL_CHAT_TEMPERATURE: string;
  MODEL_CHAT_MAX_TOKENS: string;
  MODEL_REQUEST_TIMEOUT_MS: string;
  MODEL_MAX_RETRIES: string;
  ASK_RETRIEVAL_CANDIDATES: string;
  ASK_RETRIEVAL_TOP_K: string;
  ASK_HISTORY_TURNS: string;
  ASK_SUGGESTION_CACHE_TTL_S: string;
  CHUNK_PRE_SPLIT_TOKENS: string;
  CHUNK_TARGET_TOKENS: string;
  CHUNK_MAX_TOKENS: string;
  CHUNK_OVERLAP_TOKENS: string;
  CHUNK_BREAKPOINT_PERCENTILE: string;
  CHUNK_EMBED_BATCH_SIZE: string;
  CHUNK_STRATEGY_VERSION: string;
  GEMINI_API_KEY: string;
  OCR_CHARS_PER_PAGE_THRESHOLD: string;
}

const nodeEnv = process.env.NODE_ENV || '';

export const env: EnvInterface = {
  SERVER_PORT: process.env.PORT || '',
  NODE_ENV: nodeEnv,
  LOG_LEVEL:
    process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug'),
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_TOKEN_SECRET: process.env.JWT_TOKEN_SECRET || '',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || '',
  ACCESS_TOKEN_EXPIRATION: process.env.ACCESS_TOKEN_EXPIRATION || '15m',
  REFRESH_TOKEN_EXPIRATION: process.env.REFRESH_TOKEN_EXPIRATION || '30d',
  CORS_ORIGIN:
    process.env.CORS_ORIGIN ||
    (nodeEnv === 'production' ? '' : 'http://localhost:3000'),
  SEED_USER_PASSWORD: process.env.SEED_USER_PASSWORD || '',
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT || 'localhost',
  MINIO_PORT: process.env.MINIO_PORT || '9000',
  MINIO_ROOT_USER: process.env.MINIO_ROOT_USER || 'minioadmin',
  MINIO_ROOT_PASSWORD: process.env.MINIO_ROOT_PASSWORD || 'minioadmin',
  MINIO_BUCKET_NAME: process.env.MINIO_BUCKET_NAME || 'folio-sources',
  MINIO_USE_SSL: process.env.MINIO_USE_SSL || 'false',
  MULTER_TEMP_DIR: process.env.MULTER_TEMP_DIR || '',
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: process.env.REDIS_PORT || '6379',
  MODEL_EMBEDDING_BASE_URL:
    process.env.MODEL_EMBEDDING_BASE_URL || 'https://api.openai.com/v1',
  MODEL_EMBEDDING_API_KEY: process.env.MODEL_EMBEDDING_API_KEY || '',
  // The defaults describe the migrated schema: `Passage.embedding` is
  // `vector(1024)` (migration `20260811120000_embedding_model_bge_m3`) and
  // bge-m3 is the model that width was chosen for. Changing either means
  // changing both, plus a migration — the guard in `model-gateway.service.ts`
  // enforces that they agree.
  MODEL_EMBEDDING_MODEL: process.env.MODEL_EMBEDDING_MODEL || 'bge-m3',
  MODEL_EMBEDDING_DIMENSIONS: process.env.MODEL_EMBEDDING_DIMENSIONS || '1024',
  // Generation runs through the same OpenAI-compatible surface as embeddings
  // and defaults to the embedding endpoint's host, so a single local Ollama (or
  // a single cloud key) serves both without extra configuration.
  MODEL_CHAT_BASE_URL:
    process.env.MODEL_CHAT_BASE_URL ||
    process.env.MODEL_EMBEDDING_BASE_URL ||
    'https://api.openai.com/v1',
  MODEL_CHAT_API_KEY:
    process.env.MODEL_CHAT_API_KEY || process.env.MODEL_EMBEDDING_API_KEY || '',
  MODEL_CHAT_MODEL: process.env.MODEL_CHAT_MODEL || 'gpt-4o-mini',
  MODEL_CHAT_TEMPERATURE: process.env.MODEL_CHAT_TEMPERATURE || '0.1',
  MODEL_CHAT_MAX_TOKENS: process.env.MODEL_CHAT_MAX_TOKENS || '900',
  MODEL_REQUEST_TIMEOUT_MS: process.env.MODEL_REQUEST_TIMEOUT_MS || '60000',
  MODEL_MAX_RETRIES: process.env.MODEL_MAX_RETRIES || '1',
  // Retrieval: `CANDIDATES` per branch of the hybrid search, `TOP_K` passages
  // survive fusion and become the evidence the answer may cite.
  ASK_RETRIEVAL_CANDIDATES: process.env.ASK_RETRIEVAL_CANDIDATES || '40',
  ASK_RETRIEVAL_TOP_K: process.env.ASK_RETRIEVAL_TOP_K || '6',
  ASK_HISTORY_TURNS: process.env.ASK_HISTORY_TURNS || '6',
  ASK_SUGGESTION_CACHE_TTL_S: process.env.ASK_SUGGESTION_CACHE_TTL_S || '3600',
  CHUNK_PRE_SPLIT_TOKENS: process.env.CHUNK_PRE_SPLIT_TOKENS || '160',
  CHUNK_TARGET_TOKENS: process.env.CHUNK_TARGET_TOKENS || '500',
  CHUNK_MAX_TOKENS: process.env.CHUNK_MAX_TOKENS || '800',
  CHUNK_OVERLAP_TOKENS: process.env.CHUNK_OVERLAP_TOKENS || '80',
  CHUNK_BREAKPOINT_PERCENTILE: process.env.CHUNK_BREAKPOINT_PERCENTILE || '90',
  CHUNK_EMBED_BATCH_SIZE: process.env.CHUNK_EMBED_BATCH_SIZE || '64',
  CHUNK_STRATEGY_VERSION:
    process.env.CHUNK_STRATEGY_VERSION || 'langchain-semantic-v1',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OCR_CHARS_PER_PAGE_THRESHOLD: process.env.OCR_CHARS_PER_PAGE_THRESHOLD || '50'
};

const missing = [
  ['JWT_TOKEN_SECRET', env.JWT_TOKEN_SECRET],
  ['REFRESH_TOKEN_SECRET', env.REFRESH_TOKEN_SECRET],
  ...(nodeEnv === 'production' ? [['CORS_ORIGIN', env.CORS_ORIGIN]] : [])
]
  .filter(([, v]) => !v || v.trim().length === 0)
  .map(([k]) => k);

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(', ')}`
  );
}

// Caught at startup rather than at request time: a non-numeric value would make
// the dimension guard in `model-gateway.service.ts` silently pass everything,
// and the mismatch would resurface as a Postgres type error deep inside an
// INSERT that names neither the model nor the setting behind it.
const dimensions = Number(env.MODEL_EMBEDDING_DIMENSIONS);
if (!Number.isInteger(dimensions) || dimensions <= 0) {
  throw new Error(
    `MODEL_EMBEDDING_DIMENSIONS must be a positive integer, got "${env.MODEL_EMBEDDING_DIMENSIONS}".`
  );
}
