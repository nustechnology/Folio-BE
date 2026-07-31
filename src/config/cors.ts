import { CorsOptions } from 'cors';
import { env } from './enviroment';

const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) =>
  origin.trim()
);

export const corsOptions: CorsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: This origin is not allowed by CORS'));
    }
  }
};
