import { useEffect, useRef } from 'react';

export function useRealtimeSync(onEvent: (eventType: string) => void, enabled = true) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: number | undefined;
    let pollTimer: number | undefined;
    let attempt = 0;
    let wsConnectedOnce = false;

    const startPollingFallback = () => {
      if (closed || pollTimer !== undefined) return;
      pollTimer = window.setInterval(() => {
        if (!closed && document.visibilityState === 'visible') {
          callbackRef.current('poll');
        }
      }, 5000);
    };

    const stopPollingFallback = () => {
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };

    const handleVisibility = () => {
      if (!closed && document.visibilityState === 'visible' && pollTimer !== undefined) {
        callbackRef.current('poll');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      try {
        ws = new WebSocket(url);
      } catch {
        startPollingFallback();
        return;
      }

      ws.onopen = () => {
        attempt = 0;
        wsConnectedOnce = true;
        stopPollingFallback();
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
        // On serverless hosts (e.g., Vercel) where WebSockets aren't available, switch to HTTP polling immediately
        if (!wsConnectedOnce && attempt >= 1) {
          startPollingFallback();
          return;
        }
        startPollingFallback();
        const delay = Math.min(10000, 1000 * Math.pow(1.6, attempt));
        attempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (retryTimer) window.clearTimeout(retryTimer);
      stopPollingFallback();
      ws?.close();
    };
  }, [enabled]);
}
