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

// A blank API key is normal for self-hosted servers (Ollama, vLLM), but the SDK
// refuses to construct without one — and it is constructed at import, so an
// unset key would take down every route that transitively imports this module,
// not just the ones that call a model. The placeholder defers the failure to
// the request itself, where the provider's own error is reported.
const NO_KEY_PLACEHOLDER = 'not-required';

// OpenAI-compatible client. Works with OpenAI, Groq, Gemini (OpenAI-compat),
// or any provider exposing /v1/embeddings — just set MODEL_EMBEDDING_BASE_URL.
const client = new OpenAI({
  baseURL: env.MODEL_EMBEDDING_BASE_URL,
  apiKey: env.MODEL_EMBEDDING_API_KEY || NO_KEY_PLACEHOLDER,
  timeout: Number(env.MODEL_REQUEST_TIMEOUT_MS),
  maxRetries: Number(env.MODEL_MAX_RETRIES)
});

// Metered providers bill every text inside a batched request separately, so one
// call with 64 inputs spends 64 of the minute (Gemini's free tier allows 100).
// A sliding window meters that in texts/minute: a request is admitted only if
// the trailing 60s plus its own cost still fits. A refilling token bucket would
// allow a burst and refill inside the same 60s, which is what such providers
// reject. Per-process — two workers on one key each get their own window.
//
// Defaults to 90/min when MODEL_EMBEDDING_RPM is blank or absent. Set it to 0
// when pointing at a self-hosted model with no quota, where a standing cap
// would only throttle local ingestion.
const RATE_LIMIT_RPM = Math.max(0, Number(env.MODEL_EMBEDDING_RPM) || 0);
const RATE_LIMIT_WINDOW_MS = 60_000;
let spent: { at: number; cost: number }[] = [];
let gate: Promise<void> = Promise.resolve();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const consumeRateLimit = async (count: number): Promise<void> => {
  // Zero means no metering at all — not even the serializing gate below, which
  // would otherwise queue every batch behind the last for no reason.
  if (RATE_LIMIT_RPM === 0) {
    return;
  }

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

// Generation may live behind a different host/key than embeddings (a local
// Ollama for vectors, a hosted model for answers), so it gets its own client.
const chatClient = new OpenAI({
  baseURL: env.MODEL_CHAT_BASE_URL,
  apiKey: env.MODEL_CHAT_API_KEY || NO_KEY_PLACEHOLDER,
  timeout: Number(env.MODEL_REQUEST_TIMEOUT_MS),
  maxRetries: Number(env.MODEL_MAX_RETRIES)
});

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatOptions = {
  /** Aborts the upstream request when the client hangs up mid-answer. */
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
};

const toModelError = (error: unknown, action: string): AppError => {
  const detail = error instanceof Error ? error.message : String(error);
  logger.error(`${action} failed`, {
    detail,
    model: env.MODEL_CHAT_MODEL,
    baseURL: env.MODEL_CHAT_BASE_URL
  });
  // The provider detail goes to the log only — it can carry keys, hostnames, or
  // prompt fragments, so the client gets a fixed message.
  return new AppError(
    `${action} failed. Please try again.`,
    StatusCodes.BAD_GATEWAY,
    ErrorCode.GENERATION_FAILED
  );
};

// `Passage.embedding` is declared at a fixed width, so a model of another size
// fails deep inside a raw INSERT with a Postgres type error that names neither
// the model nor the setting behind it. `MODEL_EMBEDDING_DIMENSIONS` records the
// width the schema was migrated to, which makes swapping the embedding model
// without migrating an error that explains itself.
const assertExpectedDimensions = (actual: number | undefined) => {
  const expected = Number(env.MODEL_EMBEDDING_DIMENSIONS);
  if (!actual || !expected || actual === expected) {
    return;
  }

  throw new AppError(
    `Embedding model "${env.MODEL_EMBEDDING_MODEL}" returns ${actual} dimensions but the passage index expects ${expected}. Update MODEL_EMBEDDING_DIMENSIONS and migrate the "Passage"."embedding" column to match.`,
    StatusCodes.INTERNAL_SERVER_ERROR,
    ErrorCode.EMBEDDING_FAILED
  );
};

// Embed a list of texts into a list of vectors (one per input, in order).
// Note: the SDK v6 defaults to `encoding_format: 'base64'` and decodes the
// response itself, so `item.embedding` is always a plain number[] — callers
// don't need to handle base64.
const embedTexts = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) {
    return [];
  }

  try {
    let response;
    for (let attempt = 0; ; attempt++) {
      await consumeRateLimit(texts.length);
      try {
        response = await client.embeddings.create({
          model: env.MODEL_EMBEDDING_MODEL,
          input: texts
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
    assertExpectedDimensions(embeddings[0]?.length);
    return embeddings;
  } catch (error) {
    // A dimension mismatch is already a precise, actionable message; wrapping
    // it as a provider failure would bury what it says.
    if (error instanceof AppError) {
      throw error;
    }

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

// Stream a chat completion, yielding text deltas as they arrive. Yielding
// (rather than returning the whole answer) is what lets the Ask endpoint
// forward tokens to the browser while the model is still writing.
//
// An aborted request is not an error: the caller stopped generation on purpose,
// and whatever was yielded so far is kept.
async function* streamChat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): AsyncGenerator<string> {
  let stream;
  try {
    stream = await chatClient.chat.completions.create(
      {
        model: env.MODEL_CHAT_MODEL,
        messages,
        stream: true,
        temperature: options.temperature ?? Number(env.MODEL_CHAT_TEMPERATURE),
        max_tokens: options.maxTokens ?? Number(env.MODEL_CHAT_MAX_TOKENS)
      },
      { signal: options.signal }
    );
  } catch (error) {
    if (options.signal?.aborted) {
      return;
    }
    throw toModelError(error, 'Answer generation');
  }

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  } catch (error) {
    if (options.signal?.aborted) {
      return;
    }
    throw toModelError(error, 'Answer generation');
  }
}

// Single-shot completion. Used where the caller needs the whole text before it
// can act on it (suggested questions), so streaming would buy nothing.
const generateText = async (
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<string> => {
  try {
    const response = await chatClient.chat.completions.create(
      {
        model: env.MODEL_CHAT_MODEL,
        messages,
        temperature: options.temperature ?? Number(env.MODEL_CHAT_TEMPERATURE),
        max_tokens: options.maxTokens ?? Number(env.MODEL_CHAT_MAX_TOKENS)
      },
      { signal: options.signal }
    );
    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (error) {
    throw toModelError(error, 'Text generation');
  }
};

export default { embedTexts, streamChat, generateText };
