import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Flame,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  XCircle,
} from 'lucide-react';
import { api } from '../../services/api';
import type { Order, OrderPriority, OrderStatus, RestaurantSnapshot } from '../../types/domain';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface ManagerOrdersAndOnlineProps {
  snapshot: RestaurantSnapshot;
  mode: 'orders' | 'online';
  onRefresh: () => Promise<void>;
}

const ORDER_STATUSES: OrderStatus[] = [
  'Draft',
  'Submitted',
  'Confirmed',
  'Preparing',
  'Partially Ready',
  'Ready',
  'Served',
  'Packed',
  'Picked Up',
  'Completed',
  'Cancelled',
];

export const ManagerOrdersAndOnline: React.FC<ManagerOrdersAndOnlineProps> = ({
  snapshot,
  mode,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>(mode === 'online' ? 'online_all' : 'all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [refireTarget, setRefireTarget] = useState<Order | null>(null);
  const [refireReason, setRefireReason] = useState('');
  const [feedback, setFeedback] = useState<string>('');

  // Online sandbox integration state
  const [simPlatform, setSimPlatform] = useState<'swiggy' | 'zomato'>('swiggy');
  const [simDishId, setSimDishId] = useState(snapshot.menuItems[0]?.id || '');
  const [simQty, setSimQty] = useState(1);
  const [simNotes, setSimNotes] = useState('Tamper-evident seal + cutlery');
  const [simBusy, setSimBusy] = useState(false);

  const cur = snapshot.settings.currencySymbol || '₹';

  const notify = (msg: string) => {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(''), 4500);
  };

  const filteredOrders = useMemo(() => {
    return snapshot.orders.filter((o) => {
      if (mode === 'online' && !['swiggy', 'zomato', 'direct_online'].includes(o.channel)) {
        return false;
      }
      if (channelFilter === 'online_all' && !['swiggy', 'zomato', 'direct_online'].includes(o.channel)) {
        return false;
      }
      if (channelFilter !== 'all' && channelFilter !== 'online_all' && o.channel !== channelFilter) {
        return false;
      }
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${o.orderNumber} ${o.externalOrderId || ''} ${o.tableNumber || ''} ${o.waiterName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [snapshot.orders, mode, channelFilter, statusFilter, search]);

  const handleStatusUpdate = async (order: Order, nextStatus: OrderStatus) => {
    try {
      await api.updateOrder(order.id, { status: nextStatus });
      notify(`${order.orderNumber} marked ${nextStatus}.`);
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Status update failed.');
    }
  };

  const handlePriorityToggle = async (order: Order) => {
    const nextPriority: OrderPriority = order.priority === 'rush' ? 'normal' : 'rush';
    try {
      await api.updateOrder(order.id, { priority: nextPriority });
      notify(`${order.orderNumber} priority set to ${nextPriority.toUpperCase()}.`);
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Priority update failed.');
    }
  };

  const handleCancelConfirm = async () => {
    if (!cancelTarget || cancelReason.trim().length < 3) return;
    try {
      await api.updateOrder(cancelTarget.id, {
        status: 'Cancelled',
        cancellationReason: cancelReason.trim(),
      });
      notify(`${cancelTarget.orderNumber} cancelled (audited).`);
      setCancelTarget(null);
      setCancelReason('');
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Cancellation failed.');
    }
  };

  const handleRefireConfirm = async () => {
    if (!refireTarget || refireReason.trim().length < 3) return;
    try {
      await api.updateOrder(refireTarget.id, { refireReason: refireReason.trim() });
      notify(`${refireTarget.orderNumber} refired to Kitchen KDS.`);
      setRefireTarget(null);
      setRefireReason('');
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Refire failed.');
    }
  };

  const handleSaveOutletConfig = async (
    platform: 'swiggy' | 'zomato' | 'direct_online',
    outletId: string,
    autoAcceptOrders: boolean,
    menuSyncEnabled: boolean
  ) => {
    try {
      await api.updateIntegration(platform, { outletId, autoAcceptOrders, menuSyncEnabled });
      notify(`Saved ${platform.toUpperCase()} integration settings.`);
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update integration.');
    }
  };

  const handleSimulateOnlineOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simDishId) return;
    setSimBusy(true);
    try {
      const res = await api.simulateOnlineOrder(simPlatform, {
        items: [{ menuItemId: simDishId, quantity: simQty }],
        packagingNotes: simNotes,
      });
      notify(
        `Ingested ${simPlatform.toUpperCase()} test order ${res.order.externalOrderId} → ${res.order.orderNumber} (${res.tickets.length} KDS ticket).`
      );
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Simulation failed.');
    } finally {
      setSimBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div role="status" className="rounded-xl border border-slate-200 dark:border-dusk bg-slate-900 dark:bg-orange-600 px-4 py-3 text-sm text-white">
          {feedback}
        </div>
      )}

      {mode === 'online' && (
        <div className="space-y-5">
          {/* Platform Adapter Cards */}
          <div className="grid gap-4 md:grid-cols-2">
            {snapshot.platforms.map((cfg) => (
              <PlatformConfigCard
                key={cfg.id}
                cfg={cfg}
                onSave={handleSaveOutletConfig}
              />
            ))}
          </div>

          {/* Sandbox Order Simulator */}
          <form
            onSubmit={handleSimulateOnlineOrder}
            className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Online Webhook Adapter Test Simulator
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Tests real Swiggy/Zomato payload normalization, commission tracking, and Kitchen KDS routing without fabricating live partner API credentials.
                </p>
              </div>
              <span className="font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                SANDBOX ADAPTER ACTIVE
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Platform</label>
                <select
                  value={simPlatform}
                  onChange={(e) => setSimPlatform(e.target.value as 'swiggy' | 'zomato')}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  <option value="swiggy">Swiggy</option>
                  <option value="zomato">Zomato</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Menu Dish</label>
                <select
                  value={simDishId}
                  onChange={(e) => setSimDishId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  {snapshot.menuItems.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({cur}{m.price})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={simQty}
                  onChange={(e) => setSimQty(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Packaging Note</label>
                <input
                  type="text"
                  value={simNotes}
                  onChange={(e) => setSimNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={simBusy}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {simBusy ? 'Ingesting...' : `Simulate ${simPlatform.toUpperCase()} Order`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order #, table, external platform ID..."
            className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {mode === 'orders' && (
            <select
              aria-label="Filter by channel"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Channels</option>
              <option value="dine_in_qr">Dine-In QR</option>
              <option value="waiter">Waiter POS</option>
              <option value="swiggy">Swiggy</option>
              <option value="zomato">Zomato</option>
              <option value="takeaway">Takeaway</option>
            </select>
          )}
          <select
            aria-label="Filter by order status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Statuses</option>
            {ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 dark:border-dusk bg-slate-50 dark:bg-slate-800/70 text-slate-500 dark:text-slate-300">
            <tr>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Channel / Table</th>
              <th className="px-4 py-3 font-medium">Items</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                  No orders match the current filter.
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{order.orderNumber}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {order.remakeCount > 0 ? ` · Refired ${order.remakeCount}x` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      {order.tableNumber ? `Table ${order.tableNumber}` : order.channel.toUpperCase()}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {order.channel}
                      {order.externalOrderId ? ` · ${order.externalOrderId}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <div className="truncate text-slate-800 dark:text-slate-200">
                      {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Priority: {order.priority.toUpperCase()}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {cur}{order.totalAmount.toFixed(2)}
                    {order.platformFee ? (
                      <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                        Fee: {cur}{order.platformFee.toFixed(0)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-semibold ${
                        order.status === 'Cancelled'
                          ? 'text-red-600 dark:text-red-400'
                          : order.status === 'Ready' || order.status === 'Served' || order.status === 'Completed'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-orange-700 dark:text-amethyst'
                      }`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 uppercase font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    {order.paymentStatus}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(order)}
                        className="rounded-lg border border-slate-200 dark:border-dusk px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Timeline
                      </button>
                      {order.status === 'Submitted' && (
                        <button
                          type="button"
                          onClick={() => void handleStatusUpdate(order, 'Confirmed')}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                        >
                          <Check className="h-3 w-3" /> Accept
                        </button>
                      )}
                      {['swiggy', 'zomato', 'direct_online'].includes(order.channel) &&
                        order.status === 'Ready' && (
                          <button
                            type="button"
                            onClick={() => void handleStatusUpdate(order, 'Picked Up')}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-royal px-2.5 py-1 text-[11px] font-medium text-white"
                          >
                            <ShoppingBag className="h-3 w-3" /> Handover
                          </button>
                        )}
                      {order.status !== 'Cancelled' && order.status !== 'Completed' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handlePriorityToggle(order)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-dusk px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            title="Toggle Rush Priority"
                          >
                            <Flame className="h-3 w-3 text-orange-600 dark:text-amethyst" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRefireTarget(order)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-dusk px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            title="Refire to Kitchen"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelTarget(order)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900/60 px-2 py-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                            title="Cancel Order"
                          >
                            <XCircle className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Integration Logs when in online mode */}
      {mode === 'online' && (
        <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Webhook &amp; Integration Event Log</h3>
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 max-h-60 overflow-y-auto text-xs">
            {snapshot.integrationEvents.map((ev) => (
              <div key={ev.id} className="py-2.5 flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 uppercase">{ev.platform}</span>
                  <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{ev.eventType}</span>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">{ev.message}</p>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0">
                  {new Date(ev.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order Detail & Timeline Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {selectedOrder.orderNumber} · {selectedOrder.status}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedOrder.channel} {selectedOrder.tableNumber ? `· Table ${selectedOrder.tableNumber}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              >
                Close
              </button>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3.5 text-xs space-y-1.5 text-slate-800 dark:text-slate-200">
              {selectedOrder.items.map((it) => (
                <div key={it.id} className="flex justify-between">
                  <span>
                    {it.quantity}× {it.name}
                    {it.modifiers.length > 0 ? ` (${it.modifiers.map((m) => m.name).join(', ')})` : ''}
                  </span>
                  <span className="font-mono font-semibold">{cur}{it.lineTotal.toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t border-slate-200 dark:border-dusk pt-2 flex justify-between font-semibold text-slate-900 dark:text-slate-100">
                <span>Total</span>
                <span className="font-mono">{cur}{selectedOrder.totalAmount.toFixed(2)}</span>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Timeline</h4>
              <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                {selectedOrder.timeline.map((ev, idx) => (
                  <div key={idx} className="flex items-start justify-between text-xs border-b border-slate-100 dark:border-slate-800 pb-2">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{ev.status}</span>
                      <span className="text-slate-500 dark:text-slate-400"> · {ev.actorName}</span>
                      {ev.note && <div className="text-slate-600 dark:text-slate-300 mt-0.5">{ev.note}</div>}
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title={`Cancel ${cancelTarget?.orderNumber || ''}?`}
        description="Cancelling an order removes it from active billing and notifies Kitchen KDS. An audit entry is permanently recorded."
        confirmLabel="Confirm Cancellation"
        destructive
        requireReason
        reasonValue={cancelReason}
        onReasonChange={setCancelReason}
        onCancel={() => {
          setCancelTarget(null);
          setCancelReason('');
        }}
        onConfirm={() => void handleCancelConfirm()}
      />

      <ConfirmDialog
        open={Boolean(refireTarget)}
        title={`Refire ${refireTarget?.orderNumber || ''}?`}
        description="Creates an urgent kitchen remake alert and re-queues station tickets."
        confirmLabel="Refire to Kitchen"
        requireReason
        reasonValue={refireReason}
        onReasonChange={setRefireReason}
        onCancel={() => {
          setRefireTarget(null);
          setRefireReason('');
        }}
        onConfirm={() => void handleRefireConfirm()}
      />
    </div>
  );
};

interface PlatformConfigCardProps {
  cfg: RestaurantSnapshot['platforms'][number];
  onSave: (
    platform: 'swiggy' | 'zomato' | 'direct_online',
    outletId: string,
    autoAccept: boolean,
    menuSync: boolean
  ) => Promise<void>;
}

const PlatformConfigCard: React.FC<PlatformConfigCardProps> = ({ cfg, onSave }) => {
  const [outletId, setOutletId] = useState(cfg.outletId);
  const [autoAccept, setAutoAccept] = useState(cfg.autoAcceptOrders);
  const [menuSync, setMenuSync] = useState(cfg.menuSyncEnabled);
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 flex flex-col justify-between space-y-4">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{cfg.displayName}</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Commission: {cfg.commissionPercent}% · Webhook: <span className="font-mono">{cfg.webhookEndpoint}</span>
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
              cfg.connectionStatus === 'connected' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            <ExternalLink className="h-3 w-3" />
            {cfg.connectionStatus === 'connected' ? 'LIVE' : 'SANDBOX'}
          </span>
        </div>

        <div className="mt-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 p-2.5 text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
          <span>{cfg.requirementsNote}</span>
        </div>

        <div className="mt-3 space-y-2.5 text-xs">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Outlet / Store ID</label>
            <input
              type="text"
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={autoAccept}
              onChange={(e) => setAutoAccept(e.target.checked)}
            />
            Auto-accept verified webhook orders to KDS
          </label>
          <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={menuSync}
              onChange={(e) => setMenuSync(e.target.checked)}
            />
            Sync item stock-out availability flags
          </label>
        </div>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(cfg.platform, outletId, autoAccept, menuSync);
          } finally {
            setSaving(false);
          }
        }}
        className="w-full rounded-xl border border-slate-200 dark:border-dusk bg-slate-900 dark:bg-royal px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-plum disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Adapter Settings'}
      </button>
    </div>
  );
};
