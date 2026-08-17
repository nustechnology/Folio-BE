// Re-index every source against the current embedding model. Passage vectors
// are only comparable at the same model and width, so a change to
// MODEL_EMBEDDING_MODEL/DIMENSIONS invalidates everything indexed before it.
//
// Default mode re-runs normalize → chunk → embed from the text already stored
// on each source: embedding calls only, no MinIO downloads or OCR. Use
// `--reextract` when the parser changed and the stored text must be rebuilt
// too; that mode enqueues jobs, so the worker has to be running. `--help`
// lists the filters.
import pLimit from 'p-limit';

import { chunkAndEmbed } from '~/api/services/chunking.service';
import { normalizeToBlocks } from '~/api/services/normalization.service';
import { publishStatus } from '~/api/services/sse.service';
import { env } from '~/config/enviroment';
import logger from '~/config/logger';
import redis from '~/config/redis';
import prisma from '~/prisma/prisma.client';
import PassageRepository from '~/prisma/repositories/passage.repository';
import SourceRepository from '~/prisma/repositories/source.repository';
import { enqueueIngestion, ingestionQueue } from '~/queues/ingestion.queue';
import type { ProcessingState } from '~/generated/prisma/enums';

// The width `Passage.embedding` was migrated to. `model-gateway.service` checks
// this against what the provider actually returns; this script checks it against
// the column, so a half-applied model swap is caught before it rewrites the
// index.
const EMBEDDING_DIMENSIONS = Number(env.MODEL_EMBEDDING_DIMENSIONS);

const PROCESSING_STATES: ProcessingState[] = [
  'added',
  'extracting_text',
  'indexing_evidence',
  'ready',
  'failed'
];

type Options = {
  spaceId?: string;
  sourceIds: string[];
  processingState?: ProcessingState;
  reextract: boolean;
  concurrency: number;
  dryRun: boolean;
};

const USAGE = `
Re-index sources against the current embedding model
(${env.MODEL_EMBEDDING_MODEL} @ ${env.MODEL_EMBEDDING_DIMENSIONS} dimensions).

Usage: yarn reingest [options]

  --space <spaceId>     only sources in this research space
  --source <sourceId>   only this source (repeatable)
  --state <state>       only sources in this processing state
                        (${PROCESSING_STATES.join(' | ')})
  --reextract           re-run the FULL pipeline through the ingestion queue
                        (re-downloads and re-parses each file; requires
                        \`yarn dev:worker\` to be running)
  --concurrency <n>     sources processed in parallel, direct mode (default 2)
  --dry-run             print what would happen, change nothing
  -h, --help            show this help
`;

const parseArgs = (argv: string[]): Options => {
  const options: Options = {
    sourceIds: [],
    reextract: false,
    concurrency: 2,
    dryRun: false
  };

  // Reject a missing value instead of consuming the following flag.
  const readValue = (flag: string, index: number): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--space':
        options.spaceId = readValue(arg, i++);
        break;
      case '--source':
        options.sourceIds.push(readValue(arg, i++));
        break;
      case '--state': {
        const value = readValue(arg, i++) as ProcessingState;
        if (!PROCESSING_STATES.includes(value)) {
          throw new Error(
            `--state must be one of: ${PROCESSING_STATES.join(', ')}`
          );
        }
        options.processingState = value;
        break;
      }
      case '--concurrency': {
        const value = Number(readValue(arg, i++));
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error('--concurrency must be a positive integer');
        }
        options.concurrency = value;
        break;
      }
      case '--reextract':
        options.reextract = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

