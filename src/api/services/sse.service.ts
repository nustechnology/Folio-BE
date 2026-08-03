import { Response } from 'express';
import { Redis } from 'ioredis';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import redis from '~/config/redis';
import SourceRepository from '~/prisma/repositories/source.repository';
import SpaceRepository from '~/prisma/repositories/space.repository';

// SSE progress streaming.
//
// The ingestion worker runs in a separate process, so the API server can't see
// its in-memory state. We bridge the two with Redis pub/sub: the worker calls
// `publishStatus()` after every state change, and `streamStatus()` (the
// GET /sources/:id/status endpoint) subscribes to that channel and forwards the
// events to the client as Server-Sent Events.
const statusChannel = (sourceId: string): string => `source:${sourceId}`;

// Client-facing progress per processing stage (0-100%).
const PROGRESS_MAP: Record<string, number> = {
  added: 0,
  extracting_text: 25,
  indexing_evidence: 50,
  ready: 100,
  failed: 100
};

// Serialize a status payload into an SSE `data:` frame.
const buildEvent = (state: string, error?: string): string => {
  const payload: Record<string, unknown> = {
    state,
    progress: PROGRESS_MAP[state] ?? 0
  };
  if (error) {
    payload.error = error;
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
};

// Called by the ingestion worker to broadcast a state transition.
export const publishStatus = async (
  sourceId: string,
  state: string,
  error?: string
): Promise<void> => {
  await redis.publish(statusChannel(sourceId), buildEvent(state, error));
};

// Express handler backing GET /sources/:sourceId/status.
// Sends the current DB state immediately (so late-joining clients are not left
// blank), then streams live events until the client disconnects.
export const streamStatus = async (
  sourceId: string,
  userId: string,
  res: Response
): Promise<void> => {
  // Ownership check happens BEFORE headers are written so a 401/404 is still a
  // normal JSON error instead of a broken SSE stream.
  const source = await SourceRepository.findById(sourceId);
  if (!source) {
    throw new AppError(
      'Source not found',
      StatusCodes.NOT_FOUND,
      ErrorCode.SOURCE_NOT_FOUND
    );
  }
  const space = await SpaceRepository.findByIdAndOwner(
    source.researchSpaceId,
    userId
  );
  if (!space) {
    throw new AppError(
      'Source not found',
      StatusCodes.NOT_FOUND,
      ErrorCode.SOURCE_NOT_FOUND
    );
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  // Emit the current state right away, then wait for worker-published events.
  const current = await SourceRepository.findById(sourceId);
  if (current) {
    res.write(
      buildEvent(current.processingState, current.processingError ?? undefined)
    );
  }

  // ioredis requires a dedicated connection for subscribe mode — a duplicate of
  // the shared client is created so the main connection stays free for queries.
  const subscriber: Redis = redis.duplicate();
  await subscriber.subscribe(statusChannel(sourceId));
  subscriber.on('message', (_channel, message) => {
    res.write(message);
  });

  // Periodic comment frame keeps the connection alive past idle proxies.
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  // Cleanup: stop heartbeat + unsubscribe when the browser closes the stream.
  res.on('close', () => {
    clearInterval(heartbeat);
    subscriber.unsubscribe(statusChannel(sourceId)).catch(() => {});
    subscriber.disconnect();
  });
};

export default { publishStatus, streamStatus };
