import type { WSContext } from 'hono/ws';
import { redis } from './redis.js';
import { logger } from './logger.js';
import type { WsMessage } from '@llm-wiki/shared';
import Redis from 'ioredis';
import { config } from './config.js';

interface WsClient {
  ws: WSContext;
  userId: string;
  workspaceId: string;
}

const rooms = new Map<string, Set<WsClient>>();
let subscriber: Redis | null = null;

export function addToRoom(workspaceId: string, client: WsClient) {
  if (!rooms.has(workspaceId)) {
    rooms.set(workspaceId, new Set());
  }
  rooms.get(workspaceId)!.add(client);
  logger.debug({ workspaceId, userId: client.userId }, 'WS client joined room');
}

export function removeFromRoom(workspaceId: string, client: WsClient) {
  const room = rooms.get(workspaceId);
  if (room) {
    room.delete(client);
    if (room.size === 0) {
      rooms.delete(workspaceId);
    }
  }
  logger.debug({ workspaceId, userId: client.userId }, 'WS client left room');
}

export function broadcastToRoom(workspaceId: string, message: WsMessage) {
  const room = rooms.get(workspaceId);
  if (!room) return;

  const payload = JSON.stringify(message);
  for (const client of room) {
    try {
      client.ws.send(payload);
    } catch {
      room.delete(client);
    }
  }
}

export async function publishMessage(workspaceId: string, message: WsMessage) {
  broadcastToRoom(workspaceId, message);

  try {
    await redis.publish(
      `ws:${workspaceId}`,
      JSON.stringify(message),
    );
  } catch {
    // local-only if Redis unavailable
  }
}

export async function initWsSubscriber() {
  try {
    subscriber = new Redis(config.redisUrl);

    subscriber.on('message', (channel: string, data: string) => {
      const workspaceId = channel.replace('ws:', '');
      try {
        const message = JSON.parse(data) as WsMessage;
        broadcastToRoom(workspaceId, message);
      } catch {
        logger.warn({ channel }, 'Invalid WS message from Redis');
      }
    });

    subscriber.on('error', (err) => {
      logger.error({ err }, 'WS subscriber error');
    });

    logger.info('WS Redis subscriber initialized');
  } catch (err) {
    logger.warn({ err }, 'WS Redis subscriber failed to initialize');
  }
}

export async function subscribeToWorkspace(workspaceId: string) {
  if (subscriber) {
    await subscriber.subscribe(`ws:${workspaceId}`);
  }
}

export async function unsubscribeFromWorkspace(workspaceId: string) {
  if (subscriber && !rooms.has(workspaceId)) {
    await subscriber.unsubscribe(`ws:${workspaceId}`);
  }
}

export function getConnectionCount(): number {
  let count = 0;
  for (const room of rooms.values()) {
    count += room.size;
  }
  return count;
}
