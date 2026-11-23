import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAuditedAdjustment,
  applyPaymentToBill,
  computeSplitAmounts,
  consolidateSessionOrdersToBill,
} from './billingEngine';
import type { Order } from '../types/domain';

const makeOrder = (id: string, num: string, subtotal: number): Order => ({
  id,
  orderNumber: num,
  channel: 'dine_in_qr',
  tableId: 'tbl_1',
  tableNumber: 'T-01',
  sessionId: 'ses_1',
  status: 'Served',
  priority: 'normal',
  items: [
    {
      id: `oi_${id}`,
      menuItemId: 'm1',
      code: 'M1',
      name: 'Dish ' + num,
      quantity: 1,
      unitPrice: subtotal,
      modifiers: [],
      lineTotal: subtotal,
      stationId: 'st_main',
      prepTimeMinutes: 10,
      status: 'served',
    },
  ],
  subtotal,
  taxAmount: subtotal * 0.05,
  serviceChargeAmount: subtotal * 0.05,
  discountAmount: 0,
  totalAmount: subtotal * 1.1,
  paymentStatus: 'unpaid',
  remakeCount: 0,
  timeline: [],
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
});

test('consolidateSessionOrdersToBill sums multiple orders from the same session', () => {
  const bill = consolidateSessionOrdersToBill('ses_1', 'tbl_1', 'T-01', [
    makeOrder('o1', 'ORD-1', 500),
    makeOrder('o2', 'ORD-2', 300),
  ]);

  assert.equal(bill.subtotal, 800);
  assert.equal(bill.taxAmount, 40);
  assert.equal(bill.serviceChargeAmount, 40);
  assert.equal(bill.totalAmount, 880);
  assert.equal(bill.items.length, 2);
});

test('applyPaymentToBill supports split payments and locks settled bills', () => {
  const bill = consolidateSessionOrdersToBill('ses_1', 'tbl_1', 'T-01', [
    makeOrder('o1', 'ORD-1', 1000),
  ]);
  // total = 1100
  const first = applyPaymentToBill(bill, 600, []);
  assert.equal(first.isFullyPaid, false);
  assert.equal(first.updatedBill.status, 'partial');
  assert.equal(first.updatedBill.balanceAmount, 500);

  const second = applyPaymentToBill(first.updatedBill, 500, [
    {
      id: 'p1',
      billId: bill.id,
      billNumber: bill.billNumber,
      sessionId: 'ses_1',
      tableNumber: 'T-01',
      amount: 600,
      method: 'cash',
      recordedById: 'w1',
      recordedByName: 'Waiter',
      createdAt: '',
    },
  ]);
  assert.equal(second.isFullyPaid, true);
  assert.equal(second.updatedBill.status, 'paid');
  assert.equal(second.updatedBill.balanceAmount, 0);

  // Silent overwrite rejected
  assert.throws(() => applyPaymentToBill(second.updatedBill, 10, []), /cannot be overwritten/);

  // Waiter cannot refund or adjust paid bill
  assert.throws(
    () =>
      applyAuditedAdjustment(second.updatedBill, 'waiter', {
        id: 'adj1',
        type: 'refund',
        amount: 100,
        reason: 'Customer complaint',
        actorId: 'w1',
        actorName: 'Waiter',
        createdAt: '',
      }),
    /Managers or Owners/
  );
});

test('computeSplitAmounts distributes remainder without losing pennies', () => {
  const shares = computeSplitAmounts(100, 3);
  assert.deepEqual(shares, [33.34, 33.33, 33.33]);
});
