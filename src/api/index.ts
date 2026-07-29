import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '~/api/docs/openapi';
import { errorHandler } from '~/api/middlewares/error.middleware';
import { requestLogger } from '~/api/middlewares/request-logger.middleware';
import routes from '~/api/routes/index';

interface ApiInterface {
  server(): Promise<Application>;
}

class Api implements ApiInterface {
  async server(): Promise<Application> {
    const app = express();
    app.use(requestLogger);
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.get('/api-docs.json', (_req: Request, res: Response) => {
      res.json(openApiDocument);
    });
    app.use(
      '/api-docs',
      ...swaggerUi.serve,
      swaggerUi.setup(openApiDocument, {
        customSiteTitle: 'Express Prisma API Docs',
      })
    );
    app.use('/api/v1', routes);

    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/', (_req: Request, res: Response) => {
      res.send('Welcome to NUS express application!');
    });
    app.use(cors());
    app.use(errorHandler);
    return app;
  }
}

export default new Api();
