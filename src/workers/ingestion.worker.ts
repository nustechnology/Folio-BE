import { Worker } from 'bullmq';

import { chunkAndEmbed } from '~/api/services/chunking.service';
import { extract } from '~/api/services/extraction.service';
import { normalizeToBlocks } from '~/api/services/normalization.service';
import { publishStatus } from '~/api/services/sse.service';
import { env } from '~/config/enviroment';
import redis from '~/config/redis';
import { INGESTION_QUEUE_NAME } from '~/queues/ingestion.queue';
import SourceRepository from '~/prisma/repositories/source.repository';
import logger from '~/config/logger';
import { OcrError } from '~/api/services/ocr.service';

// Ingestion worker: runs as a SEPARATE process (`yarn dev:worker`).
// It consumes `ingestion` jobs enqueued by the API server (source.service) and
// drives a source through the pipeline: added → extracting_text →
// indexing_evidence → ready (or failed). Each stage transition is persisted to
// the DB and published to Redis so SSE clients watching GET /sources/:id/status
// receive live progress events.
const worker = new Worker(
  INGESTION_QUEUE_NAME,
  async (job) => {
    const { sourceId, forceReparse } = job.data as {
      sourceId: string;
      forceReparse?: boolean;
    };
    logger.info('[Worker] Ingestion job picked up by worker', {
      jobId: job.id,
      sourceId
    });

    const source = await SourceRepository.findById(sourceId);
    if (!source) {
      logger.error('[Worker] Source not found in database', {
        sourceId,
        jobId: job.id
      });
      throw new Error(`Source not found: ${sourceId}`);
    }

    logger.debug('[Worker] Updating source state to extracting_text', {
      sourceId,
      title: source.title
    });
    // Stage 1 — mark as extracting and clear any error from a previous attempt
    // (e.g. after a retry reset the source back to `added`).
    await SourceRepository.update(sourceId, {
      processingState: 'extracting_text',
      processingError: null
    });
    await publishStatus(sourceId, 'extracting_text');

    logger.info('[Worker] Invoking text extraction service', {
      sourceId,
      sourceType: source.sourceType,
      fileName: source.fileName,
      fileType: source.fileType
    });

    // Extract raw text based on the source type (PDF/DOCX/MD/Web/Manual).
    // This may download the file from MinIO (file sources) or fetch a URL (web).
    let result;
    try {
      result = await extract({
        sourceId: source.id,
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        content: source.content,
        fileType: source.fileType,
        fileHash: source.fileHash,
        forceReparse
      });
    } catch (error: any) {
      if (error instanceof OcrError || error.name === 'OcrError') {
        logger.error(
          '[Worker] OCR process failed. Discarding job immediately.',
          {
            sourceId,
            error: error.message
          }
        );
        await SourceRepository.update(sourceId, {
          processingState: 'failed',
          processingError: error.message
        }).catch((err) => {
          logger.error(
            '[Worker] Failed to update source error state during OCR failure',
            {
              sourceId,
              err
            }
          );
        });
        await publishStatus(sourceId, 'failed', error.message).catch((err) => {
          logger.error(
            '[Worker] Failed to publish OCR failure status via SSE',
            {
              sourceId,
              err
            }
          );
        });
        job.discard();
      }
      throw error;
    }

    logger.info('[Worker] Text extraction completed successfully', {
      sourceId,
      characterCount: result.characterCount,
      hasStructuredContent: !!result.structuredContent,
      structuredType: result.structuredContent?.type
    });

    // Persist the extracted text + metadata. A title/author discovered during
    // extraction only fills fields left at their default, so one the uploader
    // typed is never silently replaced.
    const hasDefaultTitle =
      !source.title.trim() ||
      source.title === source.fileName ||
      source.title.startsWith('Untitled Source - ');
    const hasDefaultAuthor =
      !source.author?.trim() || source.author === 'Unknown Author';

    await SourceRepository.update(sourceId, {
      content: result.content,
      structuredContent: result.structuredContent || null,
      ...(result.title && hasDefaultTitle ? { title: result.title } : {}),
      ...(result.author && hasDefaultAuthor ? { author: result.author } : {}),
      ...(result.pageCount !== undefined
        ? { pageCount: result.pageCount }
        : {}),
      characterCount: result.characterCount
    });

    logger.debug('[Worker] Updating source state to indexing_evidence', {
      sourceId
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
      logger.info(
        '[Worker] Starting text normalization and semantic chunking',
        {
          sourceId,
          contentLength: result.content.length
        }
      );
      const blocks = normalizeToBlocks(result.content);
      logger.debug(
        '[Worker] Text normalized into blocks. Emitting chunking pipeline',
        {
          sourceId,
          blockCount: blocks.length
        }
      );
      await chunkAndEmbed(blocks, sourceId);
      logger.info('[Worker] Chunking and embedding pipeline finished', {
        sourceId
      });
    } else {
      logger.warn(
        '[Worker] Content is empty, skipping chunking and indexing steps',
        { sourceId }
      );
    }

    logger.debug('[Worker] Updating source state to ready', { sourceId });
    // Stage 4 — all passages stored and indexed → source is searchable.
    await SourceRepository.update(sourceId, {
      processingState: 'ready'
    });
    await publishStatus(sourceId, 'ready');
    logger.info('[Worker] Ingestion job fully completed', {
      jobId: job.id,
      sourceId
    });
  },
  {
    connection: redis,
    concurrency: 2,
    // The lock renews on a timer, so waiting (OCR, embeddings) is safe but
    // holding the event loop is not — pdfjs layout reconstruction and the
    // per-page marked/JSDOM pass both do, past the 30s default on a big file.
    lockDuration: 120_000,
    // A stall means the worker died, not that the job is bad. At the default of
    // 1, one crash or a badly-timed redeploy fails the source permanently, as an
    // UnrecoverableError that bypasses the queue's `attempts: 3`.
    maxStalledCount: 3
  }
);

// A stalled job is reaped by a different worker, so the one that lost the lock
// never reports anything — without this, "the worker vanished" is invisible.
worker.on('stalled', (jobId) => {
  logger.warn(
    '[Worker] Job lock expired — worker died or blocked the event loop',
    {
      jobId
    }
  );
});

worker.on('completed', (job) => {
  logger.info(`[Worker] Job completed: ${job.id}`);
});

worker.on('failed', async (job, error) => {
  // Any throw inside the processor lands here (BullMQ retries up to the job's
  // `attempts` limit first). Mark the source failed + stream the error so the
  // UI can show the red badge and enable the Retry action.
  logger.error(`[Worker] Job failed: ${job?.id ?? 'unknown'}`, {
    jobId: job?.id,
    error: error.message,
    stack: error.stack
  });
  if (job) {
    const { sourceId } = job.data as { sourceId: string };
    await SourceRepository.update(sourceId, {
      processingState: 'failed',
      processingError: error.message
    }).catch((err) => {
      logger.error('[Worker] Failed to update source error state', {
        sourceId,
        err
      });
    });
    await publishStatus(sourceId, 'failed', error.message).catch((err) => {
      logger.error('[Worker] Failed to publish source error status via SSE', {
        sourceId,
        err
      });
    });
  }
});

worker.on('error', (error) => {
  logger.error('[Worker] Ingestion worker error encountered', error);
});

// index.ts installs these for the API server; the worker had none, so a stray
// rejection killed it silently and the job it held surfaced a minute later as a
// stall. Cannot catch a native abort, but a JS-level crash now says so.
process.on('uncaughtException', (e) => {
  logger.error('[Worker] Uncaught exception', {
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined
  });
  process.exit(1);
});

process.on('unhandledRejection', (e) => {
  logger.error('[Worker] Unhandled promise rejection', {
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined
  });
  process.exit(1);
});

logger.info(
  `[Worker] Ingestion worker started (env=${env.NODE_ENV || 'development'})`
);
