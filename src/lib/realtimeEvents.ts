import type {
  CustomerServiceRequest,
  KitchenTicket,
  PortalKey,
  RestaurantSnapshot,
  RestaurantTable,
  TableStatus,
  TicketStatus,
} from '../types/domain';
import { deriveOrderStatusFromTickets } from './orderEngine';

export type RealtimeEntity =
  | 'table'
  | 'verification'
  | 'session'
  | 'order'
  | 'kitchen_ticket'
  | 'service_request'
  | 'bill'
  | 'payment'
  | 'menu'
  | 'staff'
  | 'inventory'
  | 'integration'
  | 'settings'
  | 'notification'
  | 'review'
  | 'snapshot';

export type RealtimeConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export interface RealtimeScopeEvent {
  eventId: string;
  type: string;
  reason: string;
  entity: RealtimeEntity;
  action?: 'create' | 'update' | 'delete';
  recordId?: string;
  tableId?: string;
  sessionId?: string;
  waiterId?: string;
  stationId?: string;
  channel?: string;
  timestamp: string;
}

export interface ClientRealtimeScope {
  portal: PortalKey;
  tableId?: string;
  sessionId?: string;
  staffId?: string;
  assignedTableIds?: string[];
  stationId?: string;
}

export function normalizeIncomingRealtimeEvent(raw: unknown): RealtimeScopeEvent {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const payload = (
    obj.payload && typeof obj.payload === 'object' ? obj.payload : obj
  ) as Record<string, unknown>;

  const reason = String(payload.reason || obj.reason || obj.type || 'snapshot_updated');
  const entity = inferEntityFromReason(
    typeof payload.entity === 'string' ? (payload.entity as RealtimeEntity) : undefined,
    reason
  );

  const timestamp = String(obj.timestamp || payload.timestamp || new Date().toISOString());
  const eventId = String(
    payload.eventId ||
      obj.eventId ||
      `${entity}:${reason}:${payload.recordId || payload.orderId || payload.tableId || timestamp}`
  );

  return {
    eventId,
    type: String(obj.type || 'snapshot:updated'),
    reason,
    entity,
    action:
      payload.action === 'create' || payload.action === 'update' || payload.action === 'delete'
        ? payload.action
        : undefined,
    recordId: typeof payload.recordId === 'string' ? payload.recordId : undefined,
    tableId: typeof payload.tableId === 'string' ? payload.tableId : undefined,
    sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
    waiterId: typeof payload.waiterId === 'string' ? payload.waiterId : undefined,
    stationId: typeof payload.stationId === 'string' ? payload.stationId : undefined,
    channel: typeof payload.channel === 'string' ? payload.channel : undefined,
    timestamp,
  };
}

export function inferEntityFromReason(
  explicit: RealtimeEntity | undefined,
  reason: string
): RealtimeEntity {
  if (explicit) return explicit;
  if (reason.includes('table') || reason.includes('qr_revoked')) return 'table';
  if (reason.includes('verification') || reason.includes('presence')) return 'verification';
  if (reason.includes('session')) return 'session';
  if (reason.includes('kitchen_ticket') || reason.includes('ticket')) return 'kitchen_ticket';
  if (reason.includes('order') || reason.includes('online')) return 'order';
  if (reason.includes('service_request')) return 'service_request';
  if (reason.includes('payment')) return 'payment';
  if (reason.includes('bill')) return 'bill';
  if (reason.includes('menu')) return 'menu';
  if (reason.includes('staff') || reason.includes('shift')) return 'staff';
  if (reason.includes('inventory') || reason.includes('po_')) return 'inventory';
  if (reason.includes('integration')) return 'integration';
  if (reason.includes('settings')) return 'settings';
  if (reason.includes('notification')) return 'notification';
  if (reason.includes('review')) return 'review';
  return 'snapshot';
}

export function isEventRelevantToScope(
  event: RealtimeScopeEvent,
  scope: ClientRealtimeScope
): boolean {
  if (event.entity === 'snapshot' || event.entity === 'settings' || event.entity === 'menu') {
    return true;
  }
  if (scope.portal === 'manager') {
    return true;
  }
  if (scope.portal === 'kitchen') {
    return (
      event.entity === 'order' ||
      event.entity === 'kitchen_ticket' ||
      event.entity === 'integration' ||
      event.entity === 'notification' ||
      event.entity === 'table' ||
      event.entity === 'session'
    );
  }
  if (scope.portal === 'waiter') {
    if (event.entity === 'inventory') return false;
    if (event.waiterId && scope.staffId && event.waiterId === scope.staffId) {
      return true;
    }
    if (
      event.tableId &&
      scope.assignedTableIds &&
      scope.assignedTableIds.length > 0 &&
      !scope.assignedTableIds.includes(event.tableId) &&
      event.entity !== 'staff' &&
      event.entity !== 'table'
    ) {
      return false;
    }
    return true;
  }
  // Customer QR Portal: strictly scoped to this table/session + public menu/settings
  if (scope.portal === 'customer') {
    if (event.sessionId && scope.sessionId && event.sessionId === scope.sessionId) {
      return true;
    }
    if (event.tableId && scope.tableId && event.tableId === scope.tableId) {
      return true;
    }
    // If an event didn't carry tableId/sessionId for table-scoped entity types, allow only if matching tableId is absent
    if (
      !event.tableId &&
      !event.sessionId &&
      (event.entity === 'table' ||
        event.entity === 'verification' ||
        event.entity === 'session' ||
        event.entity === 'order' ||
        event.entity === 'kitchen_ticket' ||
        event.entity === 'service_request' ||
        event.entity === 'bill' ||
        event.entity === 'payment')
    ) {
      return true;
    }
    return false;
  }
  return true;
}

