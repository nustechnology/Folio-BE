import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '~/api/docs/openapi';
import { errorHandler } from '~/api/middlewares/error.middleware';
import { writeRateLimiter } from '~/api/middlewares/rate-limit.middleware';
import { requestLogger } from '~/api/middlewares/request-logger.middleware';
import routes from '~/api/routes/index';
import { JSON_BODY_LIMIT } from '~/api/utils/constants';
import { corsOptions } from '~/config/cors';

interface ApiInterface {
  server(): Promise<Application>;
}

class Api implements ApiInterface {
  async server(): Promise<Application> {
    const app = express();
    app.use(requestLogger);

    app.use(cors(corsOptions));

    app.use(writeRateLimiter);

    app.use(express.json({ limit: JSON_BODY_LIMIT }));

    app.use(express.urlencoded({ extended: true }));
    app.get('/api-docs.json', (_req: Request, res: Response) => {
      res.json(openApiDocument);
    });
    app.use(
      '/api-docs',
      ...swaggerUi.serve,
      swaggerUi.setup(openApiDocument, {
        customSiteTitle: 'Folio API Docs'
      })
    );
    app.use('/api/v1', routes);

    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/', (_req: Request, res: Response) => {
      res.send('Welcome to NUS express application!');
    });
    app.use(errorHandler);
    return app;
  }
}

export default new Api();