// Abort before spending embedding calls if the column is still the old width.
const assertSchemaMatchesModel = async (): Promise<void> => {
  const columnDimensions = await PassageRepository.getEmbeddingDimensions();
  if (columnDimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Passage.embedding is vector(${columnDimensions}) but MODEL_EMBEDDING_DIMENSIONS is ${EMBEDDING_DIMENSIONS}. ` +
        'Apply the pending migrations first (`yarn db:migrate` in dev, `yarn db:migrate-prod` otherwise).'
    );
  }
};

// Rebuild one source's passages from its stored text. Mirrors stage 3-4 of the
// worker, SSE events included, so an open sources list follows along.
const reembedSource = async (sourceId: string): Promise<'done' | 'skipped'> => {
  const source = await SourceRepository.findById(sourceId);
  if (!source) {
    throw new Error('source disappeared while re-indexing');
  }

  if (!source.content.trim()) {
    return 'skipped';
  }

  await SourceRepository.update(sourceId, {
    processingState: 'indexing_evidence',
    processingError: null
  });
  await publishStatus(sourceId, 'indexing_evidence');

  await chunkAndEmbed(normalizeToBlocks(source.content), sourceId);

  await SourceRepository.update(sourceId, { processingState: 'ready' });
  await publishStatus(sourceId, 'ready');

  return 'done';
};

const run = async (): Promise<number> => {
  const options = parseArgs(process.argv.slice(2));

  const sources = await SourceRepository.findManyForReindex({
    spaceId: options.spaceId,
    sourceIds: options.sourceIds,
    processingState: options.processingState
  });

  logger.info('[Reingest] Starting re-index', {
    mode: options.reextract ? 'reextract (queued)' : 'reembed (direct)',
    model: env.MODEL_EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    sourceCount: sources.length,
    dryRun: options.dryRun
  });

  if (sources.length === 0) {
    logger.warn('[Reingest] No sources matched the given filters');
    return 0;
  }

  if (options.dryRun) {
    for (const source of sources) {
      logger.info(`[Reingest] would re-index ${source.id} — ${source.title}`, {
        sourceType: source.sourceType,
        processingState: source.processingState,
        characterCount: source.characterCount
      });
    }
    return 0;
  }

  // Both modes end in an INSERT of vectors of this width — reembed does it here,
  // reextract does it later in the worker. Checking up front in both cases turns
  // a stale column into one clear error before anything is touched, instead of
  // every queued source failing on a raw Postgres type error mid-run.
  await assertSchemaMatchesModel();

  let done = 0;
  let skipped = 0;
  const failures: { id: string; title: string; error: string }[] = [];

  if (options.reextract) {
    // Back to `added` so the worker restarts from extraction. Passages are
    // replaced transactionally at the end of that run, so nothing is dropped.
    for (const source of sources) {
      try {
        await SourceRepository.update(source.id, {
          processingState: 'added',
          processingError: null
        });
        await publishStatus(source.id, 'added');
        await enqueueIngestion(source.id);
        done++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The state has already been moved to `added` by this point, so a
        // failure here — the queue being unreachable, typically — would strand
        // the source: shown as pending forever, with no job in existence to
        // advance it. Recording it as failed is what makes it visible and
        // retryable. Both writes are best-effort; whatever broke the enqueue
        // has usually taken Redis with it.
        await SourceRepository.update(source.id, {
          processingState: 'failed',
          processingError: message
        }).catch(() => {});
        await publishStatus(source.id, 'failed', message).catch(() => {});

        failures.push({
          id: source.id,
          title: source.title,
          error: message
        });
      }
    }

    logger.info('[Reingest] Queued full re-ingestion', {
      queued: done,
      failed: failures.length,
      note: 'progress continues in the ingestion worker (`yarn dev:worker`)'
    });
  } else {
    const limit = pLimit(options.concurrency);
    let index = 0;

    await Promise.all(
      sources.map((source) =>
        limit(async () => {
          const position = ++index;
          try {
            const outcome = await reembedSource(source.id);
            if (outcome === 'skipped') {
              skipped++;
              logger.warn(
                `[Reingest] ${position}/${sources.length} skipped "${source.title}" — no extracted text stored; re-run with --reextract`,
                { sourceId: source.id }
              );
              return;
            }
            done++;
            const passageCount = await PassageRepository.countBySourceId(
              source.id
            );
            logger.info(
              `[Reingest] ${position}/${sources.length} re-indexed "${source.title}"`,
              { sourceId: source.id, passageCount }
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            failures.push({
              id: source.id,
              title: source.title,
              error: message
            });
            await SourceRepository.update(source.id, {
              processingState: 'failed',
              processingError: message
            }).catch(() => {});
            await publishStatus(source.id, 'failed', message).catch(() => {});
            logger.error(
              `[Reingest] ${position}/${sources.length} FAILED "${source.title}"`,
              { sourceId: source.id, error: message }
            );
          }
        })
      )
    );
  }

  logger.info('[Reingest] Finished', {
    total: sources.length,
    done,
    skipped,
    failed: failures.length
  });

  for (const failure of failures) {
    logger.error(`[Reingest] ${failure.id} — ${failure.title}`, {
      error: failure.error
    });
  }

  return failures.length > 0 ? 1 : 0;
};

// The queue, Redis and Prisma all hold the event loop open.
run()
  .then(async (exitCode) => {
    await ingestionQueue.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    redis.disconnect();
    process.exit(exitCode);
  })
  .catch(async (error) => {
    logger.error('[Reingest] Aborted', {
      error: error instanceof Error ? error.message : String(error)
    });
    await ingestionQueue.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    redis.disconnect();
    process.exit(1);
  });
