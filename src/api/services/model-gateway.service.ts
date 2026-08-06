// ModelGateway — the ONLY module that talks to the cloud model provider.
// Domain services (chunking, future QA pipeline) depend on these small,
// provider-agnostic methods instead of the OpenAI SDK types directly, so the
// provider can be swapped via env config without touching business logic.
import { StatusCodes } from 'http-status-codes';
import OpenAI from 'openai';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { env } from '~/config/enviroment';
import logger from '~/config/logger';

// OpenAI-compatible client. Works with OpenAI, Groq, Gemini (OpenAI-compat),
// or any provider exposing /v1/embeddings — just set MODEL_EMBEDDING_BASE_URL.
const client = new OpenAI({
  baseURL: env.MODEL_EMBEDDING_BASE_URL,
  apiKey: env.MODEL_EMBEDDING_API_KEY,
  timeout: Number(env.MODEL_REQUEST_TIMEOUT_MS),
  maxRetries: Number(env.MODEL_MAX_RETRIES)
});

// Embed a list of texts into a list of vectors (one per input, in order).
// Note: the SDK v6 defaults to `encoding_format: 'base64'` and decodes the
// response itself, so `item.embedding` is always a plain number[] — callers
// don't need to handle base64.
const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) {
    return [];
  }

  try {
    const response = await client.embeddings.create({
      model: env.MODEL_EMBEDDING_MODEL,
      input: texts
    });
    const embeddings = response.data.map((item) => item.embedding);
    return embeddings;
  } catch (error) {
    // Surface the real provider error (e.g. "401 Incorrect API key") so
    // ingestion failures are diagnosable instead of a generic 500.
    const detail = error instanceof Error ? error.message : String(error);
    logger.error('Embedding generation failed', {
      detail,
      model: env.MODEL_EMBEDDING_MODEL,
      baseURL: env.MODEL_EMBEDDING_BASE_URL
    });
    throw new AppError(
      `Failed to generate embeddings: ${detail}`,
      StatusCodes.INTERNAL_SERVER_ERROR,
      ErrorCode.EMBEDDING_FAILED
    );
  }
};

export default { embedTexts };
