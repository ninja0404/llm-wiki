import * as Minio from 'minio';
import { config } from './config.js';
import { logger } from './logger.js';
import { Readable } from 'stream';

const minioUrl = new URL(config.minio.endpoint);

const client = new Minio.Client({
  endPoint: minioUrl.hostname,
  port: Number(minioUrl.port) || 9000,
  useSSL: minioUrl.protocol === 'https:',
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

const BUCKET = config.minio.bucket;

async function ensureBucket(): Promise<void> {
  const exists = await client.bucketExists(BUCKET);
  if (!exists) {
    await client.makeBucket(BUCKET);
    logger.info({ bucket: BUCKET }, 'MinIO bucket created');
  }
}

let bucketReady = false;

async function ready(): Promise<void> {
  if (bucketReady) return;
  await ensureBucket();
  bucketReady = true;
}

export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await ready();
  await client.putObject(BUCKET, key, buffer, buffer.length, {
    'Content-Type': contentType,
  });
  logger.info({ key, size: buffer.length }, 'File uploaded to MinIO');
  return key;
}

export async function getFileContent(key: string): Promise<string> {
  await ready();
  const stream = await client.getObject(BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function deleteFile(key: string): Promise<void> {
  await ready();
  await client.removeObject(BUCKET, key);
  logger.info({ key }, 'File deleted from MinIO');
}

export async function getFileStream(key: string): Promise<Readable> {
  await ready();
  return client.getObject(BUCKET, key) as Promise<Readable>;
}
