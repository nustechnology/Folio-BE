import { Worker } from 'bullmq';

import { chunkAndEmbed } from '~/api/services/chunking.service';
import { extract } from '~/api/services/extraction.service';
import { normalizeToBlocks } from '~/api/services/normalization.service';
import { publishStatus } from '~/api/services/sse.service';
import { env } from '~/config/enviroment';
import redis from '~/config/redis';
import { INGESTION_QUEUE_NAME } from '~/queues/ingestion.queue';
import SourceRepository from '~/prisma/repositories/source.repository';

// Ingestion worker: runs as a SEPARATE process (`yarn dev:worker`).
// It consumes `ingestion` jobs enqueued by the API server (source.service) and
// drives a source through the pipeline: added → extracting_text →
// indexing_evidence → ready (or failed). Each stage transition is persisted to
// the DB and published to Redis so SSE clients watching GET /sources/:id/status
// receive live progress events.
const worker = new Worker(
  INGESTION_QUEUE_NAME,
  async (job) => {
    const { sourceId } = job.data as { sourceId: string };

    const source = await SourceRepository.findById(sourceId);
    if (!source) {
      throw new Error(`Source not found: ${sourceId}`);
    }

    // Stage 1 — mark as extracting and clear any error from a previous attempt
    // (e.g. after a retry reset the source back to `added`).
    await SourceRepository.update(sourceId, {
      processingState: 'extracting_text',
      processingError: null
    });
    await publishStatus(sourceId, 'extracting_text');

    // Extract raw text based on the source type (PDF/DOCX/MD/Web/Manual).
    // This may download the file from MinIO (file sources) or fetch a URL (web).
    const result = await extract({
      sourceType: source.sourceType,
      sourceUrl: source.sourceUrl,
      content: source.content
    });

    // Persist the extracted text + metadata. Web extraction may also enrich the
    // title/author from the page <head> if the user left them blank.
    await SourceRepository.update(sourceId, {
      content: result.content,
      ...(result.title ? { title: result.title } : {}),
      ...(result.author ? { author: result.author } : {}),
      ...(result.pageCount !== undefined
        ? { pageCount: result.pageCount }
        : {}),
      characterCount: result.characterCount
    });

    // Stage 2 — mark as indexing (extraction done, semantic indexing underway).
    await SourceRepository.update(sourceId, {
      processingState: 'indexing_evidence'
    });
    await publishStatus(sourceId, 'indexing_evidence');

    // Stage 3 — normalize the text into blocks, then run the semantic chunking
    // pipeline (pre-split → embed units → cosine breakpoints → assemble
    // passages → embed passages → store Passage rows with pgvector vectors).
    if (result.content.trim().length > 0) {
      const blocks = normalizeToBlocks(result.content);
      await chunkAndEmbed(blocks, sourceId);
    }

    // Stage 4 — all passages stored and indexed → source is searchable.
    await SourceRepository.update(sourceId, {
      processingState: 'ready'
    });
    await publishStatus(sourceId, 'ready');
  },
  {
    connection: redis,
    concurrency: 2
  }
);

worker.on('completed', (job) => {
  console.log(`[worker] ingestion completed: ${job.id}`);
});

worker.on('failed', async (job, error) => {
  // Any throw inside the processor lands here (BullMQ retries up to the job's
  // `attempts` limit first). Mark the source failed + stream the error so the
  // UI can show the red badge and enable the Retry action.
  console.error(`[worker] ingestion failed: ${job?.id ?? 'unknown'}`, error);
  if (job) {
    const { sourceId } = job.data as { sourceId: string };
    await SourceRepository.update(sourceId, {
      processingState: 'failed',
      processingError: error.message
    }).catch(() => {});
    await publishStatus(sourceId, 'failed', error.message).catch(() => {});
  }
});

worker.on('error', (error) => {
  console.error('[worker] ingestion worker error', error);
});

console.log(
  `[worker] ingestion worker started (env=${env.NODE_ENV || 'development'})`
);
