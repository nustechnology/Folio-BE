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
