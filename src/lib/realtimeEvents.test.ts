import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOptimisticOrderConfirmed,
  applyOptimisticServiceRequestStatus,
  applyOptimisticTableStatus,
  applyOptimisticTicketStatus,
  EventDeduplicator,
  isEventRelevantToScope,
  normalizeIncomingRealtimeEvent,
} from './realtimeEvents';
import type { RestaurantSnapshot } from '../types/domain';

function createMinimalSnapshot(): RestaurantSnapshot {
  const now = '2026-01-01T10:00:00.000Z';
  return {
    settings: {
      id: 'main',
      name: 'Test Bistro',
      tagline: '',
      logoUrl: '',
      address: '',
      phone: '',
      email: '',
      gstNumber: '',
      openingHours: '',
      currencySymbol: '₹',
      taxRatePercent: 5,
      serviceChargePercent: 5,
      defaultDiscountLimitPercent: 20,
      otpExpirySeconds: 180,
      otpResendCooldownSeconds: 30,
      otpMaxAttempts: 5,
      serviceRequestCooldownSeconds: 20,
      allowSplitPayment: true,
      allowSplitBill: true,
      enableSoundAlerts: true,
      floors: ['Ground'],
      sections: ['Main'],
      updatedAt: now,
    },
    staff: [],
    shifts: [],
    tables: [
      {
        id: 'tbl_1',
        tableNumber: 'T-01',
        capacity: 4,
        floor: 'Ground',
        section: 'Main',
        tableType: 'regular',
        assignedWaiterId: 'w_1',
        status: 'Available',
        qrToken: 'qr_1',
        qrRevoked: false,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    verifications: [],
    sessions: [],
    categories: [],
    menuItems: [],
    stations: [],
    orders: [
      {
        id: 'ord_1',
        orderNumber: 'ORD-100',
        channel: 'dine_in_qr',
        tableId: 'tbl_1',
        tableNumber: 'T-01',
        sessionId: 'ses_1',
        waiterId: 'w_1',
        status: 'Submitted',
        priority: 'normal',
        items: [],
        subtotal: 100,
        taxAmount: 5,
        serviceChargeAmount: 5,
        discountAmount: 0,
        totalAmount: 110,
        paymentStatus: 'unpaid',
        remakeCount: 0,
        timeline: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    tickets: [
      {
        id: 'kt_1',
        orderId: 'ord_1',
        orderNumber: 'ORD-100',
        channel: 'dine_in_qr',
        tableNumber: 'T-01',
        stationId: 'st_main',
        stationName: 'Main Kitchen',
        priority: 'normal',
        status: 'new',
        items: [
          {
            orderItemId: 'oi_1',
            name: 'Pizza',
            quantity: 1,
            modifiers: [],
            status: 'new',
          },
        ],
        estimatedMinutes: 15,
        createdAt: now,
        updatedAt: now,
      },
    ],
    serviceRequests: [
      {
        id: 'sr_1',
        tableId: 'tbl_1',
        tableNumber: 'T-01',
        sessionId: 'ses_1',
        waiterId: 'w_1',
        requestType: 'Water',
        status: 'New',
        createdAt: now,
        updatedAt: now,
      },
    ],
    bills: [],
    payments: [],
    inventory: [],
    inventoryMovements: [],
    suppliers: [],
    purchaseOrders: [],
    recipes: [],
    platforms: [],
    integrationEvents: [],
    notifications: [],
    auditLogs: [],
    reviews: [],
  };
}

test('EventDeduplicator blocks duplicate eventIds inside TTL window and allows expired ones', () => {
  const dedupe = new EventDeduplicator(5000, 10);
  assert.equal(dedupe.shouldProcess('evt_1', 1000), true);
  assert.equal(dedupe.shouldProcess('evt_1', 2500), false);
  assert.equal(dedupe.shouldProcess('evt_2', 2500), true);
  assert.equal(dedupe.shouldProcess('evt_1', 7000), true);
});

test('isEventRelevantToScope isolates customer table updates from unrelated tables and inventory', () => {
  const otherTableOrder = normalizeIncomingRealtimeEvent({
    type: 'snapshot:updated',
    payload: {
      eventId: 'evt_a',
      entity: 'order',
      reason: 'order_created',
      tableId: 'tbl_99',
      sessionId: 'ses_99',
    },
  });
  assert.equal(
    isEventRelevantToScope(otherTableOrder, {
      portal: 'customer',
      tableId: 'tbl_1',
      sessionId: 'ses_1',
    }),
    false
  );
  assert.equal(
    isEventRelevantToScope(otherTableOrder, {
      portal: 'kitchen',
    }),
    true
  );

  const sameTableOrder = normalizeIncomingRealtimeEvent({
    type: 'snapshot:updated',
    payload: {
      eventId: 'evt_b',
      entity: 'order',
      reason: 'order_confirmed',
      tableId: 'tbl_1',
      sessionId: 'ses_1',
    },
  });
  assert.equal(
    isEventRelevantToScope(sameTableOrder, {
      portal: 'customer',
      tableId: 'tbl_1',
      sessionId: 'ses_1',
    }),
    true
  );

  const inventoryEvent = normalizeIncomingRealtimeEvent({
    type: 'snapshot:updated',
    payload: { eventId: 'evt_inv', entity: 'inventory', reason: 'inventory_updated' },
  });
  assert.equal(
    isEventRelevantToScope(inventoryEvent, { portal: 'waiter', staffId: 'w_1', assignedTableIds: ['tbl_1'] }),
    false
  );
});

test('optimistic updaters mutate target entity cleanly without mutating previous snapshot (preserving rollback)', () => {
  const base = createMinimalSnapshot();

  const afterTable = applyOptimisticTableStatus(base, 'tbl_1', 'Cleaning');
  assert.equal(afterTable.tables[0].status, 'Cleaning');
  assert.equal(base.tables[0].status, 'Available');

  const afterSr = applyOptimisticServiceRequestStatus(base, 'sr_1', 'Accepted');
  assert.equal(afterSr.serviceRequests[0].status, 'Accepted');
  assert.equal(base.serviceRequests[0].status, 'New');

  const afterConfirm = applyOptimisticOrderConfirmed(base, 'ord_1');
  assert.equal(afterConfirm.orders[0].status, 'Confirmed');
  assert.equal(base.orders[0].status, 'Submitted');

  const afterTicketReady = applyOptimisticTicketStatus(base, 'kt_1', 'ready');
  assert.equal(afterTicketReady.tickets[0].status, 'ready');
  assert.equal(afterTicketReady.orders[0].status, 'Ready');
  assert.equal(afterTicketReady.tables[0].status, 'Food Ready');

  const afterTicketCompleted = applyOptimisticTicketStatus(afterTicketReady, 'kt_1', 'completed');
  assert.equal(afterTicketCompleted.tickets[0].status, 'completed');
  assert.equal(afterTicketCompleted.orders[0].status, 'Completed');
  assert.equal(afterTicketCompleted.tables[0].status, 'Occupied');
});
