import { useEffect, useRef } from 'react';
import {
  EventDeduplicator,
  isEventRelevantToScope,
  normalizeIncomingRealtimeEvent,
  type ClientRealtimeScope,
  type RealtimeConnectionStatus,
  type RealtimeScopeEvent,
} from '../lib/realtimeEvents';
import { startSupabaseRealtimeSubscription } from '../lib/supabaseRealtime';

export interface UseRealtimeSyncOptions {
  enabled?: boolean;
  scope?: ClientRealtimeScope;
  qrToken?: string;
  onStatusChange?: (status: RealtimeConnectionStatus) => void;
}

export function useRealtimeSync(
  onEvent: (event: RealtimeScopeEvent) => void,
  optionsOrEnabled: boolean | UseRealtimeSyncOptions = true
) {
  const options: UseRealtimeSyncOptions =
    typeof optionsOrEnabled === 'boolean'
      ? { enabled: optionsOrEnabled }
      : optionsOrEnabled;

  const enabled = options.enabled ?? true;
  const scopePortal = options.scope?.portal ?? 'manager';
  const scopeTableId = options.scope?.tableId;
  const scopeSessionId = options.scope?.sessionId;
  const scopeStaffId = options.scope?.staffId;
  const scopeStationId = options.scope?.stationId;
  const assignedKey = (options.scope?.assignedTableIds || []).join(',');
  const qrToken = options.qrToken;

  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  const statusCallbackRef = useRef(options.onStatusChange);
  statusCallbackRef.current = options.onStatusChange;

  const scopeRef = useRef<ClientRealtimeScope>({
    portal: scopePortal,
    tableId: scopeTableId,
    sessionId: scopeSessionId,
    staffId: scopeStaffId,
    stationId: scopeStationId,
    assignedTableIds: options.scope?.assignedTableIds,
  });
  scopeRef.current = {
    portal: scopePortal,
    tableId: scopeTableId,
    sessionId: scopeSessionId,
    staffId: scopeStaffId,
    stationId: scopeStationId,
    assignedTableIds: options.scope?.assignedTableIds,
  };

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: number | undefined;
    let pollTimer: number | undefined;
    let attempt = 0;
    let wsConnectedOnce = false;
    let wsConnected = false;
    let sbConnected = false;
    let currentStatus: RealtimeConnectionStatus = navigator.onLine ? 'reconnecting' : 'offline';

    const deduper = new EventDeduplicator(15000, 300);

    const emitStatus = (next: RealtimeConnectionStatus) => {
      if (next !== currentStatus) {
        const prev = currentStatus;
        currentStatus = next;
        statusCallbackRef.current?.(next);
        if (next === 'connected' && (prev === 'offline' || prev === 'reconnecting')) {
          triggerCatchup('reconnect_catchup');
        }
      }
    };

    const recomputeStatus = () => {
      if (!navigator.onLine) {
        emitStatus('offline');
        return;
      }
      if (wsConnected || sbConnected) {
        emitStatus('connected');
        stopPollingFallback();
      } else {
        emitStatus('reconnecting');
        startPollingFallback();
      }
    };

    const dispatchRawEvent = (raw: unknown) => {
      if (closed) return;
      const event = normalizeIncomingRealtimeEvent(raw);
      if (!deduper.shouldProcess(event.eventId)) return;
      if (!isEventRelevantToScope(event, scopeRef.current)) return;
      callbackRef.current(event);
    };

    const triggerCatchup = (reason: string) => {
      if (closed || !navigator.onLine) return;
      callbackRef.current({
        eventId: `catchup:${reason}:${Date.now()}`,
        type: 'snapshot:updated',
        reason,
        entity: 'snapshot',
        timestamp: new Date().toISOString(),
      });
    };

    const startPollingFallback = () => {
      if (closed || pollTimer !== undefined) return;
      pollTimer = window.setInterval(() => {
        if (!closed && navigator.onLine && document.visibilityState === 'visible') {
          triggerCatchup('poll_fallback');
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
      if (!closed && document.visibilityState === 'visible') {
        triggerCatchup('tab_focus_catchup');
      }
    };

    const handleOnline = () => {
      recomputeStatus();
      triggerCatchup('network_online_catchup');
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (ws) {
          try {
            ws.onclose = null;
            ws.close();
          } catch {
            // ignore
          }
          ws = null;
        }
        attempt = 0;
        connectWs();
      }
    };

    const handleOffline = () => {
      wsConnected = false;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      if (ws) {
        try {
          ws.onclose = null;
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
      recomputeStatus();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const stopSupabase = startSupabaseRealtimeSubscription({
      scope: scopeRef.current,
      qrToken,
      onEvent: dispatchRawEvent,
      onSubscribedChange: (subscribed) => {
        sbConnected = subscribed;
        recomputeStatus();
      },
    });

    const connectWs = () => {
      if (closed || !navigator.onLine) return;
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return;
      }
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      try {
        ws = new WebSocket(url);
      } catch {
        wsConnected = false;
        recomputeStatus();
        return;
      }

      ws.onopen = () => {
        attempt = 0;
        wsConnectedOnce = true;
        wsConnected = true;
        recomputeStatus();
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as { type?: string };
          if (parsed.type && parsed.type !== 'connected') {
            dispatchRawEvent(parsed);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        ws = null;
        wsConnected = false;
        if (closed) return;
        recomputeStatus();
        // On serverless hosts (e.g., Vercel) where WebSockets aren't available, rely on Supabase Realtime + polling fallback
        if (!wsConnectedOnce && attempt >= 1) {
          return;
        }
        const delay = Math.min(10000, 1000 * Math.pow(1.6, attempt));
        attempt += 1;
        retryTimer = window.setTimeout(connectWs, delay);
      };
    };

    statusCallbackRef.current?.(currentStatus);
    connectWs();

    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (retryTimer) window.clearTimeout(retryTimer);
      stopPollingFallback();
      stopSupabase();
      ws?.close();
    };
  }, [
    enabled,
    scopePortal,
    scopeTableId,
    scopeSessionId,
    scopeStaffId,
    scopeStationId,
    assignedKey,
    qrToken,
  ]);
}
