import api from '~/api/index';
import { Application } from 'express';

import { env } from '~/config/enviroment';
import logger from '~/config/logger';
import { ensureBucket } from '~/api/utils/minio.util';

(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this as bigint);
};

async function startApiServer() {
  await ensureBucket();
  const app: Application = await api.server();
  app.listen(env.SERVER_PORT, () => {
    logger.info('API server started', {
      port: env.SERVER_PORT,
      environment: env.NODE_ENV
    });
  });
}

startApiServer();

process.on('uncaughtException', (e) => {
  logger.error('Uncaught exception', {
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined
  });
  process.exit(1);
});

process.on('unhandledRejection', (e) => {
  logger.error('Unhandled promise rejection', {
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined
  });
  process.exit(1);
});
