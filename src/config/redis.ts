import { Redis } from 'ioredis';

import { env } from '~/config/enviroment';

// Shared Redis client singleton, used by BullMQ (queue + worker) and the SSE
// pub/sub bridge. `maxRetriesPerRequest: null` is required by BullMQ so queue
// commands don't fail when Redis is temporarily unreachable.
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

const connection = new Redis({
  host: env.REDIS_HOST,
  port: Number(env.REDIS_PORT),
  maxRetriesPerRequest: null
});

const redis = globalForRedis.redis ?? connection;

// Reuse the connection across hot-reloads in dev (tsx watch) to avoid leaking
// connections on every file change.
if (env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

export default redis;
