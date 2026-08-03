import { Queue } from 'bullmq';

import redis from '~/config/redis';

// BullMQ queue shared by the producer (API server) and consumer (ingestion
// worker). The worker runs in a separate process and consumes jobs from the
// same Redis-backed queue.
export const INGESTION_QUEUE_NAME = 'ingestion';

export const ingestionQueue = new Queue(INGESTION_QUEUE_NAME, {
  connection: redis
});

// Enqueue an ingestion job for a source. The deterministic `jobId` makes the
// job idempotent: a duplicate `ingest-<sourceId>` job still waiting is ignored.
// Failed jobs retry up to 3 times with exponential backoff; completed jobs are
// removed so a later retry (via POST /sources/:id/retry) can enqueue again.
export const enqueueIngestion = async (sourceId: string): Promise<void> => {
  await ingestionQueue.add(
    'ingest-source',
    { sourceId },
    {
      jobId: `ingest-${sourceId}`,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 }
    }
  );
};
