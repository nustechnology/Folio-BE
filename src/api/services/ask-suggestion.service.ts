import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import ModelGateway from '~/api/services/model-gateway.service';
import { SuggestionScope } from '~/api/types/ask';
import { ASK } from '~/api/utils/constants';
import { env } from '~/config/enviroment';
import logger from '~/config/logger';
import redis from '~/config/redis';
import SourceRepository from '~/prisma/repositories/source.repository';
import SpaceRepository from '~/prisma/repositories/space.repository';

// Starter questions for the Ask empty state.
//
// A specific, ready document gets questions drafted from its own text; anything
// else (whole space, a source still processing, a model that failed) falls back
// to the three generic prompts. Suggestions are a convenience, never a blocker,
// so every failure path here degrades instead of throwing.

const cacheKey = (sourceId: string, updatedAt: Date) =>
  `ask:suggestions:${sourceId}:${updatedAt.getTime()}`;

const readCache = async (key: string): Promise<string[] | null> => {
  try {
    const cached = await redis.get(key);
    if (!cached) {
      return null;
    }
    const parsed = JSON.parse(cached);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeCache = async (key: string, suggestions: string[]) => {
  try {
    await redis.set(
      key,
      JSON.stringify(suggestions),
      'EX',
      Number(env.ASK_SUGGESTION_CACHE_TTL_S)
    );
  } catch {
    // A cold cache only costs one extra model call.
  }
};

/**
 * Models answer this prompt with anything from a bare list to a numbered list
 * inside a preamble, so bullets, numbering and stray quotes are stripped before
 * the lines are accepted as questions.
 */
const parseSuggestions = (raw: string): string[] =>
  raw
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
        .replace(/^["'`]|["'`]$/g, '')
        .trim()
    )
    .filter((line) => line.endsWith('?') && line.length > 10)
    .slice(0, ASK.SUGGESTION_COUNT);

const generateForSource = async (
  title: string,
  content: string
): Promise<string[]> => {
  const raw = await ModelGateway.generateText(
    [
      {
        role: 'system',
        content:
          'You write short starter questions a researcher could ask about a document. ' +
          'Answer with exactly three questions, one per line, no numbering and no commentary. ' +
          'Each question must be answerable from the excerpt alone and under 12 words.'
      },
      {
        role: 'user',
        content: `Document title: ${title}\n\nExcerpt:\n${content.slice(
          0,
          ASK.SUGGESTION_CONTEXT_CHARS
        )}`
      }
    ],
    { temperature: 0.4, maxTokens: 200 }
  );

  return parseSuggestions(raw);
};

const list = async (
  ownerId: string,
  spaceId: string,
  options: SuggestionScope
): Promise<{ suggestions: string[]; isDynamic: boolean }> => {
  const space = await SpaceRepository.findByIdAndOwner(spaceId, ownerId);
  if (!space) {
    throw new AppError(
      'Research space not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.SPACE_NOT_FOUND
    );
  }

  const fallback = {
    suggestions: [...ASK.DEFAULT_SUGGESTIONS],
    isDynamic: false
  };

  if (options.scope !== 'source' || !options.sourceId) {
    return fallback;
  }

  const source = await SourceRepository.findById(options.sourceId);
  if (
    !source ||
    source.researchSpaceId !== spaceId ||
    source.processingState !== 'ready' ||
    !source.content.trim()
  ) {
    return fallback;
  }

  const key = cacheKey(source.id, source.updatedAt);
  const cached = await readCache(key);
  if (cached && cached.length === ASK.SUGGESTION_COUNT) {
    return { suggestions: cached, isDynamic: true };
  }

  try {
    const suggestions = await generateForSource(source.title, source.content);
    if (suggestions.length < ASK.SUGGESTION_COUNT) {
      return fallback;
    }
    await writeCache(key, suggestions);
    return { suggestions, isDynamic: true };
  } catch (error) {
    logger.warn('Suggested questions unavailable, using defaults', {
      sourceId: source.id,
      detail: error instanceof Error ? error.message : String(error)
    });
    return fallback;
  }
};

export default { list };
