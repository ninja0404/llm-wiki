import { useEffect, useRef, useCallback, useState } from 'react';
import type { WsMessage } from '@llm-wiki/shared';
import { WS_RECONNECT_MIN_MS, WS_RECONNECT_MAX_MS } from '@llm-wiki/shared';

interface UseWsOptions {
  workspaceId: string | null;
  onMessage?: (message: WsMessage) => void;
}

export function useWs({ workspaceId, onMessage }: UseWsOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectDelayRef = useRef(WS_RECONNECT_MIN_MS);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (!workspaceId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?workspaceId=${workspaceId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelayRef.current = WS_RECONNECT_MIN_MS;
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WsMessage;
        onMessage?.(message);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;

      const delay = Math.min(
        reconnectDelayRef.current * 2,
        WS_RECONNECT_MAX_MS,
      );
      reconnectDelayRef.current = delay;

      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [workspaceId, onMessage]);

  useEffect(() => {
    connect();

    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((message: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, send };
}