export class EventDeduplicator {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs = 15000, maxSize = 250) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  shouldProcess(eventId: string, nowMs = Date.now()): boolean {
    if (!eventId) return true;
    this.prune(nowMs);
    const prev = this.seen.get(eventId);
    if (prev !== undefined && nowMs - prev < this.ttlMs) {
      return false;
    }
    this.seen.set(eventId, nowMs);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }

  private prune(nowMs: number): void {
    for (const [key, ts] of this.seen.entries()) {
      if (nowMs - ts >= this.ttlMs) {
        this.seen.delete(key);
      }
    }
    while (this.seen.size > this.maxSize) {
      const oldestKey = this.seen.keys().next().value;
      if (oldestKey === undefined) break;
      this.seen.delete(oldestKey);
    }
  }
}

export function applyOptimisticTableStatus(
  snap: RestaurantSnapshot,
  tableId: string,
  status: TableStatus
): RestaurantSnapshot {
  const now = new Date().toISOString();
  return {
    ...snap,
    tables: snap.tables.map((t: RestaurantTable) =>
      t.id === tableId ? { ...t, status, updatedAt: now } : t
    ),
  };
}

export function applyOptimisticServiceRequestStatus(
  snap: RestaurantSnapshot,
  requestId: string,
  status: CustomerServiceRequest['status']
): RestaurantSnapshot {
  const now = new Date().toISOString();
  return {
    ...snap,
    serviceRequests: snap.serviceRequests.map((sr) =>
      sr.id === requestId ? { ...sr, status, updatedAt: now } : sr
    ),
  };
}

export function applyOptimisticOrderConfirmed(
  snap: RestaurantSnapshot,
  orderId: string
): RestaurantSnapshot {
  const now = new Date().toISOString();
  return {
    ...snap,
    orders: snap.orders.map((o) =>
      o.id === orderId ? { ...o, status: 'Confirmed', updatedAt: now } : o
    ),
  };
}

export function applyOptimisticTicketStatus(
  snap: RestaurantSnapshot,
  ticketId: string,
  nextStatus: TicketStatus
): RestaurantSnapshot {
  const now = new Date().toISOString();
  const target = snap.tickets.find((t) => t.id === ticketId);
  if (!target) return snap;

  const updatedTickets: KitchenTicket[] = snap.tickets.map((t) => {
    if (t.id !== ticketId) return t;
    return {
      ...t,
      status: nextStatus,
      items:
        nextStatus === 'ready' || nextStatus === 'completed'
          ? t.items.map((it) => ({ ...it, status: 'ready' as const }))
          : nextStatus === 'preparing'
          ? t.items.map((it) => (it.status === 'new' ? { ...it, status: 'preparing' as const } : it))
          : t.items,
      updatedAt: now,
    };
  });

  const order = snap.orders.find((o) => o.id === target.orderId);
  const siblingTickets = updatedTickets.filter((t) => t.orderId === target.orderId);
  const derivedOrderStatus = order
    ? deriveOrderStatusFromTickets(siblingTickets, order.channel, order.status)
    : undefined;

  return {
    ...snap,
    tickets: updatedTickets,
    orders: order
      ? snap.orders.map((o) =>
          o.id === order.id && derivedOrderStatus
            ? { ...o, status: derivedOrderStatus, updatedAt: now }
            : o
        )
      : snap.orders,
    tables:
      order?.tableId && derivedOrderStatus
        ? snap.tables.map((tbl) => {
            if (tbl.id !== order.tableId) return tbl;
            let tableStatus = tbl.status;
            if (derivedOrderStatus === 'Ready' || derivedOrderStatus === 'Partially Ready') {
              tableStatus = 'Food Ready';
            } else if (derivedOrderStatus === 'Preparing') {
              tableStatus = 'Preparing';
            } else if (derivedOrderStatus === 'Served' || derivedOrderStatus === 'Completed') {
              tableStatus = 'Occupied';
            }
            return { ...tbl, status: tableStatus, updatedAt: now };
          })
        : snap.tables,
  };
}
