import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CreditCard,
  Download,
  FileText,
  Lock,
  Mail,
  Monitor,
  Moon,
  Plus,
  Receipt,
  RotateCcw,
  Save,
  Shield,
  Sun,
  Upload,
  UserPlus,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  Bill,
  PaymentMethod,
  RestaurantSnapshot,
  StaffProfile,
  StaffRole,
} from '../../types/domain';
import {
  downloadBillPdf,
  downloadCsvFile,
  downloadReportPdf,
} from '../../lib/exportUtils';
import { hasPermission } from '../../lib/permissions';
import { uploadImageFileToDatabase } from '../../lib/imageUtils';
import { StaffAvatar } from '../common/StaffAvatar';

const DEFAULT_LOGO_URL = '/src/assets/images/restaurant_emblem_1795406025250.jpg';

interface ManagerBillingReportsStaffProps {
  snapshot: RestaurantSnapshot;
  currentStaff: StaffProfile;
  section: 'billing' | 'reports' | 'staff' | 'audit' | 'settings';
  onRefresh: () => Promise<void>;
}

const ROLES: StaffRole[] = [
  'manager',
  'shift_supervisor',
  'waiter',
  'kitchen_supervisor',
  'kitchen_staff',
  'cashier',
];

export const ManagerBillingReportsStaff: React.FC<ManagerBillingReportsStaffProps> = ({
  snapshot,
  currentStaff,
  section,
  onRefresh,
}) => {
  const [feedback, setFeedback] = useState('');
  const cur = snapshot.settings.currencySymbol || '₹';

  // Billing state
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});
  const [payMethods, setPayMethods] = useState<Record<string, PaymentMethod>>({});
  const [adjustBill, setAdjustBill] = useState<Bill | null>(null);
  const [adjType, setAdjType] = useState<'discount' | 'correction' | 'refund'>('discount');
  const [adjAmount, setAdjAmount] = useState(100);
  const [adjReason, setAdjReason] = useState('');

  // Staff modal
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [stName, setStName] = useState('');
  const [stEmail, setStEmail] = useState('');
  const [stMobile, setStMobile] = useState('');
  const [stPhotoUrl, setStPhotoUrl] = useState('');
  const [stRole, setStRole] = useState<StaffRole>('waiter');
  const [stSection, setStSection] = useState(snapshot.settings.sections[0] || 'Main Hall');
  const [stShift, setStShift] = useState<StaffProfile['shift']>('Evening');
  const [stPasscode, setStPasscode] = useState('');
  const [uploadingStaffPhotoId, setUploadingStaffPhotoId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffProfile | null>(null);
  const [resetPasscode, setResetPasscode] = useState('');
  const [editEmailTarget, setEditEmailTarget] = useState<StaffProfile | null>(null);
  const [editEmailValue, setEditEmailValue] = useState('');
  const [ownerEmailInput, setOwnerEmailInput] = useState(
    snapshot.staff.find((s) => s.role === 'owner')?.email || currentStaff.email
  );
  const [savingOwnerEmail, setSavingOwnerEmail] = useState(false);

  // Settings form
  const [setName, setSetName] = useState(snapshot.settings.name);
  const [setTagline, setSetTagline] = useState(snapshot.settings.tagline);
  const [setLogoUrl, setSetLogoUrl] = useState(snapshot.settings.logoUrl || DEFAULT_LOGO_URL);
  const [setDefaultTheme, setSetDefaultTheme] = useState<'system' | 'light' | 'dark'>(
    snapshot.settings.defaultTheme || 'system'
  );
  const [setPhone, setSetPhone] = useState(snapshot.settings.phone);
  const [setAddress, setSetAddress] = useState(snapshot.settings.address);
  const [setGst, setSetGst] = useState(snapshot.settings.gstNumber);
  const [setTax, setSetTax] = useState(snapshot.settings.taxRatePercent);
  const [setSvc, setSetSvc] = useState(snapshot.settings.serviceChargePercent);
  const [setOtpExp, setSetOtpExp] = useState(snapshot.settings.otpExpirySeconds);
  const [setCooldown, setSetCooldown] = useState(snapshot.settings.otpResendCooldownSeconds);
  const [setSound, setSetSound] = useState(snapshot.settings.enableSoundAlerts);
  const [savingSettings, setSavingSettings] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const currentOwnerEmail =
    snapshot.staff.find((s) => s.role === 'owner')?.email || currentStaff.email;

  useEffect(() => {
    setSetLogoUrl(snapshot.settings.logoUrl || DEFAULT_LOGO_URL);
    setSetDefaultTheme(snapshot.settings.defaultTheme || 'system');
    setOwnerEmailInput(currentOwnerEmail);
  }, [snapshot.settings.logoUrl, snapshot.settings.defaultTheme, currentOwnerEmail]);

  // Reports filter
  const [reportChannel, setReportChannel] = useState('all');

  const notify = (msg: string) => {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(''), 4500);
  };

  // BILLING SECTION
  const activeUnbilledSessions = useMemo(() => {
    return snapshot.sessions.filter((s) => {
      if (s.status === 'closed') return false;
      const hasOrders = snapshot.orders.some((o) => o.sessionId === s.id && o.status !== 'Cancelled');
      return hasOrders;
    });
  }, [snapshot.sessions, snapshot.orders]);

  // REPORTS ANALYTICS
  const reportSummary = useMemo(() => {
    const orders = snapshot.orders.filter(
      (o) => o.status !== 'Cancelled' && (reportChannel === 'all' || o.channel === reportChannel)
    );
    const totalSales = orders.reduce((s, o) => s + o.totalAmount, 0);
    const totalTax = orders.reduce((s, o) => s + o.taxAmount, 0);
    const platformFees = orders.reduce((s, o) => s + (o.platformFee || 0), 0);
    const cogsEstimate = Math.round(totalSales * 0.34);
    const estimatedNetProfit = Math.round(totalSales - totalTax - platformFees - cogsEstimate);

    const paymentBreakdown = (['cash', 'upi', 'card'] as const).map((m) => ({
      method: m.toUpperCase(),
      amount: snapshot.payments
        .filter((p) => p.method === m)
        .reduce((s, p) => s + p.amount, 0),
    }));

    const waiterPerf = snapshot.staff
      .filter((s) => s.role === 'waiter' || s.role === 'shift_supervisor')
      .map((w) => {
        const wOrders = orders.filter((o) => o.waiterId === w.id);
        return {
          name: w.name,
          orders: wOrders.length,
          sales: wOrders.reduce((sum, o) => sum + o.totalAmount, 0),
        };
      });

    return { orders, totalSales, totalTax, platformFees, cogsEstimate, estimatedNetProfit, paymentBreakdown, waiterPerf };
  }, [snapshot, reportChannel]);

  if (section === 'billing') {
    const canAdjust = hasPermission(currentStaff.role, 'adjust_paid_bill');
    return (
      <div className="space-y-5">
        {feedback && (
          <div role="status" className="rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-3 text-sm text-white">
            {feedback}
          </div>
        )}

        {/* Active Sessions ready for consolidated bill generation */}
        <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Active Dining Sessions ({activeUnbilledSessions.length})
          </h3>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {activeUnbilledSessions.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">No active dining sessions with orders right now.</p>
            ) : (
              activeUnbilledSessions.map((ses) => (
                <button
                  key={ses.id}
                  type="button"
                  onClick={async () => {
                    await api.generateBill(ses.id);
                    notify(`Generated/refreshed consolidated bill for Table ${ses.tableNumber}.`);
                    await onRefresh();
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-dusk bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-orange-50 dark:hover:bg-slate-700 hover:border-orange-300"
                >
                  <Receipt className="h-3.5 w-3.5 text-orange-600 dark:text-amethyst" />
                  Generate / Sync Bill · Table {ses.tableNumber}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Bills Ledger */}
        <div className="space-y-3">
          {snapshot.bills.map((bill) => {
            const amountVal = payAmounts[bill.id] ?? String(bill.balanceAmount.toFixed(2));
            const methodVal = payMethods[bill.id] ?? 'upi';
            const isPaid = bill.status === 'paid' || bill.status === 'refunded';
            return (
              <div
                key={bill.id}
                className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{bill.billNumber}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">· Table {bill.tableNumber}</span>
                      {isPaid && (
                        <span title="Paid Bill Locked" className="inline-flex">
                          <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {bill.items.length} line items · Created {new Date(bill.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">
                      {cur}{bill.totalAmount.toFixed(2)}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Paid: {cur}{bill.paidAmount.toFixed(2)} · Balance:{' '}
                      <span className={bill.balanceAmount > 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>
                        {cur}{bill.balanceAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {bill.adjustments.length > 0 && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                    {bill.adjustments.map((adj) => (
                      <div key={adj.id}>
                        <strong className="uppercase">{adj.type}</strong> {cur}{adj.amount} by {adj.actorName}: &ldquo;{adj.reason}&rdquo;
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadBillPdf(bill, snapshot.settings)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-dusk px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Receipt PDF
                    </button>
                    {canAdjust && (
                      <button
                        type="button"
                        onClick={() => {
                          setAdjustBill(bill);
                          setAdjType(isPaid ? 'refund' : 'discount');
                          setAdjAmount(100);
                          setAdjReason('');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-dusk px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        {isPaid ? 'Audited Refund / Adjustment' : 'Apply Discount'}
                      </button>
                    )}
                  </div>

                  {bill.balanceAmount > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={methodVal}
                        onChange={(e) =>
                          setPayMethods((prev) => ({
                            ...prev,
                            [bill.id]: e.target.value as PaymentMethod,
                          }))
                        }
                        className="rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      >
                        <option value="upi">UPI</option>
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        value={amountVal}
                        onChange={(e) =>
                          setPayAmounts((prev) => ({ ...prev, [bill.id]: e.target.value }))
                        }
                        className="w-28 rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          await api.recordPayment(bill.id, Number(amountVal), methodVal);
                          notify(`Recorded ${methodVal.toUpperCase()} payment for ${bill.billNumber}.`);
                          await onRefresh();
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <CreditCard className="h-3.5 w-3.5" />
                        Record Payment
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Audited Bill Adjustment Modal */}
        {adjustBill && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.adjustBill(adjustBill.id, adjType, Number(adjAmount), adjReason);
                  notify(`Recorded ${adjType} on ${adjustBill.billNumber} (audited).`);
                  setAdjustBill(null);
                  await onRefresh();
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Adjustment failed.');
                }
              }}
              className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4 text-xs"
            >
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Audited Adjustment · {adjustBill.billNumber}
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Paid bills are locked against silent edits. Discounts, corrections, or refunds require a written audit reason.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Type</label>
                  <select
                    value={adjType}
                    onChange={(e) => setAdjType(e.target.value as 'discount' | 'correction' | 'refund')}
                    className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {adjustBill.status !== 'paid' && <option value="discount">Discount</option>}
                    <option value="correction">Correction</option>
                    <option value="refund">Refund</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Amount ({cur})</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Mandatory Audit Reason</label>
                <input
                  type="text"
                  required
                  minLength={4}
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="e.g., Guest loyalty courtesy discount / item spilled"
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustBill(null)}
                  className="rounded-xl border border-slate-200 dark:border-dusk px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                >
                  Apply Audited Action
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // REPORTS SECTION
  if (section === 'reports') {
    const headers = ['Order #', 'Channel', 'Table', 'Status', 'Subtotal', 'Tax', 'Total'];
    const rows = reportSummary.orders.map((o) => [
      o.orderNumber,
      o.channel,
      o.tableNumber || '-',
      o.status,
      o.subtotal.toFixed(2),
      o.taxAmount.toFixed(2),
      o.totalAmount.toFixed(2),
    ]);

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center gap-2">
            <select
              value={reportChannel}
              onChange={(e) => setReportChannel(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Channels</option>
              <option value="dine_in_qr">Dine-In QR</option>
              <option value="waiter">Waiter POS</option>
              <option value="swiggy">Swiggy</option>
              <option value="zomato">Zomato</option>
            </select>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => downloadCsvFile('saffron-hearth-sales-report.csv', headers, rows)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() =>
                downloadReportPdf(
                  `${snapshot.settings.name} Sales & Operations Report`,
                  `Channel: ${reportChannel} · Generated ${new Date().toLocaleString()}`,
                  headers,
                  rows
                )
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700"
            >
              <FileText className="h-3.5 w-3.5" />
              Export PDF Report
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Gross Revenue</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100">
              {cur}{reportSummary.totalSales.toFixed(2)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Tax Collected</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100">
              {cur}{reportSummary.totalTax.toFixed(2)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Online Commissions + Est. COGS</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100">
              {cur}{(reportSummary.platformFees + reportSummary.cogsEstimate).toFixed(0)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Estimated Operating Profit</div>
            <div className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-400">
              {cur}{reportSummary.estimatedNetProfit.toFixed(0)}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Payment Method Breakdown</h3>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {reportSummary.paymentBreakdown.map((pm) => (
                <div key={pm.method} className="py-2.5 flex justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{pm.method}</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{cur}{pm.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Waiter Service Performance</h3>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {reportSummary.waiterPerf.map((wp) => (
                <div key={wp.name} className="py-2.5 flex justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{wp.name} ({wp.orders} orders)</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{cur}{wp.sales.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // STAFF & SHIFTS SECTION
  if (section === 'staff') {
    return (
      <div className="space-y-5">
        {feedback && (
          <div role="status" className="rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-3 text-sm text-white">
            {feedback}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Staff Roster &amp; Role Access</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Waiters only see assigned tables; Kitchen staff are restricted to KDS tickets.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={async () => {
                await api.toggleShift();
                notify('Updated your shift duty status.');
                await onRefresh();
              }}
              className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {currentStaff.onDuty ? 'End My Shift' : 'Start My Shift'}
            </button>
            <button
              type="button"
              onClick={() => setStaffModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700"
            >
              <UserPlus className="h-4 w-4" />
              Add Staff Account
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-dusk bg-slate-50 dark:bg-slate-800/70 text-slate-500 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 font-medium">Staff Member</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Section / Shift</th>
                <th className="px-4 py-3 font-medium">Duty</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {snapshot.staff.map((st) => (
                <tr key={st.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <StaffAvatar name={st.name} photoUrl={st.photoUrl} size="sm" />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{st.name}</div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {st.employeeId} · {st.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Role for ${st.name}`}
                      value={st.role}
                      disabled={st.role === 'owner'}
                      onChange={async (e) => {
                        await api.updateStaff(st.id, { role: e.target.value as StaffRole });
                        notify(`Updated ${st.name}'s role.`);
                        await onRefresh();
                      }}
                      className="rounded-lg border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                    >
                      {st.role === 'owner' && <option value="owner">owner</option>}
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {st.section || 'All'} · {st.shift}
                  </td>
                  <td className="px-4 py-3">
                    <span className={st.onDuty ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}>
                      {st.onDuty ? 'On Duty' : 'Off Duty'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Status for ${st.name}`}
                      value={st.status}
                      disabled={st.role === 'owner'}
                      onChange={async (e) => {
                        await api.updateStaff(st.id, {
                          status: e.target.value as StaffProfile['status'],
                        });
                        await onRefresh();
                      }}
                      className="rounded-lg border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="active">active</option>
                      <option value="on_leave">on_leave</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {(st.role !== 'owner' || currentStaff.role === 'owner') && (
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 dark:border-dusk px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                          <Camera className="h-3 w-3" />
                          <span>{uploadingStaffPhotoId === st.id ? 'Saving...' : st.photoUrl ? 'Photo' : 'Add Photo'}</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            aria-label={`Upload profile photo for ${st.name}`}
                            disabled={uploadingStaffPhotoId === st.id}
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setUploadingStaffPhotoId(st.id);
                              try {
                                const url = await uploadImageFileToDatabase(file, 'staff', {
                                  maxDimension: 400,
                                  preferPng: false,
                                  quality: 0.84,
                                  entityId: st.id,
                                });
                                await api.updateStaff(st.id, { photoUrl: url });
                                notify(`Profile photo updated for ${st.name}.`);
                                await onRefresh();
                              } catch (err) {
                                notify(err instanceof Error ? err.message : 'Unable to upload staff photo.');
                              } finally {
                                setUploadingStaffPhotoId(null);
                              }
                            }}
                          />
                        </label>
                      )}
                      {(st.role !== 'owner' || currentStaff.role === 'owner') && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditEmailTarget(st);
                            setEditEmailValue(st.email);
                          }}
                          className="rounded-lg border border-slate-200 dark:border-dusk px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          Edit Email
                        </button>
                      )}
                      {(st.role !== 'owner' || currentStaff.role === 'owner') && (
                        <button
                          type="button"
                          onClick={() => {
                            setResetTarget(st);
                            setResetPasscode('');
                          }}
                          className="rounded-lg border border-slate-200 dark:border-dusk px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          Reset Passcode
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Create Staff Modal */}
        {staffModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.createStaff({
                    name: stName,
                    email: stEmail,
                    mobile: stMobile,
                    photoUrl: stPhotoUrl || undefined,
                    role: stRole,
                    section: stSection,
                    shift: stShift,
                    passcode: stPasscode,
                  });
                  setStaffModalOpen(false);
                  setStName('');
                  setStEmail('');
                  setStMobile('');
                  setStPhotoUrl('');
                  setStPasscode('');
                  notify('Staff account created.');
                  await onRefresh();
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Unable to create staff.');
                }
              }}
              className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl space-y-3 text-xs"
            >
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Create Staff Account</h3>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-dusk bg-slate-50 dark:bg-slate-800/60 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <StaffAvatar name={stName || 'Staff'} photoUrl={stPhotoUrl || undefined} size="md" />
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">Profile Photo (Optional)</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Stored in database media</div>
                  </div>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-orange-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 shrink-0">
                  <Camera className="h-3.5 w-3.5" />
                  <span>{uploadingStaffPhotoId === 'new' ? 'Uploading...' : stPhotoUrl ? 'Change' : 'Upload Photo'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    aria-label="Upload new staff profile photo"
                    disabled={uploadingStaffPhotoId === 'new'}
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingStaffPhotoId('new');
                      try {
                        const url = await uploadImageFileToDatabase(file, 'staff', {
                          maxDimension: 400,
                          preferPng: false,
                          quality: 0.84,
                        });
                        setStPhotoUrl(url);
                      } catch (err) {
                        notify(err instanceof Error ? err.message : 'Unable to upload staff photo.');
                      } finally {
                        setUploadingStaffPhotoId(null);
                      }
                    }}
                  />
                </label>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={stName}
                  onChange={(e) => setStName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Work Email</label>
                <input
                  type="email"
                  required
                  value={stEmail}
                  onChange={(e) => setStEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Role</label>
                  <select
                    value={stRole}
                    onChange={(e) => setStRole(e.target.value as StaffRole)}
                    className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Shift</label>
                  <select
                    value={stShift}
                    onChange={(e) => setStShift(e.target.value as StaffProfile['shift'])}
                    className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  >
                    <option value="Morning">Morning</option>
                    <option value="Afternoon">Afternoon</option>
                    <option value="Evening">Evening</option>
                    <option value="Full Day">Full Day</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Initial Passcode (6+ chars)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={stPasscode}
                  onChange={(e) => setStPasscode(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStaffModalOpen(false)}
                  className="rounded-xl border border-slate-200 dark:border-dusk px-4 py-2 text-sm text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                >
                  <Plus className="h-4 w-4" />
                  Create Staff
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Edit Staff / Owner Email Modal */}
        {editEmailTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.updateStaff(editEmailTarget.id, { email: editEmailValue });
                  notify(`Updated email ID for ${editEmailTarget.name}.`);
                  setEditEmailTarget(null);
                  await onRefresh();
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Unable to update email ID.');
                }
              }}
              className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl space-y-3 text-xs"
            >
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Change Email ID · {editEmailTarget.name}
              </h3>
              <p className="text-slate-500 dark:text-slate-400">
                This updates the sign-in email ID for {editEmailTarget.employeeId}.
              </p>
              <input
                type="email"
                required
                value={editEmailValue}
                onChange={(e) => setEditEmailValue(e.target.value)}
                placeholder="name@restaurant.com"
                className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditEmailTarget(null)}
                  className="rounded-xl border border-slate-200 dark:border-dusk px-4 py-2 text-sm text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700"
                >
                  Save Email
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Reset Staff Passcode Modal */}
        {resetTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await api.resetPassword(resetPasscode, resetTarget.id);
                notify(`Passcode updated for ${resetTarget.name}.`);
                setResetTarget(null);
              }}
              className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl space-y-3 text-xs"
            >
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Reset Passcode · {resetTarget.name}
              </h3>
              <input
                type="password"
                required
                minLength={6}
                value={resetPasscode}
                onChange={(e) => setResetPasscode(e.target.value)}
                placeholder="New 6+ character passcode"
                className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="rounded-xl border border-slate-200 dark:border-dusk px-4 py-2 text-sm text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700"
                >
                  Update Passcode
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // AUDIT LOGS
  if (section === 'audit') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-200 dark:border-dusk px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Immutable Audit Trail</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Every QR revocation, order cancellation, bill adjustment, table mutation, and login is logged.
            </p>
          </div>
          <Shield className="h-4 w-4 text-slate-400" />
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[640px] overflow-y-auto text-xs">
          {snapshot.auditLogs.map((log) => (
            <div key={log.id} className="px-5 py-3 flex items-start justify-between gap-4">
              <div>
                <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{log.action}</div>
                <div className="text-slate-600 dark:text-slate-400 mt-0.5">
                  Actor: <strong className="text-slate-800 dark:text-slate-200">{log.actorName}</strong> ({log.actorRole}) · {log.entityType} ({log.recordId})
                </div>
                {log.reason && <div className="text-amber-800 dark:text-amber-300 mt-0.5">Reason: {log.reason}</div>}
              </div>
              <span className="font-mono text-[11px] text-slate-400 shrink-0">
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // SETTINGS SECTION
  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const uploadedUrl = await uploadImageFileToDatabase(file, 'logo', {
        maxDimension: 512,
        preferPng: true,
        quality: 0.9,
        entityId: 'rest_main',
      });
      setSetLogoUrl(uploadedUrl);
      await api.updateSettings({ logoUrl: uploadedUrl });
      notify('Restaurant logo uploaded to database and published across all portals.');
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to upload logo image.');
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSavingSettings(true);
        try {
          await api.updateSettings({
            name: setName,
            tagline: setTagline,
            logoUrl: setLogoUrl,
            defaultTheme: setDefaultTheme,
            phone: setPhone,
            address: setAddress,
            gstNumber: setGst,
            taxRatePercent: Number(setTax),
            serviceChargePercent: Number(setSvc),
            otpExpirySeconds: Number(setOtpExp),
            otpResendCooldownSeconds: Number(setCooldown),
            enableSoundAlerts: setSound,
          });
          notify('Restaurant operational settings saved.');
          await onRefresh();
        } finally {
          setSavingSettings(false);
        }
      }}
      className="max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6 text-xs"
    >
      {feedback && (
        <div role="status" className="rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-3 text-sm text-white">
          {feedback}
        </div>
      )}
      <div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Restaurant Branding, Theme &amp; Verification Settings
        </h3>
        <p className="text-slate-500 dark:text-slate-400 mt-0.5">
          Changes apply immediately across the header, receipts, table QR cards, and customer menu.
        </p>
      </div>

      {currentStaff.role === 'owner' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-2.5">
          <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
            <Mail className="h-4 w-4 text-orange-600 dark:text-amethyst" />
            Owner Account Email ID
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Used for Owner sign-in and workspace recovery ({currentStaff.employeeId}).
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={ownerEmailInput}
              onChange={(e) => setOwnerEmailInput(e.target.value)}
              placeholder="owner@restaurant.com"
              className="min-w-0 flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              disabled={savingOwnerEmail}
              onClick={async () => {
                setSavingOwnerEmail(true);
                try {
                  const res = await api.updateProfile({ email: ownerEmailInput });
                  setOwnerEmailInput(res.staff.email);
                  notify(`Owner email ID updated to ${res.staff.email}.`);
                  await onRefresh();
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Unable to update Owner email.');
                } finally {
                  setSavingOwnerEmail(false);
                }
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50 shrink-0"
            >
              <Mail className="h-3.5 w-3.5" />
              {savingOwnerEmail ? 'Updating...' : 'Update Owner Email'}
            </button>
          </div>
        </div>
      )}

      {/* Restaurant Logo Uploader */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <img
            src={setLogoUrl}
            alt="Restaurant Logo Preview"
            referrerPolicy="no-referrer"
            className="h-16 w-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 bg-white shrink-0 shadow-sm"
          />
          <div>
            <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
              Restaurant Logo
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              PNG, JPG, WebP, or SVG. Shown in header, customer menu cards, and table QR prints.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            aria-label="Upload restaurant logo"
            onChange={(e) => void handleLogoFileChange(e)}
            className="hidden"
          />
          <button
            type="button"
            disabled={uploadingLogo}
            onClick={() => logoInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
          </button>
          {setLogoUrl !== DEFAULT_LOGO_URL && (
            <button
              type="button"
              onClick={async () => {
                setSetLogoUrl(DEFAULT_LOGO_URL);
                await api.updateSettings({ logoUrl: DEFAULT_LOGO_URL });
                notify('Restored default restaurant emblem.');
                await onRefresh();
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Default Customer Menu & Portal Theme */}
      <div className="rounded-xl border border-slate-200 dark:border-dusk bg-slate-50 dark:bg-slate-800/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
            Default Theme Preference
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            &ldquo;System&rdquo; follows each device&apos;s OS light or dark mode automatically. Guests and staff can still toggle anytime.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSetDefaultTheme('system')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
              setDefaultTheme === 'system'
                ? 'border-orange-600 bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-lavender'
                : 'border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Monitor className="h-3.5 w-3.5" />
            System
          </button>
          <button
            type="button"
            onClick={() => setSetDefaultTheme('light')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
              setDefaultTheme === 'light'
                ? 'border-orange-600 bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-lavender'
                : 'border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Sun className="h-3.5 w-3.5" />
            Light
          </button>
          <button
            type="button"
            onClick={() => setSetDefaultTheme('dark')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
              setDefaultTheme === 'dark'
                ? 'border-orange-600 bg-royal text-white'
                : 'border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Moon className="h-3.5 w-3.5" />
            Dark
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Restaurant Name</label>
          <input
            type="text"
            value={setName}
            onChange={(e) => setSetName(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Tagline</label>
          <input
            type="text"
            value={setTagline}
            onChange={(e) => setSetTagline(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Phone</label>
          <input
            type="text"
            value={setPhone}
            onChange={(e) => setSetPhone(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">GST Number</label>
          <input
            type="text"
            value={setGst}
            onChange={(e) => setSetGst(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      <div>
        <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Address</label>
        <input
          type="text"
          value={setAddress}
          onChange={(e) => setSetAddress(e.target.value)}
          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Tax %</label>
          <input
            type="number"
            step="0.5"
            value={setTax}
            onChange={(e) => setSetTax(Number(e.target.value))}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Service Charge %</label>
          <input
            type="number"
            step="0.5"
            value={setSvc}
            onChange={(e) => setSetSvc(Number(e.target.value))}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">OTP Expiry (sec)</label>
          <input
            type="number"
            min={60}
            value={setOtpExp}
            onChange={(e) => setSetOtpExp(Number(e.target.value))}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">OTP Cooldown (sec)</label>
          <input
            type="number"
            min={10}
            value={setCooldown}
            onChange={(e) => setSetCooldown(Number(e.target.value))}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={setSound}
          onChange={(e) => setSetSound(e.target.checked)}
        />
        Enable audible kitchen &amp; waiter alerts
      </label>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={savingSettings}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {savingSettings ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </form>
  );
};
