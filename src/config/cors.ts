import { CorsOptions } from 'cors';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { env } from './enviroment';

const allowedOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Hostname suffixes of the HTTPS tunnel providers accepted in development. */
const TUNNEL_HOST_SUFFIXES = [
  '.ngrok.app',
  '.ngrok-free.app',
  '.ngrok-free.dev',
  '.ngrok.io',
  '.trycloudflare.com'
];

// Tunnels hand out a new hostname per session, so development accepts them by
// suffix instead of asking for CORS_ORIGIN to be re-edited every restart.
// Exact match against 'development' so this fails closed for any other value.
const allowTunnels = env.NODE_ENV === 'development';

function isTunnelOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;

  return TUNNEL_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
}

function isOriginAllowed(origin: string): boolean {
  if (allowedOrigins.includes(origin)) return true;
  return allowTunnels && isTunnelOrigin(origin);
}

export const corsOptions: CorsOptions = {
  origin: function (origin, callback) {
    if (!origin || isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      // AppError so this is reported as a 403, not the 500 a bare Error gets.
      callback(
        new AppError(
          `CORS policy: origin ${origin} is not allowed`,
          StatusCodes.FORBIDDEN
        )
      );
    }
  }
};
