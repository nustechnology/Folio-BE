import winston from 'winston';

import { env } from './enviroment.js';
import { requestContext } from './request-context.js';

const addRequestContext = winston.format((info) => {
  const context = requestContext.getStore();

  if (context) {
    info.requestId = context.requestId;
  }

  return info;
});

const developmentFormat = winston.format.printf(
  ({ timestamp, level, message, stack, ...metadata }) => {
    const details =
      Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : '';
    return `${timestamp} ${level}: ${stack || message}${details}`;
  }
);

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    addRequestContext(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    env.NODE_ENV === 'production'
      ? winston.format.json()
      : winston.format.combine(
          winston.format.colorize(),
          developmentFormat
        )
  ),
  defaultMeta: {
    service: 'nus-express-api',
  },
  transports: [new winston.transports.Console()],
});

export default logger;
