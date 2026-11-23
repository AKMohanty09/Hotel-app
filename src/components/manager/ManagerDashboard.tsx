import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  CreditCard,
  Flame,
  TrendingUp,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import type { RestaurantSnapshot } from '../../types/domain';

interface ManagerDashboardProps {
  snapshot: RestaurantSnapshot;
  onNavigateTab: (tab: string) => void;
}

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({
  snapshot,
  onNavigateTab,
}) => {
  const cur = snapshot.settings.currencySymbol || '₹';

  const metrics = useMemo(() => {
    const activeOrders = snapshot.orders.filter((o) => o.status !== 'Cancelled');
    const cancelledOrders = snapshot.orders.filter((o) => o.status === 'Cancelled');

    const totalSales = activeOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const dineInSales = activeOrders
      .filter((o) => o.channel === 'dine_in_qr' || o.channel === 'waiter')
      .reduce((sum, o) => sum + o.totalAmount, 0);
    const onlineSales = activeOrders
      .filter((o) => o.channel === 'swiggy' || o.channel === 'zomato' || o.channel === 'direct_online')
      .reduce((sum, o) => sum + o.totalAmount, 0);
    const takeawaySales = activeOrders
      .filter((o) => o.channel === 'takeaway')
      .reduce((sum, o) => sum + o.totalAmount, 0);

    const aov = activeOrders.length > 0 ? totalSales / activeOrders.length : 0;

    const nonArchivedTables = snapshot.tables.filter((t) => !t.isArchived);
    const availableTables = nonArchivedTables.filter((t) => t.status === 'Available').length;
    const reservedTables = nonArchivedTables.filter((t) => t.status === 'Reserved').length;
    const cleaningTables = nonArchivedTables.filter((t) => t.status === 'Cleaning').length;
    const occupiedTables = nonArchivedTables.filter(
      (t) => !['Available', 'Reserved', 'Cleaning', 'Blocked'].includes(t.status)
    ).length;

    const pendingTickets = snapshot.tickets.filter(
      (t) => t.status === 'new' || t.status === 'accepted'
    ).length;
    const preparingTickets = snapshot.tickets.filter((t) => t.status === 'preparing').length;
    const readyTickets = snapshot.tickets.filter((t) => t.status === 'ready').length;
    const delayedTickets = snapshot.tickets.filter((t) => t.status === 'delayed').length;

    const pendingPayments = snapshot.bills
      .filter((b) => b.status !== 'paid' && b.status !== 'refunded')
      .reduce((sum, b) => sum + b.balanceAmount, 0);

    const avgPrepTime =
      snapshot.tickets.length > 0
        ? Math.round(
            snapshot.tickets.reduce((s, t) => s + t.estimatedMinutes, 0) /
              snapshot.tickets.length
          )
        : 15;

    const lowStockItems = snapshot.inventory.filter((i) => i.currentStock <= i.minStock);
    const staffOnDuty = snapshot.staff.filter((s) => s.onDuty && s.status === 'active').length;

    // Top-selling items
    const itemMap = new Map<string, { name: string; qty: number; rev: number }>();
    for (const o of activeOrders) {
      for (const it of o.items) {
        const curItem = itemMap.get(it.menuItemId) || { name: it.name, qty: 0, rev: 0 };
        curItem.qty += it.quantity;
        curItem.rev += it.lineTotal;
        itemMap.set(it.menuItemId, curItem);
      }
    }
    const topItems = Array.from(itemMap.values())
      .sort((a, b) => b.rev - a.rev)
      .slice(0, 5);

    // Category performance
    const catRevenue = new Map<string, number>();
    for (const o of activeOrders) {
      for (const it of o.items) {
        const menu = snapshot.menuItems.find((m) => m.id === it.menuItemId);
        const cat = snapshot.categories.find((c) => c.id === menu?.categoryId)?.name || 'Other';
        catRevenue.set(cat, (catRevenue.get(cat) || 0) + it.lineTotal);
      }
    }
    const categories = Array.from(catRevenue.entries())
      .map(([name, revenue]) => ({ name, revenue }))
      .sort((a, b) => b.revenue - a.revenue);

    // Hourly sales buckets (11:00 to 22:00)
    const hours = ['11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p'];
    const hourlyTotals = hours.map((label, idx) => {
      const targetHour = 11 + idx;
      const matching = activeOrders
        .filter((o) => new Date(o.createdAt).getHours() === targetHour)
        .reduce((s, o) => s + o.totalAmount, 0);
      return { label, amount: Math.round(matching) };
    });
    const currentHourIndex = Math.max(0, Math.min(11, new Date().getHours() - 11));
    if (hourlyTotals.every((h) => h.amount === 0) && totalSales > 0) {
      hourlyTotals[currentHourIndex].amount = Math.round(totalSales);
    }

    return {
      totalSales,
      dineInSales,
      onlineSales,
      takeawaySales,
      orderCount: activeOrders.length,
      cancelledCount: cancelledOrders.length,
      aov,
      availableTables,
      occupiedTables,
      reservedTables,
      cleaningTables,
      totalTables: nonArchivedTables.length,
      pendingTickets,
      preparingTickets,
      readyTickets,
      delayedTickets,
      pendingPayments,
      avgPrepTime,
      lowStockItems,
      staffOnDuty,
      topItems,
      categories,
      hourlyTotals,
    };
  }, [snapshot]);

  const maxHourly = Math.max(100, ...metrics.hourlyTotals.map((h) => h.amount));
  const maxCat = Math.max(100, ...metrics.categories.map((c) => c.revenue));

  const channelData = [
    { label: 'Dine-In', value: metrics.dineInSales, color: 'bg-orange-600' },
    { label: 'Swiggy / Zomato / Online', value: metrics.onlineSales, color: 'bg-slate-900 dark:bg-slate-300' },
    { label: 'Takeaway', value: metrics.takeawaySales, color: 'bg-emerald-600' },
  ];
  const maxChannel = Math.max(100, ...channelData.map((c) => c.value));

  return (
    <div className="space-y-6">
      {/* Primary KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Today&apos;s Total Sales</span>
            <TrendingUp className="h-4 w-4 text-orange-600" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {cur}{metrics.totalSales.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Dine-in {cur}{Math.round(metrics.dineInSales)}</span>
            <span>·</span>
            <span>Online {cur}{Math.round(metrics.onlineSales)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Order Volume &amp; AOV</span>
            <UtensilsCrossed className="h-4 w-4 text-slate-700 dark:text-slate-300" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {metrics.orderCount} Orders
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span>AOV {cur}{metrics.aov.toFixed(0)}</span>
            <span>·</span>
            <span>{metrics.cancelledCount} Cancelled</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Floor Utilization</span>
            <Users className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {metrics.occupiedTables}/{metrics.totalTables} Active
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{metrics.availableTables} Free</span>
            <span>·</span>
            <span>{metrics.reservedTables} Reserved</span>
            <span>·</span>
            <span>{metrics.cleaningTables} Cleaning</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Pending Collections</span>
            <CreditCard className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {cur}{metrics.pendingPayments.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{metrics.staffOnDuty} Staff on duty</span>
            <button
              type="button"
              onClick={() => onNavigateTab('billing')}
              className="font-medium text-orange-600 hover:underline whitespace-nowrap"
            >
              Open Billing
            </button>
          </div>
        </div>
      </div>

      {/* Live Kitchen & Operational Health Strip */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Hourly Sales Distribution</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Live order totals captured across dining &amp; online channels</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('reports')}
              className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 whitespace-nowrap"
            >
              Full Reports
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-5">
            <svg viewBox="0 0 600 175" className="w-full h-44 overflow-visible" role="img" aria-label="Hourly Sales Bar Chart">
              <line x1="0" y1="140" x2="600" y2="140" className="stroke-slate-200 dark:stroke-slate-800" strokeWidth="1" />
              <line x1="0" y1="70" x2="600" y2="70" className="stroke-slate-100 dark:stroke-slate-800/60" strokeWidth="1" strokeDasharray="3 3" />
              {metrics.hourlyTotals.map((h, i) => {
                const barH = Math.max(4, Math.round((h.amount / maxHourly) * 124));
                const x = i * 50 + 10;
                const y = 140 - barH;
                return (
                  <g key={h.label}>
                    <rect
                      x={x}
                      y={y}
                      width="30"
                      height={barH}
                      rx="4"
                      className={h.amount > 0 ? 'fill-orange-600' : 'fill-slate-200 dark:fill-slate-800'}
                    />
                    {h.amount > 0 && (
                      <text
                        x={x + 15}
                        y={y - 6}
                        textAnchor="middle"
                        className="fill-slate-700 dark:fill-slate-300 text-[10px] font-mono"
                      >
                        {h.amount >= 1000 ? `${(h.amount / 1000).toFixed(1)}k` : h.amount}
                      </text>
                    )}
                    <text
                      x={x + 15}
                      y="158"
                      textAnchor="middle"
                      className="fill-slate-500 dark:fill-slate-400 text-[10px]"
                    >
                      {h.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Kitchen Queue &amp; Prep</h2>
              <button
                type="button"
                onClick={() => onNavigateTab('kitchen')}
                className="text-xs font-medium text-orange-600 hover:underline whitespace-nowrap"
              >
                Monitor KDS
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">Pending / Queued</div>
                <div className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100">{metrics.pendingTickets}</div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">Preparing</div>
                <div className="mt-1 font-mono text-xl font-bold text-orange-600 dark:text-orange-400">{metrics.preparingTickets}</div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">Ready for Pickup</div>
                <div className="mt-1 font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400">{metrics.readyTickets}</div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">Delayed Tickets</div>
                <div className={`mt-1 font-mono text-xl font-bold ${metrics.delayedTickets > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
                  {metrics.delayedTickets}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3 text-xs text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              Avg Estimated Prep Time
            </span>
            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{metrics.avgPrepTime} mins</span>
          </div>
        </div>
      </div>

      {/* Bottom Analytical Trio: Channel Comparison, Category Performance, Top Dishes & Low Stock */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Channel Comparison</h2>
          <div className="mt-4 space-y-4">
            {channelData.map((ch) => (
              <div key={ch.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{ch.label}</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {cur}{ch.value.toFixed(0)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-2 rounded-full ${ch.color}`}
                    style={{ width: `${Math.min(100, Math.round((ch.value / maxChannel) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Category Performance
          </h3>
          <div className="mt-3 space-y-2.5">
            {metrics.categories.map((cat) => (
              <div key={cat.name} className="flex items-center gap-3 text-xs">
                <span className="w-24 truncate text-slate-600 dark:text-slate-400">{cat.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-1.5 rounded-full bg-slate-800 dark:bg-orange-500"
                    style={{ width: `${Math.min(100, Math.round((cat.revenue / maxCat) * 100))}%` }}
                  />
                </div>
                <span className="font-mono text-slate-900 dark:text-slate-100">{cur}{Math.round(cat.revenue)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Top-Selling Dishes</h2>
            <Flame className="h-4 w-4 text-orange-600" />
          </div>
          {metrics.topItems.length === 0 ? (
            <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">No active orders recorded yet.</p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {metrics.topItems.map((it, idx) => (
                <div key={it.name} className="flex items-center justify-between py-2.5 text-xs">
                  <div className="min-w-0 pr-3">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {idx + 1}. {it.name}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">{it.qty} portions sold</div>
                  </div>
                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                    {cur}{it.rev.toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Low-Stock Alerts</h2>
            <button
              type="button"
              onClick={() => onNavigateTab('inventory')}
              className="text-xs font-medium text-orange-600 hover:underline whitespace-nowrap"
            >
              Manage Stock
            </button>
          </div>
          {metrics.lowStockItems.length === 0 ? (
            <div className="mt-6 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/50 p-4 text-xs text-emerald-800 dark:text-emerald-300">
              All tracked inventory ingredients are above minimum par thresholds.
            </div>
          ) : (
            <div className="mt-4 space-y-2.5">
              {metrics.lowStockItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2.5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{item.name}</div>
                      <div className="text-amber-800 dark:text-amber-300">Min par: {item.minStock} {item.unit}</div>
                    </div>
                  </div>
                  <span className="font-mono font-bold text-red-700 dark:text-red-400 shrink-0">
                    {item.currentStock} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
