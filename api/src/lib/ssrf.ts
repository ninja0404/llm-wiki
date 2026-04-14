import { lookup } from 'dns/promises';

const BLOCKED_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^fc/i,
  /^fd/i,
  /^fe80/i,
  /^::1$/,
  /^::$/,
];

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

export async function validateUrl(urlStr: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SsrfError('Only HTTP(S) URLs are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(hostname)) {
    throw new SsrfError('This host is not allowed');
  }

  try {
    const { address } = await lookup(hostname);
    if (BLOCKED_RANGES.some((r) => r.test(address))) {
      throw new SsrfError('Internal network addresses are not allowed');
    }
  } catch (err) {
    if (err instanceof SsrfError) throw err;
    throw new SsrfError('Could not resolve hostname');
  }
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export async function fetchUrl(url: string): Promise<string> {
  await validateUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'LLM-Wiki/1.0' },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
      throw new Error('Response too large (>10MB)');
    }

    return res.text();
  } finally {
    clearTimeout(timeout);
  }
}
