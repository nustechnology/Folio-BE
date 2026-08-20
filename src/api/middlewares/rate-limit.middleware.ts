import { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { RATE_LIMIT, WRITE_METHODS } from '~/api/utils/constants';
import { verifyAccessToken } from '~/api/utils/token.util';

/**
 * The limiter runs ahead of `auth`, so `req.userId` is not populated yet and
 * the bearer token has to be read here. This verifies rather than decodes on
 * purpose: an unverified `sub` is attacker-chosen, which would let a client
 * mint a fresh bucket for every request and defeat the limit entirely.
 *
 * A failure here is not an authentication decision. An expired or forged token
 * falls through to the address bucket, and `auth` rejects it properly a layer
 * later with the right status and code.
 */
const identifyClient = (req: Request): string | undefined => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return undefined;

  try {
    return verifyAccessToken(token).sub;
  } catch {
    return undefined;
  }
};

/**
 * Writes only.
 *
 * Reads are cheap, and more importantly `GET /api/v1/sources/status` is a
 * long-lived SSE stream: a limiter that counted it would hold a store entry
 * for the lifetime of the connection, and a client reconnecting on every
 * network blip would burn through the window. The `skip` predicate below is
 * the only thing preventing that — do not widen it to reads.
 *
 * `OPTIONS` never arrives here either: `cors` terminates preflights above this
 * middleware, and `OPTIONS` is not a write method regardless.
 */
export const writeRateLimiter = rateLimit({
  windowMs: RATE_LIMIT.WRITE_WINDOW_MS,
  limit: RATE_LIMIT.WRITE_MAX_REQUESTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false,

  skip: (req) => !WRITE_METHODS.has(req.method),

  /* Per user rather than per address: everyone behind one office NAT or one
     ngrok tunnel shares an IP, and the notebook auto-save fires often enough
     that a shared bucket would throttle ordinary typing. Supplying a custom
     `keyGenerator` also suppresses the library's `trust proxy` validations,
     which is why this app needs no `app.set('trust proxy', ...)`. */
  keyGenerator: (req) =>
    identifyClient(req) ?? ipKeyGenerator(req.ip ?? '', 56),

  /* Hand the rejection to the global error handler instead of writing the
     library's plain-text 429, so a throttled auto-save sees the same
     `{ status, message, code }` envelope as every other failure and can branch
     on `RATE_LIMIT_EXCEEDED` rather than sniffing a status code.

     `Retry-After` is already on the response by this point — the library sets
     it before invoking this handler whenever either header mode is enabled. */
  handler: (_req, _res, next) => {
    next(
      new AppError(
        'Too many requests. Please wait a moment and try again.',
        StatusCodes.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMIT_EXCEEDED
      )
    );
  }
});
