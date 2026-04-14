import Redis from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    return Math.min(times * 200, 5000);
  },
});

redis.on('error', (err) => {
  logger.error({ err: err.message }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});
