import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { api } from '../services/api';
import type { ClientRealtimeScope, RealtimeEntity } from './realtimeEvents';

type RealtimeConfigResponse = Awaited<ReturnType<typeof api.getRealtimeConfig>>;

let cachedConfigPromise: Promise<RealtimeConfigResponse> | null = null;
let cachedSupabaseClient: { url: string; anonKey: string; client: SupabaseClient } | null = null;

function getRealtimeConfigCached(): Promise<RealtimeConfigResponse> {
  if (!cachedConfigPromise) {
    cachedConfigPromise = api.getRealtimeConfig().catch((err) => {
      cachedConfigPromise = null;
      throw err;
    });
  }
  return cachedConfigPromise;
}

function getOrCreateSupabaseClient(url: string, anonKey: string): SupabaseClient {
  if (
    cachedSupabaseClient &&
    cachedSupabaseClient.url === url &&
    cachedSupabaseClient.anonKey === anonKey
  ) {
    return cachedSupabaseClient.client;
  }
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 20,
      },
    },
  });
  cachedSupabaseClient = { url, anonKey, client };
  return client;
}

function mapPgTableToEntity(table: string): RealtimeEntity {
  switch (table) {
    case 'restaurant_tables':
      return 'table';
    case 'table_verification_requests':
      return 'verification';
    case 'table_sessions':
      return 'session';
    case 'orders':
    case 'order_items':
    case 'order_status_history':
      return 'order';
    case 'kitchen_tickets':
    case 'kitchen_ticket_items':
      return 'kitchen_ticket';
    case 'customer_service_requests':
      return 'service_request';
    case 'bills':
    case 'bill_items':
      return 'bill';
    case 'payments':
      return 'payment';
    case 'menu_items':
    case 'menu_categories':
      return 'menu';
    case 'staff_profiles':
    case 'staff_shifts':
      return 'staff';
    case 'inventory_items':
    case 'inventory_movements':
    case 'purchase_orders':
      return 'inventory';
    case 'online_integrations':
    case 'integration_events':
      return 'integration';
    case 'restaurant_settings':
      return 'settings';
    case 'notifications':
      return 'notification';
    case 'restaurant_reviews':
      return 'review';
    default:
      return 'snapshot';
  }
}

export interface SupabaseSubscriptionOptions {
  scope: ClientRealtimeScope;
  qrToken?: string;
  onEvent: (rawEvent: unknown) => void;
  onSubscribedChange?: (subscribed: boolean) => void;
}

