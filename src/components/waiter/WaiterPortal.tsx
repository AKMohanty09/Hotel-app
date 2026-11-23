import React, { useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CreditCard,
  Plus,
  Receipt,
  Sparkles,
  UserCheck,
  Utensils,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  Bill,
  PaymentMethod,
  RestaurantSnapshot,
  RestaurantTable,
  StaffProfile,
} from '../../types/domain';
import { downloadBillPdf } from '../../lib/exportUtils';

interface WaiterPortalProps {
  snapshot: RestaurantSnapshot;
  currentStaff: StaffProfile;
  onRefresh: () => Promise<void>;
}

export const WaiterPortal: React.FC<WaiterPortalProps> = ({
  snapshot,
  currentStaff,
  onRefresh,
}) => {
  const [tab, setTab] = useState<'tables' | 'verify' | 'service' | 'order' | 'bills'>('tables');
  const [revealedOtps, setRevealedOtps] = useState<Record<string, { otp: string; expiresAt: string }>>({});
  const [toast, setToast] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Manual order builder
  const [orderTableId, setOrderTableId] = useState(snapshot.tables[0]?.id || '');
  const activeOrderTableId = orderTableId || snapshot.tables[0]?.id || '';
  const [orderItems, setOrderItems] = useState<
    { menuItemId: string; variantId?: string; variantName?: string; quantity: number; instructions: string }[]
  >([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Table transfer modal
  const [moveSourceTable, setMoveSourceTable] = useState<RestaurantTable | null>(null);
  const [moveTargetId, setMoveTargetId] = useState('');

  // Payment input
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});
  const [payMethods, setPayMethods] = useState<Record<string, PaymentMethod>>({});

  const cur = snapshot.settings.currencySymbol || '₹';

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4000);
  };

  const pendingVerifications = useMemo(
    () =>
      snapshot.verifications.filter(
        (v) => v.status === 'pending' || v.status === 'presence_confirmed'
      ),
    [snapshot.verifications]
  );

  const readyTickets = useMemo(
    () => snapshot.tickets.filter((t) => t.status === 'ready'),
    [snapshot.tickets]
  );

  const activeServiceRequests = useMemo(
    () => snapshot.serviceRequests.filter((sr) => sr.status !== 'Completed'),
    [snapshot.serviceRequests]
  );

  const handleConfirmPresence = async (requestId: string) => {
    setBusyId(requestId);
    try {
      const res = await api.confirmPresenceAndRevealOtp(requestId);
      setRevealedOtps((prev) => ({
        ...prev,
        [requestId]: { otp: res.otp, expiresAt: res.expiresAt },
      }));
      notify(`Presence confirmed. Share OTP ${res.otp} with the table.`);
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to confirm presence.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectVerification = async (requestId: string) => {
    setBusyId(requestId);
    try {
      await api.rejectVerification(requestId, 'Waiter could not confirm party at table');
      notify('Verification request rejected.');
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Rejection failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleServeTicket = async (ticketId: string, partial = false) => {
    setBusyId(ticketId);
    try {
      await api.updateKitchenTicket(ticketId, {
        status: partial ? 'preparing' : 'served',
        clarificationNote: partial ? 'Partially served at table' : undefined,
      });
      notify(partial ? 'Marked partially served.' : 'Marked served at table.');
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleServiceAction = async (id: string, status: 'Accepted' | 'Completed' | 'Unavailable') => {
    setBusyId(id);
    try {
      await api.updateServiceRequest(id, status);
      notify(`Service request marked ${status}.`);
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleTableStatus = async (tableId: string, status: RestaurantTable['status']) => {
    setBusyId(tableId);
    try {
      await api.updateTable(tableId, { status });
      notify(`Table updated to ${status}.`);
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Table update failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleMoveSession = async () => {
    if (!moveSourceTable || !moveTargetId) return;
    setBusyId(moveSourceTable.id);
    try {
      await api.moveTableSession(moveSourceTable.id, moveTargetId);
      setMoveSourceTable(null);
      setMoveTargetId('');
      notify('Table session transferred.');
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Transfer failed.');
    } finally {
      setBusyId(null);
    }
  };

  const addOrderLine = (menuItemId: string, variantId?: string, variantName?: string) => {
    setOrderItems((prev) => {
      const idx = prev.findIndex(
        (i) => i.menuItemId === menuItemId && (i.variantId || '') === (variantId || '')
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [
        ...prev,
        { menuItemId, variantId, variantName, quantity: 1, instructions: '' },
      ];
    });
  };

  const handleSubmitManualOrder = async () => {
    if (!activeOrderTableId || orderItems.length === 0) return;
    setBusyId('manual_order');
    try {
      const res = await api.createStaffOrder({
        tableId: activeOrderTableId,
        channel: 'waiter',
        items: orderItems.map((line) => ({
          menuItemId: line.menuItemId,
          variantId: line.variantId,
          quantity: line.quantity,
          instructions: line.instructions,
        })),
      });
      setOrderItems([]);
      setTab('tables');
      notify(`Waiter order ${res.order.orderNumber} sent to kitchen.`);
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Order submission failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleGenerateTableBill = async (sessionId: string) => {
    setBusyId(sessionId);
    try {
      await api.generateBill(sessionId);
      setTab('bills');
      notify('Consolidated bill generated.');
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to generate bill.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRecordPayment = async (bill: Bill) => {
    const amount = Number(payAmounts[bill.id] || bill.balanceAmount);
    const method = payMethods[bill.id] || 'cash';
    setBusyId(bill.id);
    try {
      await api.recordPayment(bill.id, amount, method);
      notify(`Recorded ${cur}${amount.toFixed(2)} via ${method.toUpperCase()}.`);
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Payment error.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-24 transition-colors">
      {toast && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-auto sm:top-16 sm:left-auto sm:right-4 sm:translate-x-0 z-50 rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-2.5 text-xs font-medium text-white shadow-lg pointer-events-none whitespace-nowrap"
        >
          {toast}
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 py-5 space-y-5">
        {/* Top Waiter Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Assigned Tables</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {snapshot.tables.length}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Verify Requests</div>
            <div className="mt-1 font-mono text-2xl font-bold text-orange-600 dark:text-orange-400 tabular-nums">
              {pendingVerifications.length}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Food Ready</div>
            <div className="mt-1 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {readyTickets.length}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">Service Calls</div>
            <div className="mt-1 font-mono text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
              {activeServiceRequests.length}
            </div>
          </div>
        </div>

        {/* TABLES TAB */}
        {tab === 'tables' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Service Floor ({currentStaff.name})
              </h2>
              <button
                type="button"
                onClick={() => void api.toggleShift().then(onRefresh)}
                className={`rounded-xl px-3.5 py-2 text-xs font-semibold ${
                  currentStaff.onDuty
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-slate-900 dark:bg-orange-600 text-white'
                }`}
              >
                {currentStaff.onDuty ? 'On Shift (Tap to End)' : 'Start Shift'}
              </button>
            </div>

            {snapshot.tables.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No tables currently assigned to your profile. Ask your floor manager to assign tables.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {snapshot.tables.map((table) => {
                  const session = snapshot.sessions.find(
                    (s) => s.tableId === table.id && s.status !== 'closed'
                  );
                  const sessionOrders = session
                    ? snapshot.orders.filter((o) => o.sessionId === session.id)
                    : [];
                  const total = sessionOrders.reduce((s, o) => s + o.totalAmount, 0);
                  const hasReady = snapshot.tickets.some(
                    (t) =>
                      t.status === 'ready' &&
                      sessionOrders.some((o) => o.id === t.orderId)
                  );

                  return (
                    <div
                      key={table.id}
                      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                              Table {table.tableNumber}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {table.floor} · {table.section} · {table.capacity} seats
                            </p>
                          </div>
                          <span
                            className={`text-xs font-semibold ${
                              table.status === 'Available'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : table.status === 'Food Ready'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : table.status === 'Verification Pending' || table.status === 'Bill Requested'
                                ? 'text-orange-600 dark:text-orange-400'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {table.status}
                          </span>
                        </div>

                        {session && (
                          <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 p-3 text-xs space-y-1">
                            <div className="flex justify-between text-slate-600 dark:text-slate-300">
                              <span>Active Session ({session.guestCount} guests)</span>
                              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                                {cur}{total.toFixed(2)}
                              </span>
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">
                              {sessionOrders.length} order(s) {hasReady ? '· Food Ready for Pickup!' : ''}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setOrderTableId(table.id);
                            setTab('order');
                          }}
                          className="min-h-[44px] rounded-xl bg-slate-900 dark:bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700"
                        >
                          + Manual Order
                        </button>
                        {session ? (
                          <button
                            type="button"
                            disabled={busyId === session.id || sessionOrders.length === 0}
                            onClick={() => void handleGenerateTableBill(session.id)}
                            className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
                          >
                            Bill / Pay
                          </button>
                        ) : table.status === 'Cleaning' ? (
                          <button
                            type="button"
                            disabled={busyId === table.id}
                            onClick={() => void handleTableStatus(table.id, 'Available')}
                            className="min-h-[44px] rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                          >
                            Mark Available
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === table.id}
                            onClick={() => void handleTableStatus(table.id, 'Cleaning')}
                            className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            Mark Cleaning
                          </button>
                        )}
                        {session && (
                          <button
                            type="button"
                            onClick={() => {
                              setMoveSourceTable(table);
                              const free = snapshot.tables.find(
                                (t) => t.id !== table.id && t.status === 'Available'
                              );
                              setMoveTargetId(free?.id || '');
                            }}
                            className="col-span-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Transfer Table Session
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* VERIFY PRESENCE & OTP REVEAL TAB */}
        {tab === 'verify' && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Table Presence Verification
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Physically check that the guest party is seated at the requested table before pressing <strong>Confirm Presence</strong>. The 4-digit OTP is revealed only after physical confirmation.
            </p>

            {pendingVerifications.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No pending table verification requests.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {pendingVerifications.map((vr) => {
                  const revealed = revealedOtps[vr.id];
                  return (
                    <div key={vr.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                            Table {vr.tableNumber}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {vr.guestLabel || 'Guest'} · {vr.guestCount} guests · Requested{' '}
                            {new Date(vr.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                          {vr.presenceConfirmed ? 'Presence Confirmed' : 'Awaiting Check'}
                        </span>
                      </div>

                      {revealed ? (
                        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 p-4 text-center">
                          <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                            Share this one-time code verbally at Table {vr.tableNumber}
                          </div>
                          <div className="mt-1 font-mono text-3xl font-bold tracking-widest text-emerald-950 dark:text-emerald-200">
                            {revealed.otp}
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2.5">
                          <button
                            type="button"
                            disabled={busyId === vr.id}
                            onClick={() => void handleConfirmPresence(vr.id)}
                            className="flex-1 min-h-[48px] rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                          >
                            Confirm Presence &amp; Reveal OTP
                          </button>
                          <button
                            type="button"
                            disabled={busyId === vr.id}
                            onClick={() => void handleRejectVerification(vr.id)}
                            className="min-h-[48px] rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* READY PICKUP & SERVICE CALLS TAB */}
        {tab === 'service' && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Kitchen Food Ready ({readyTickets.length})
              </h2>
              {readyTickets.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
                  No dishes waiting for pickup right now.
                </div>
              ) : (
                readyTickets.map((tk) => (
                  <div key={tk.id} className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                          {tk.orderNumber}
                        </span>
                        <span className="ml-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                          · {tk.tableNumber || tk.channel.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{tk.stationName}</span>
                    </div>
                    <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                      {tk.items.map((it) => (
                        <li key={it.orderItemId}>
                          {it.quantity} × {it.name}
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === tk.id}
                        onClick={() => void handleServeTicket(tk.id, false)}
                        className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Pick Up &amp; Mark Served
                      </button>
                      <button
                        type="button"
                        disabled={busyId === tk.id}
                        onClick={() => void handleServeTicket(tk.id, true)}
                        className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300"
                      >
                        Partial / Issue
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Customer Table Requests ({activeServiceRequests.length})
              </h2>
              {activeServiceRequests.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
                  All table service requests are cleared.
                </div>
              ) : (
                activeServiceRequests.map((sr) => (
                  <div key={sr.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        Table {sr.tableNumber} · {sr.requestType}
                      </div>
                      <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">{sr.status}</span>
                    </div>
                    {sr.notes && <p className="text-xs text-slate-600 dark:text-slate-400">{sr.notes}</p>}
                    <div className="flex gap-2">
                      {sr.status === 'New' && (
                        <button
                          type="button"
                          onClick={() => void handleServiceAction(sr.id, 'Accepted')}
                          className="flex-1 min-h-[44px] rounded-xl bg-slate-900 dark:bg-orange-600 py-2 text-xs font-semibold text-white"
                        >
                          Accept
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleServiceAction(sr.id, 'Completed')}
                        className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 py-2 text-xs font-semibold text-white"
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleServiceAction(sr.id, 'Unavailable')}
                        className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-600 dark:text-slate-300"
                      >
                        Unavailable
                      </button>
                    </div>
                  </div>
                ))
              )}
            </section>
          </div>
        )}

        {/* MANUAL WAITER ORDER TAB */}
        {tab === 'order' && (
          <div className="grid gap-5 lg:grid-cols-12">
            <div className="lg:col-span-8 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Waiter Manual Order Entry
                </h2>
                <select
                  aria-label="Select table for manual order"
                  value={activeOrderTableId}
                  onChange={(e) => setOrderTableId(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-3.5 py-2 text-sm font-medium"
                >
                  {snapshot.tables.length === 0 ? (
                    <option value="">No tables available</option>
                  ) : (
                    snapshot.tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        Table {t.tableNumber} ({t.status})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap ${
                    selectedCategory === 'all'
                      ? 'bg-slate-900 dark:bg-orange-600 text-white'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  All
                </button>
                {snapshot.categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCategory(c.id)}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap ${
                      selectedCategory === c.id
                        ? 'bg-slate-900 dark:bg-orange-600 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {snapshot.menuItems
                  .filter((m) => (selectedCategory === 'all' || m.categoryId === selectedCategory) && m.isAvailable && !m.isTemporarilySoldOut)
                  .map((item) => {
                    const hasVariants = (item.variants?.length || 0) > 0;
                    if (hasVariants) {
                      return (
                        <div
                          key={item.id}
                          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                Choose size · {item.code}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {item.variants!.map((v) => (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => addOrderLine(item.id, v.id, v.name)}
                                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/40 transition-colors"
                              >
                                <Plus className="h-3 w-3 text-orange-600" />
                                <span>{v.name}</span>
                                <span className="font-mono text-[11px] text-orange-600 dark:text-orange-400">
                                  {cur}{v.price.toFixed(0)}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addOrderLine(item.id)}
                        className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left hover:border-orange-400 transition-colors"
                      >
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
                          <div className="font-mono text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {cur}{item.price.toFixed(0)} · {item.code}
                          </div>
                        </div>
                        <Plus className="h-5 w-5 text-orange-600 shrink-0" />
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 h-fit space-y-4">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Ticket Summary</h3>
              {orderItems.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Tap dishes or sizes on the left to add them to this waiter ticket.</p>
              ) : (
                <div className="space-y-3">
                  {orderItems.map((line) => {
                    const menu = snapshot.menuItems.find((m) => m.id === line.menuItemId);
                    if (!menu) return null;
                    const variant = line.variantId
                      ? menu.variants?.find((v) => v.id === line.variantId)
                      : undefined;
                    const unitPrice = variant ? variant.price : menu.price;
                    return (
                      <div key={`${line.menuItemId}_${line.variantId || ''}`} className="border-b border-slate-100 dark:border-slate-800 pb-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {line.quantity} × {menu.name}
                              {variant ? ` (${variant.name})` : ''}
                            </span>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {cur}{(unitPrice * line.quantity).toFixed(0)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setOrderItems((prev) =>
                                prev.filter(
                                  (x) =>
                                    !(
                                      x.menuItemId === line.menuItemId &&
                                      (x.variantId || '') === (line.variantId || '')
                                    )
                                )
                              )
                            }
                            className="text-xs text-red-600 dark:text-red-400 shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    disabled={busyId === 'manual_order'}
                    onClick={() => void handleSubmitManualOrder()}
                    className="w-full min-h-[48px] rounded-xl bg-orange-600 py-3 text-sm font-semibold text-white hover:bg-orange-700"
                  >
                    Send Order to Kitchen
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* BILLS & PAYMENT TAB */}
        {tab === 'bills' && (
          <div className="space-y-4">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Table Billing &amp; Settlement
            </h2>
            {snapshot.bills.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No generated bills yet. Generate a bill from an active table card.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {snapshot.bills.map((bill) => (
                  <div key={bill.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div>
                        <div className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                          {bill.billNumber} · Table {bill.tableNumber}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Total {cur}{bill.totalAmount.toFixed(2)} · Balance {cur}{bill.balanceAmount.toFixed(2)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadBillPdf(bill, snapshot.settings)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300"
                      >
                        PDF
                      </button>
                    </div>

                    {bill.status !== 'paid' && bill.balanceAmount > 0 ? (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-3 gap-2">
                          {(['cash', 'upi', 'card'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setPayMethods((prev) => ({ ...prev, [bill.id]: m }))}
                              className={`min-h-[40px] rounded-xl border text-xs font-semibold uppercase ${
                                (payMethods[bill.id] || 'cash') === m
                                  ? 'border-orange-600 bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-400'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.01"
                            value={payAmounts[bill.id] ?? String(bill.balanceAmount)}
                            onChange={(e) =>
                              setPayAmounts((prev) => ({ ...prev, [bill.id]: e.target.value }))
                            }
                            className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 font-mono text-sm"
                          />
                          <button
                            type="button"
                            disabled={busyId === bill.id}
                            onClick={() => void handleRecordPayment(bill)}
                            className="min-h-[44px] rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                          >
                            Record Pay
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        Settled ({bill.status.toUpperCase()})
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Ergonomic Touch Navigation */}
      <nav
        aria-label="Waiter Portal Navigation"
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pb-safe"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-5 h-16 items-center">
          {(
            [
              ['tables', 'Tables', Utensils, 0],
              ['verify', 'Verify', UserCheck, pendingVerifications.length],
              ['service', 'Service', Bell, readyTickets.length + activeServiceRequests.length],
              ['order', 'Order', ClipboardCheck, 0],
              ['bills', 'Bills', Receipt, 0],
            ] as const
          ).map(([key, label, Icon, badge]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`relative flex flex-col items-center justify-center h-full text-[11px] font-medium ${
                tab === key ? 'text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {badge > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </div>
              <span className="mt-1">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Move Table Session Modal */}
      {moveSourceTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
              Transfer Table {moveSourceTable.tableNumber} Session
            </h3>
            <select
              value={moveTargetId}
              onChange={(e) => setMoveTargetId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2.5 text-sm"
            >
              <option value="">Select destination table...</option>
              {snapshot.tables
                .filter((t) => t.id !== moveSourceTable.id && t.status === 'Available')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    Table {t.tableNumber} ({t.section}, {t.capacity} seats)
                  </option>
                ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveSourceTable(null)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!moveTargetId}
                onClick={() => void handleMoveSession()}
                className="rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                Transfer Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
