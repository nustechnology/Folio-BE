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
// The SDK refuses to construct without an apiKey and this module is imported at
// process start, so a placeholder keeps everything bootable; embedTexts reports
// the missing key at call time instead.
const client = new OpenAI({
  baseURL: env.MODEL_EMBEDDING_BASE_URL,
  apiKey: env.MODEL_EMBEDDING_API_KEY || 'missing-api-key',
  timeout: Number(env.MODEL_REQUEST_TIMEOUT_MS),
  maxRetries: Number(env.MODEL_MAX_RETRIES)
});

// The width Passage.embedding is declared as. Checked here so a misconfigured
// model fails readably instead of as a Postgres type error mid-batch.
export const EMBEDDING_DIMENSIONS = Number(env.MODEL_EMBEDDING_DIMENSIONS);

// Matryoshka models only guarantee unit length at their native width, so a
// truncated vector has to be re-scaled for inner-product/L2 comparisons.
const normalize = (vector: number[]): number[] => {
  let sumOfSquares = 0;
  for (const value of vector) {
    sumOfSquares += value * value;
  }
  const norm = Math.sqrt(sumOfSquares);
  if (norm === 0 || Math.abs(norm - 1) < 1e-6) {
    return vector;
  }
  return vector.map((value) => value / norm);
};

// Gemini counts every text inside a batched request against a 100/min quota, so
// one call with 64 inputs spends 64 of the minute. A sliding window meters that
// in texts/minute: a request is admitted only if the trailing 60s plus its own
// cost still fits. A refilling token bucket would allow a burst and refill
// inside the same 60s, which is what the provider rejects. Per-process — two
// workers on one key would each get their own window.
const RATE_LIMIT_RPM = Math.max(1, Number(env.MODEL_EMBEDDING_RPM) || 90);
const RATE_LIMIT_WINDOW_MS = 60_000;
let spent: { at: number; cost: number }[] = [];
let gate: Promise<void> = Promise.resolve();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const consumeRateLimit = async (count: number): Promise<void> => {
  // A batch bigger than the whole budget can never be admitted, so clamp it.
  const cost = Math.min(count, RATE_LIMIT_RPM);

  const previous = gate;
  let release!: () => void;
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    for (;;) {
      const now = Date.now();
      spent = spent.filter((entry) => entry.at > now - RATE_LIMIT_WINDOW_MS);
      const used = spent.reduce((sum, entry) => sum + entry.cost, 0);

      if (used + cost <= RATE_LIMIT_RPM) {
        spent.push({ at: now, cost });
        return;
      }

      // Wait for the oldest entries to age out until this batch fits.
      let freed = 0;
      let readyAt = now;
      for (const entry of spent) {
        freed += entry.cost;
        readyAt = entry.at + RATE_LIMIT_WINDOW_MS;
        if (used - freed + cost <= RATE_LIMIT_RPM) {
          break;
        }
      }
      const waitMs = Math.max(50, readyAt - now + 50);
      logger.debug('Embedding rate limit reached, waiting for budget', {
        waitMs,
        cost,
        used,
        rpm: RATE_LIMIT_RPM
      });
      await sleep(waitMs);
    }
  } finally {
    release();
  }
};

// Provider 429s carry their own backoff hint, which beats a guessed delay.
const RETRY_HINT = /retry in ([\d.]+)s/i;
const MAX_RATE_LIMIT_RETRIES = 3;

const isRateLimitError = (error: unknown): boolean =>
  (error instanceof OpenAI.APIError && error.status === 429) ||
  (error instanceof Error && error.message.includes('429'));

const retryDelayMs = (error: unknown, attempt: number): number => {
  const match =
    error instanceof Error ? RETRY_HINT.exec(error.message) : undefined;
  if (match) {
    return Math.ceil(Number(match[1]) * 1000) + 500;
  }
  // No hint — back off over the window the quota is measured in.
  return Math.min(60_000, 5_000 * 2 ** attempt);
};

// Embed a list of texts into a list of vectors (one per input, in order).
// Note: the SDK v6 defaults to `encoding_format: 'base64'` and decodes the
// response itself, so `item.embedding` is always a plain number[] — callers
// don't need to handle base64.
const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) {
    return [];
  }

  if (!env.MODEL_EMBEDDING_API_KEY) {
    throw new AppError(
      'No embedding API key configured. Set MODEL_EMBEDDING_API_KEY (or GEMINI_API_KEY) in your .env.',
      StatusCodes.INTERNAL_SERVER_ERROR,
      ErrorCode.EMBEDDING_FAILED
    );
  }

  if (!Number.isInteger(EMBEDDING_DIMENSIONS) || EMBEDDING_DIMENSIONS <= 0) {
    throw new AppError(
      `MODEL_EMBEDDING_DIMENSIONS must be a positive integer, received: ${String(
        env.MODEL_EMBEDDING_DIMENSIONS
      )}`,
      StatusCodes.INTERNAL_SERVER_ERROR,
      ErrorCode.EMBEDDING_FAILED
    );
  }

  try {
    let response;
    for (let attempt = 0; ; attempt++) {
      await consumeRateLimit(texts.length);
      try {
        response = await client.embeddings.create({
          model: env.MODEL_EMBEDDING_MODEL,
          input: texts,
          // Providers without MRL truncation ignore this and are caught below.
          dimensions: EMBEDDING_DIMENSIONS
        });
        break;
      } catch (error) {
        if (!isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) {
          throw error;
        }
        // The provider says we are over budget, so our local accounting is
        // behind (another process on the same key, or usage from before this
        // one started). Book the whole budget as spent, back-dated so it ages
        // out exactly when the provider says we may retry — that stops any
        // concurrent job from sending in the meantime without idling for a
        // full window longer than the provider actually asked for.
        const delay = retryDelayMs(error, attempt);
        spent = [
          {
            at: Date.now() - RATE_LIMIT_WINDOW_MS + delay,
            cost: RATE_LIMIT_RPM
          }
        ];
        logger.warn('Embedding request rate limited, backing off', {
          attempt: attempt + 1,
          delayMs: delay,
          batchSize: texts.length,
          model: env.MODEL_EMBEDDING_MODEL
        });
        await sleep(delay);
      }
    }

    const embeddings = response.data.map((item) => item.embedding);

    const mismatch = embeddings.find(
      (embedding) => embedding.length !== EMBEDDING_DIMENSIONS
    );
    if (mismatch) {
      throw new Error(
        `model "${env.MODEL_EMBEDDING_MODEL}" returned ${mismatch.length}-dimension vectors, ` +
          `but MODEL_EMBEDDING_DIMENSIONS (and the Passage.embedding column) is ${EMBEDDING_DIMENSIONS}. ` +
          'Align the model/dimensions with the schema, then re-index with `yarn reingest`.'
      );
    }

    return embeddings.map(normalize);
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
