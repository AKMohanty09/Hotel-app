import type { Bill, Order, RestaurantTable, TableSession } from '../types/domain';

export function generatePermanentQrToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'tbl_' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildTableQrUrl(origin: string, qrToken: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  return `${cleanOrigin}/?portal=customer&tableToken=${encodeURIComponent(qrToken)}`;
}

export function canDeleteTable(
  table: RestaurantTable,
  sessions: TableSession[],
  orders: Order[],
  bills: Bill[]
): { allowed: boolean; reason?: string } {
  const hasActiveSession = sessions.some(
    (s) => s.tableId === table.id && s.status !== 'closed'
  );
  if (hasActiveSession) {
    return {
      allowed: false,
      reason: `Table ${table.tableNumber} has an active dining session. Close or move the session before deleting, or archive the table instead.`,
    };
  }

  const hasActiveOrder = orders.some(
    (o) =>
      o.tableId === table.id &&
      o.status !== 'Completed' &&
      o.status !== 'Cancelled'
  );
  if (hasActiveOrder) {
    return {
      allowed: false,
      reason: `Table ${table.tableNumber} has active orders in progress. Complete or cancel them first.`,
    };
  }

  const hasUnpaidBill = bills.some(
    (b) => b.tableId === table.id && (b.status === 'open' || b.status === 'partial')
  );
  if (hasUnpaidBill) {
    return {
      allowed: false,
      reason: `Table ${table.tableNumber} has an unpaid bill. Settle the bill before deleting, or archive the table.`,
    };
  }

  const hasHistoricalData =
    sessions.some((s) => s.tableId === table.id) ||
    orders.some((o) => o.tableId === table.id) ||
    bills.some((b) => b.tableId === table.id);

  if (hasHistoricalData) {
    return {
      allowed: false,
      reason: `Table ${table.tableNumber} has historical order/billing records. Use Archive to preserve audit integrity without reusing its QR token.`,
    };
  }

  return { allowed: true };
}
