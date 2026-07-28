declare module 'swagger-ui-express' {
  import { RequestHandler } from 'express';

  interface SwaggerUiOptions {
    customSiteTitle?: string;
  }

  const swaggerUi: {
    serve: RequestHandler[];
    setup(
      document: Record<string, unknown>,
      options?: SwaggerUiOptions
    ): RequestHandler;
  };

  export default swaggerUi;
}
