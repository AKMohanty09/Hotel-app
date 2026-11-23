import type {
  Bill,
  BillItem,
  Order,
  PaymentAdjustment,
  PaymentRecord,
  StaffRole,
} from '../types/domain';
import { hasPermission } from './permissions';

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

export function consolidateSessionOrdersToBill(
  sessionId: string,
  tableId: string,
  tableNumber: string,
  sessionOrders: Order[],
  existingBill?: Bill | null,
  billNumber?: string
): Bill {
  const billableOrders = sessionOrders.filter((o) => o.status !== 'Cancelled' && o.status !== 'Draft');
  const items: BillItem[] = [];
  for (const order of billableOrders) {
    for (const item of order.items) {
      if (item.status === 'cancelled') continue;
      items.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        name:
          item.modifiers.length > 0
            ? `${item.name} (${item.modifiers.map((m) => m.name).join(', ')})`
            : item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      });
    }
  }

  const subtotal = roundMoney(billableOrders.reduce((sum, o) => sum + o.subtotal, 0));
  const taxAmount = roundMoney(billableOrders.reduce((sum, o) => sum + o.taxAmount, 0));
  const serviceChargeAmount = roundMoney(
    billableOrders.reduce((sum, o) => sum + o.serviceChargeAmount, 0)
  );
  const existingAdjustments = existingBill?.adjustments || [];
  const adjustmentDiscount = existingAdjustments
    .filter((a) => a.type === 'discount' || a.type === 'correction')
    .reduce((sum, a) => sum + a.amount, 0);
  const orderDiscounts = billableOrders.reduce((sum, o) => sum + o.discountAmount, 0);
  const discountAmount = roundMoney(orderDiscounts + adjustmentDiscount);
  const totalAmount = Math.max(
    0,
    roundMoney(subtotal + taxAmount + serviceChargeAmount - discountAmount)
  );
  const paidAmount = roundMoney(existingBill?.paidAmount || 0);
  const balanceAmount = Math.max(0, roundMoney(totalAmount - paidAmount));

  let status: Bill['status'] = existingBill?.status || 'open';
  if (status !== 'refunded' && status !== 'adjusted') {
    if (totalAmount > 0 && balanceAmount <= 0.01) {
      status = 'paid';
    } else if (paidAmount > 0) {
      status = 'partial';
    } else {
      status = 'open';
    }
  }

  const now = new Date().toISOString();
  return {
    id: existingBill?.id || `bill_${crypto.randomUUID().slice(0, 12)}`,
    billNumber: existingBill?.billNumber || billNumber || `INV-${Date.now().toString().slice(-6)}`,
    sessionId,
    tableId,
    tableNumber,
    orderIds: billableOrders.map((o) => o.id),
    items,
    subtotal,
    taxAmount,
    serviceChargeAmount,
    discountAmount,
    totalAmount,
    paidAmount,
    balanceAmount,
    status,
    splitCount: existingBill?.splitCount || 1,
    adjustments: existingAdjustments,
    createdAt: existingBill?.createdAt || now,
    updatedAt: now,
  };
}

export function applyPaymentToBill(
  bill: Bill,
  amount: number,
  payments: PaymentRecord[]
): { updatedBill: Bill; isFullyPaid: boolean } {
  if (bill.status === 'paid' || bill.status === 'refunded') {
    throw new Error('Settled bills cannot be overwritten directly.');
  }
  const cleanAmount = roundMoney(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }
  if (cleanAmount > bill.balanceAmount + 0.01) {
    throw new Error(`Payment (${cleanAmount}) exceeds remaining balance (${bill.balanceAmount}).`);
  }

  const totalPaid = roundMoney(
    payments.reduce((sum, p) => sum + p.amount, 0) + cleanAmount
  );
  const balanceAmount = Math.max(0, roundMoney(bill.totalAmount - totalPaid));
  const isFullyPaid = balanceAmount <= 0.01;

  return {
    isFullyPaid,
    updatedBill: {
      ...bill,
      paidAmount: totalPaid,
      balanceAmount,
      status: isFullyPaid ? 'paid' : 'partial',
      updatedAt: new Date().toISOString(),
    },
  };
}

export function applyAuditedAdjustment(
  bill: Bill,
  actorRole: StaffRole,
  adjustment: PaymentAdjustment
): Bill {
  if (adjustment.type === 'refund' && !hasPermission(actorRole, 'issue_refund')) {
    throw new Error('Only authorized Managers or Owners can issue refunds.');
  }
  if (bill.status === 'paid' && !hasPermission(actorRole, 'adjust_paid_bill')) {
    throw new Error('Paid bills are locked. Manager authorization and reason are required.');
  }
  if (adjustment.type === 'discount' && !hasPermission(actorRole, 'apply_discount')) {
    throw new Error('Your role does not permit applying bill discounts.');
  }
  if (!adjustment.reason || adjustment.reason.trim().length < 3) {
    throw new Error('An audit reason of at least 3 characters is required.');
  }

  const nextAdjustments = [...bill.adjustments, adjustment];
  const discountDelta = adjustment.type === 'refund' ? 0 : adjustment.amount;
  const nextDiscount = roundMoney(bill.discountAmount + discountDelta);
  const nextTotal = Math.max(
    0,
    roundMoney(bill.subtotal + bill.taxAmount + bill.serviceChargeAmount - nextDiscount)
  );
  const nextPaid =
    adjustment.type === 'refund'
      ? Math.max(0, roundMoney(bill.paidAmount - adjustment.amount))
      : bill.paidAmount;
  const nextBalance = Math.max(0, roundMoney(nextTotal - nextPaid));

  return {
    ...bill,
    discountAmount: nextDiscount,
    totalAmount: nextTotal,
    paidAmount: nextPaid,
    balanceAmount: nextBalance,
    status: adjustment.type === 'refund' ? 'refunded' : bill.status === 'paid' ? 'adjusted' : bill.status,
    adjustments: nextAdjustments,
    updatedAt: new Date().toISOString(),
  };
}

export function computeSplitAmounts(totalAmount: number, splitCount: number): number[] {
  const count = Math.max(1, Math.min(20, Math.floor(splitCount)));
  const baseShare = Math.floor((totalAmount / count) * 100) / 100;
  const shares = Array(count).fill(baseShare);
  const remainder = roundMoney(totalAmount - baseShare * count);
  shares[0] = roundMoney(shares[0] + remainder);
  return shares;
}
