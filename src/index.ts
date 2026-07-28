import api from './api/index.js';
import { Application } from 'express';
import { env } from './config/enviroment.js';
import logger from './config/logger.js';

async function startApiServer() {
  const app: Application = await api.server();
  app.listen(env.SERVER_PORT, () => {
    logger.info('API server started', {
      port: env.SERVER_PORT,
      environment: env.NODE_ENV,
    });
  });
}

startApiServer();

process.on("uncaughtException", e => {
  logger.error('Uncaught exception', {
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined,
  });
  process.exit(1);
});

process.on("unhandledRejection", e => {
  logger.error('Unhandled promise rejection', {
    error: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack : undefined,
  });
  process.exit(1);
});
