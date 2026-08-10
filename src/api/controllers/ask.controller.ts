import { Request, Response } from 'express';

import { AppError } from '~/api/errors/app.error';
import { successResponse } from '~/api/routes/response';
import AskService from '~/api/services/ask.service';
import AskSuggestionService from '~/api/services/ask-suggestion.service';
import { openEventStream, EventStream } from '~/api/services/sse.service';
import { AskInput, MessageFeedback, SuggestionScope } from '~/api/types/ask';
import logger from '~/config/logger';

/**
 * `POST /spaces/:spaceId/ask` — streams a grounded answer as Server-Sent
 * Events: `message` (ids), `token` (deltas), `citations`, `done`, `error`.
 *
 * The stream is only opened once the service reports generation is starting, so
 * a rejected request (unknown space, no ready sources) is still an ordinary
 * JSON error the client's normal error path handles.
 */
const ask = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  const input = req.body as AskInput;

  // The browser aborting the fetch (Stop, or navigating away) closes the
  // socket; that is the signal to stop paying for tokens nobody will read.
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let stream: EventStream | null = null;

  try {
    await AskService.streamAnswer(
      req.userId!,
      spaceId,
      input,
      {
        onStart: (payload) => {
          stream = openEventStream(res);
          stream.send('start', payload);
        },
        onToken: (text) => stream?.send('token', { text }),
        onDone: (payload) => {
          stream?.send('citations', { citations: payload.citations });
          stream?.send('done', payload);
          stream?.close();
        }
      },
      controller.signal
    );
  } catch (error) {
    // Before the stream opens the error middleware still owns the response.
    if (!stream) {
      throw error;
    }

    logger.error('Ask stream failed after start', {
      spaceId,
      detail: error instanceof Error ? error.message : String(error)
    });

    const isAppError = error instanceof AppError;
    (stream as EventStream).send('error', {
      message: isAppError ? error.message : 'The answer stream failed.',
      code: isAppError ? error.code : undefined
    });
    (stream as EventStream).close();
  }
};

const suggestions = async (req: Request, res: Response) => {
  const { spaceId } = req.params as { spaceId: string };
  const query = req.query as unknown as SuggestionScope;

  const result = await AskSuggestionService.list(req.userId!, spaceId, query);
  return successResponse(res, result);
};

const getConversation = async (req: Request, res: Response) => {
  const { spaceId, conversationId } = req.params as {
    spaceId: string;
    conversationId: string;
  };

  const conversation = await AskService.getConversation(
    req.userId!,
    spaceId,
    conversationId
  );
  return successResponse(res, { conversation });
};

const recordFeedback = async (req: Request, res: Response) => {
  const { spaceId, conversationId, messageId } = req.params as {
    spaceId: string;
    conversationId: string;
    messageId: string;
  };
  const { rating } = req.body as { rating: MessageFeedback };

  const result = await AskService.recordFeedback(
    req.userId!,
    spaceId,
    conversationId,
    messageId,
    rating
  );
  return successResponse(res, result);
};

export default { ask, suggestions, getConversation, recordFeedback };
