import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

dotenvConfig({ path: resolve(import.meta.dirname, '../../../.env') });

const port = Number(process.env.PORT || 3001);

export const config = {
  port,
  wsPort: Number(process.env.WS_PORT || 3002),
  nodeEnv: process.env.NODE_ENV || 'development',
  baseUrl: process.env.BASE_URL || `http://localhost:${port}`,
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()),
  trustedOrigins: (process.env.TRUSTED_ORIGINS || process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://llmwiki:llmwiki@localhost:5432/llmwiki',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  betterAuthSecret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-in-production',
  encryptionKey: process.env.ENCRYPTION_KEY || '0'.repeat(64),
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    bucket: process.env.MINIO_BUCKET || 'llmwiki',
  },
  openaiApiKey: process.env.OPENAI_API_KEY || '',
} as const;