export function startSupabaseRealtimeSubscription({
  scope,
  qrToken,
  onEvent,
  onSubscribedChange,
}: SupabaseSubscriptionOptions): () => void {
  let cancelled = false;
  let activeClient: SupabaseClient | null = null;
  const activeChannels: RealtimeChannel[] = [];

  const cleanup = () => {
    cancelled = true;
    onSubscribedChange?.(false);
    if (activeClient) {
      for (const ch of activeChannels) {
        void activeClient.removeChannel(ch);
      }
    }
    activeChannels.length = 0;
  };

  void (async () => {
    try {
      const cfg = await getRealtimeConfigCached();
      if (cancelled || !cfg.supabase.enabled || !cfg.supabase.url || !cfg.supabase.anonKey) {
        return;
      }

      const client = getOrCreateSupabaseClient(cfg.supabase.url, cfg.supabase.anonKey);
      activeClient = client;

      let tokenJwt: string | null = null;
      if (scope.portal === 'customer' && (qrToken || scope.tableId || scope.sessionId)) {
        const tokenRes = await api
          .getRealtimeToken({
            qrToken,
            tableId: scope.tableId,
            sessionId: scope.sessionId,
          })
          .catch(() => null);
        tokenJwt = tokenRes?.token || null;
      } else if (scope.portal !== 'customer') {
        const tokenRes = await api.getRealtimeToken().catch(() => null);
        tokenJwt = tokenRes?.token || null;
      }

      if (cancelled) return;
      if (tokenJwt) {
        await client.realtime.setAuth(tokenJwt);
      }

      const broadcastChannelName =
        scope.portal === 'customer' && scope.tableId
          ? `sh:table:${scope.tableId}`
          : 'sh:workspace';

      const broadcastChannel = client
        .channel(broadcastChannelName, {
          config: {
            broadcast: { self: false },
          },
        })
        .on('broadcast', { event: 'pos_event' }, (msg) => {
          if (!cancelled) {
            onEvent(msg.payload ?? msg);
          }
        });

      broadcastChannel.subscribe((status) => {
        if (cancelled) return;
        onSubscribedChange?.(status === 'SUBSCRIBED');
      });
      activeChannels.push(broadcastChannel);

      // Attach scoped PostgreSQL CDC stream when signed JWTs are active
      if (cfg.supabase.jwtSigningReady && tokenJwt) {
        const pgChannelName =
          scope.portal === 'customer' && scope.tableId
            ? `pg:table:${scope.tableId}`
            : `pg:staff:${scope.staffId || scope.portal}`;
        const pgChannel = client.channel(pgChannelName);

        const attachPgListener = (table: string, filter?: string) => {
          const opts: {
            event: '*';
            schema: 'public';
            table: string;
            filter?: string;
          } = {
            event: '*',
            schema: 'public',
            table,
          };
          if (filter) opts.filter = filter;

          pgChannel.on('postgres_changes', opts, (pgPayload) => {
            if (cancelled) return;
            const newRow = (pgPayload.new || {}) as Record<string, unknown>;
            const oldRow = (pgPayload.old || {}) as Record<string, unknown>;
            const recordId =
              typeof newRow.id === 'string'
                ? newRow.id
                : typeof oldRow.id === 'string'
                ? oldRow.id
                : undefined;
            const tableId =
              typeof newRow.table_id === 'string'
                ? newRow.table_id
                : typeof oldRow.table_id === 'string'
                ? oldRow.table_id
                : table === 'restaurant_tables'
                ? recordId
                : undefined;
            const sessionId =
              typeof newRow.session_id === 'string'
                ? newRow.session_id
                : typeof oldRow.session_id === 'string'
                ? oldRow.session_id
                : table === 'table_sessions'
                ? recordId
                : undefined;

            const action =
              pgPayload.eventType === 'INSERT'
                ? 'create'
                : pgPayload.eventType === 'DELETE'
                ? 'delete'
                : 'update';
            const entity = mapPgTableToEntity(table);

            onEvent({
              eventId: `pg:${table}:${pgPayload.eventType}:${recordId || ''}:${pgPayload.commit_timestamp || Date.now()}`,
              type: 'snapshot:updated',
              reason: `pg_${table}_${pgPayload.eventType.toLowerCase()}`,
              entity,
              action,
              recordId,
              tableId,
              sessionId,
              timestamp: pgPayload.commit_timestamp || new Date().toISOString(),
            });
          });
        };

        if (scope.portal === 'customer' && scope.tableId) {
          attachPgListener('restaurant_tables', `id=eq.${scope.tableId}`);
          attachPgListener('table_verification_requests', `table_id=eq.${scope.tableId}`);
          attachPgListener('table_sessions', `table_id=eq.${scope.tableId}`);
          attachPgListener('orders', `table_id=eq.${scope.tableId}`);
          attachPgListener('customer_service_requests', `table_id=eq.${scope.tableId}`);
          attachPgListener('bills', `table_id=eq.${scope.tableId}`);
          attachPgListener('menu_items');
          attachPgListener('menu_categories');
        } else {
          const staffTables = [
            'restaurant_tables',
            'table_sessions',
            'table_verification_requests',
            'orders',
            'kitchen_tickets',
            'customer_service_requests',
            'bills',
            'payments',
            'menu_items',
            'menu_categories',
            'staff_profiles',
            'inventory_items',
            'notifications',
            'online_integrations',
          ];
          for (const tbl of staffTables) {
            attachPgListener(tbl);
          }
        }

        pgChannel.subscribe();
        activeChannels.push(pgChannel);
      }
    } catch {
      // Fall back gracefully to WS / HTTP polling when Supabase Realtime is not configured
    }
  })();

  return cleanup;
}
