import { useEffect, useRef } from 'react';

export function useRealtimeSync(onEvent: (eventType: string) => void, enabled = true) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: number | undefined;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as { type?: string };
          if (parsed.type && parsed.type !== 'connected') {
            callbackRef.current(parsed.type);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (closed) return;
        const delay = Math.min(10000, 1000 * Math.pow(1.6, attempt));
        attempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
    };
  }, [enabled]);
}
