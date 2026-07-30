import { CorsOptions } from 'cors';
import { env } from './enviroment';

export const corsOptions: CorsOptions = {
  origin: function (origin, callback) {
    if (!origin || env.CORS_ORIGIN.split(',').indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: This origin is not allowed by CORS'));
    }
  }
};
