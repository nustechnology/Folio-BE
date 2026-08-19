import { Response } from 'express';
import { Redis } from 'ioredis';

import redis from '~/config/redis';
import SourceRepository from '~/prisma/repositories/source.repository';
import SpaceRepository from '~/prisma/repositories/space.repository';

// SSE progress streaming.
//
// The ingestion worker runs in a separate process, so the API server can't see
// its in-memory state. We bridge the two with Redis pub/sub: the worker calls
// `publishStatus()` after every state change, and `streamAllStatus()` (the
// GET /sources/status endpoint) subscribes to that channel and forwards the
// events to the client as Server-Sent Events.
const GLOBAL_STATUS_CHANNEL = 'sources:status';

// Comfortably under the shortest idle timeout on the path (30s dev proxy, 60s
// client stall watchdog), which is what a heartbeat needs to beat.
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Starts a `: ping` heartbeat and stops it when the client goes away. */
const startHeartbeat = (res: Response): void => {
  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    res.write(': ping\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  res.on('close', () => clearInterval(heartbeat));
};

// Client-facing progress per processing stage (0-100%).
const PROGRESS_MAP: Record<string, number> = {
  added: 0,
  extracting_text: 25,
  indexing_evidence: 50,
  ready: 100,
  failed: 100
};

// Serialize a status payload into an SSE `data:` frame.
const buildEvent = (
  sourceId: string,
  state: string,
  error?: string
): string => {
  const payload: Record<string, unknown> = {
    sourceId,
    state,
    progress: PROGRESS_MAP[state] ?? 0
  };
  if (error) {
    payload.error = error;
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
};

export type EventStream = {
  send: (event: string, data: unknown) => void;
  close: () => void;
  readonly open: boolean;
};

// Opens a named-event SSE response. Used by the Ask endpoint, which sends
// `start` / `token` / `citations` / `done` / `error` frames rather than the
// single anonymous frame the ingestion progress stream uses.
//
// Writes are dropped once the socket is gone, so a client that navigates away
// mid-answer cannot crash the generation that is still finishing server-side.
export const openEventStream = (res: Response): EventStream => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tells nginx not to buffer the response — without it tokens arrive in one
    // burst at the end, which defeats streaming entirely.
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  // The model can take tens of seconds to warm up before the first token,
  // which otherwise reads as an idle connection to proxies and the client.
  startHeartbeat(res);

  return {
    send: (event, data) => {
      if (res.writableEnded || res.destroyed) {
        return;
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close: () => {
      if (!res.writableEnded) {
        res.end();
      }
    },
    get open() {
      return !res.writableEnded && !res.destroyed;
    }
  };
};

// Called by the ingestion worker to broadcast a state transition.
export const publishStatus = async (
  sourceId: string,
  state: string,
  error?: string
): Promise<void> => {
  const message = JSON.stringify({ sourceId, state, error });
  await redis.publish(GLOBAL_STATUS_CHANNEL, message);
};

// Express handler backing GET /sources/status.
// Sends the current DB state immediately for all sources owned by the user
// (so late-joining clients are not left blank), then streams live events
// until the client disconnects.
export const streamAllStatus = async (
  userId: string,
  res: Response
): Promise<void> => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();

  // Emit the current state right away, then wait for worker-published events.
  const currentSources = await SourceRepository.findManyByOwnerId(userId);
  for (const source of currentSources) {
    res.write(
      buildEvent(
        source.id,
        source.processingState,
        source.processingError ?? undefined
      )
    );
  }

  // ioredis requires a dedicated connection for subscribe mode — a duplicate of
  // the shared client is created so the main connection stays free for queries.
  const subscriber: Redis = redis.duplicate();
  await subscriber.subscribe(GLOBAL_STATUS_CHANNEL);

  subscriber.on('message', async (_channel, message) => {
    try {
      const { sourceId, state, error } = JSON.parse(message);

      // Check if the user is authorized to see this source's status.
      const source = await SourceRepository.findById(sourceId);
      if (!source) return;

      const space = await SpaceRepository.findByIdAndOwner(
        source.researchSpaceId,
        userId
      );
      if (!space) return;

      res.write(buildEvent(sourceId, state, error));
    } catch {
      // Ignore parse/lookup errors
    }
  });

  // Periodic comment frame keeps the connection alive past idle proxies.
  startHeartbeat(res);

  // Cleanup: unsubscribe when the browser closes the stream.
  res.on('close', () => {
    subscriber.unsubscribe(GLOBAL_STATUS_CHANNEL).catch(() => {});
    subscriber.disconnect();
  });
};

export default { publishStatus, streamAllStatus, openEventStream };
