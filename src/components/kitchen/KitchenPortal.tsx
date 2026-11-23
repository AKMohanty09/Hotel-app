import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Maximize2,
  Minimize2,
  PackageCheck,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { api } from '../../services/api';
import type { KitchenTicket, RestaurantSnapshot, TicketStatus } from '../../types/domain';

interface KitchenPortalProps {
  snapshot: RestaurantSnapshot;
  onRefresh: () => Promise<void>;
}

function playKitchenChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Audio playback blocked before user gesture
  }
}

export const KitchenPortal: React.FC<KitchenPortalProps> = ({ snapshot, onRefresh }) => {
  const [stationFilter, setStationFilter] = useState<string>('all');
  const [showHistory, setShowHistory] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [delayModalTicket, setDelayModalTicket] = useState<KitchenTicket | null>(null);
  const [delayReason, setDelayReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const prevNewCountRef = useRef<number>(
    snapshot.tickets.filter((t) => t.status === 'new').length
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const newCount = snapshot.tickets.filter((t) => t.status === 'new').length;
    if (soundEnabled && newCount > prevNewCountRef.current) {
      playKitchenChime();
    }
    prevNewCountRef.current = newCount;
  }, [snapshot.tickets, soundEnabled]);

  const filteredTickets = useMemo(() => {
    return snapshot.tickets.filter((t) => {
      if (stationFilter !== 'all' && t.stationId !== stationFilter) return false;
      return true;
    });
  }, [snapshot.tickets, stationFilter]);

  const columns = useMemo(() => {
    return {
      new: filteredTickets.filter((t) => t.status === 'new' || t.status === 'accepted'),
      preparing: filteredTickets.filter((t) => t.status === 'preparing'),
      ready: filteredTickets.filter((t) => t.status === 'ready' || t.status === 'packed'),
      delayed: filteredTickets.filter((t) => t.status === 'delayed'),
    };
  }, [filteredTickets]);

  const historyTickets = useMemo(
    () =>
      filteredTickets.filter(
        (t) => t.status === 'served' || t.status === 'picked_up' || t.status === 'cancelled'
      ),
    [filteredTickets]
  );

  const handleTicketAction = async (
    ticket: KitchenTicket,
    status?: TicketStatus,
    toggleItemId?: string
  ) => {
    setBusyId(ticket.id);
    try {
      await api.updateKitchenTicket(ticket.id, { status, toggleItemId });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmitDelay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!delayModalTicket || !delayReason.trim()) return;
    setBusyId(delayModalTicket.id);
    try {
      await api.updateKitchenTicket(delayModalTicket.id, {
        status: 'delayed',
        delayReason: delayReason.trim(),
      });
      setDelayModalTicket(null);
      setDelayReason('');
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      void document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const formatElapsed = (iso: string) => {
    const sec = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const renderTicketCard = (ticket: KitchenTicket) => {
    const isDelivery =
      ticket.channel === 'swiggy' ||
      ticket.channel === 'zomato' ||
      ticket.channel === 'takeaway' ||
      ticket.channel === 'direct_online';
    const elapsedMin = (nowMs - new Date(ticket.createdAt).getTime()) / 60000;
    const isOverdue = elapsedMin > ticket.estimatedMinutes && ticket.status !== 'ready';

    return (
      <article
        key={ticket.id}
        className={`rounded-2xl border p-4 space-y-3 bg-slate-900 ${
          ticket.status === 'delayed' || isOverdue
            ? 'border-red-500/70'
            : ticket.priority === 'rush' || ticket.priority === 'vip'
            ? 'border-amber-500/70'
            : 'border-slate-800'
        }`}
      >
        <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-bold text-white">
                {ticket.orderNumber}
              </span>
              {ticket.priority !== 'normal' && (
                <span className="text-xs font-bold text-amber-400 uppercase">
                  {ticket.priority}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-slate-300">
              {ticket.tableNumber ? `Table ${ticket.tableNumber}` : ticket.channel.toUpperCase()}
              {ticket.externalOrderId ? ` (${ticket.externalOrderId})` : ''}
              {' · '}
              {ticket.stationName}
            </div>
          </div>

          <div
            className={`font-mono text-sm font-bold tabular-nums flex items-center gap-1 ${
              isOverdue ? 'text-red-400' : 'text-slate-300'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            {formatElapsed(ticket.createdAt)}
          </div>
        </div>

        {ticket.remakeReason && (
          <div className="rounded-lg bg-red-950/70 border border-red-700/50 px-3 py-1.5 text-xs text-red-200 font-medium">
            REFIRE: {ticket.remakeReason}
          </div>
        )}
        {ticket.delayReason && (
          <div className="rounded-lg bg-amber-950/70 border border-amber-700/50 px-3 py-1.5 text-xs text-amber-200">
            Delay: {ticket.delayReason}
          </div>
        )}

        <ul className="space-y-2">
          {ticket.items.map((item) => (
            <li key={item.orderItemId}>
              <button
                type="button"
                onClick={() => void handleTicketAction(ticket, undefined, item.orderItemId)}
                className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                  item.status === 'ready'
                    ? 'border-emerald-700 bg-emerald-950/50 text-emerald-200'
                    : 'border-slate-800 bg-slate-950/60 text-slate-100 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {item.quantity} × {item.name}
                  </span>
                  {item.status === 'ready' && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
                </div>
                {item.modifiers.length > 0 && (
                  <div className="mt-0.5 text-xs text-amber-300">
                    + {item.modifiers.join(', ')}
                  </div>
                )}
                {item.instructions && (
                  <div className="mt-0.5 text-xs text-sky-300">
                    Note: {item.instructions}
                  </div>
                )}
                {item.allergens && item.allergens.length > 0 && (
                  <div className="mt-0.5 text-[11px] font-medium text-red-300">
                    Allergen: {item.allergens.join(', ')}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2 pt-1">
          {(ticket.status === 'new' || ticket.status === 'accepted') && (
            <button
              type="button"
              disabled={busyId === ticket.id}
              onClick={() => void handleTicketAction(ticket, 'preparing')}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-xs font-bold text-white hover:bg-orange-500"
            >
              <Play className="h-3.5 w-3.5" />
              Start Preparing
            </button>
          )}
          {(ticket.status === 'preparing' || ticket.status === 'delayed') && (
            <button
              type="button"
              disabled={busyId === ticket.id}
              onClick={() => void handleTicketAction(ticket, 'ready')}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500"
            >
              <Check className="h-4 w-4" />
              Mark Ready
            </button>
          )}
          {ticket.status === 'ready' && isDelivery && (
            <button
              type="button"
              disabled={busyId === ticket.id}
              onClick={() => void handleTicketAction(ticket, 'packed')}
              className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500"
            >
              <PackageCheck className="h-4 w-4" />
              Mark Packed
            </button>
          )}
          {ticket.status === 'packed' && (
            <button
              type="button"
              disabled={busyId === ticket.id}
              onClick={() => void handleTicketAction(ticket, 'picked_up')}
              className="flex-1 min-h-[44px] rounded-xl bg-slate-700 px-3 py-2 text-xs font-bold text-white hover:bg-slate-600"
            >
              Courier Picked Up
            </button>
          )}
          {ticket.status !== 'ready' && ticket.status !== 'packed' && ticket.status !== 'delayed' && (
            <button
              type="button"
              onClick={() => setDelayModalTicket(ticket)}
              className="min-h-[44px] rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-slate-800"
            >
              Delay
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="min-h-screen bg-obsidian text-slate-100 p-3 sm:p-4 space-y-4">
      {/* KDS Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dusk bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full">
          <button
            type="button"
            onClick={() => setStationFilter('all')}
            className={`rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 ${
              stationFilter === 'all' ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            All Stations
          </button>
          {snapshot.stations.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setStationFilter(st.id)}
              className={`rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap ${
                stationFilter === st.id ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {st.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowHistory((h) => !h)}
            className={`rounded-xl px-3 py-2 text-xs font-semibold border ${
              showHistory
                ? 'border-orange-500 bg-orange-950/50 text-orange-300'
                : 'border-slate-700 bg-slate-800 text-slate-300'
            }`}
          >
            History ({historyTickets.length})
          </button>
          <button
            type="button"
            aria-label={soundEnabled ? 'Mute sound alerts' : 'Enable sound alerts'}
            onClick={() => setSoundEnabled((s) => !s)}
            className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label="Toggle fullscreen"
            onClick={toggleFullscreen}
            className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!showHistory ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(
            [
              ['NEW', columns.new, 'text-orange-400'],
              ['PREPARING', columns.preparing, 'text-sky-400'],
              ['READY', columns.ready, 'text-emerald-400'],
              ['DELAYED', columns.delayed, 'text-red-400'],
            ] as const
          ).map(([title, list, accent]) => (
            <section key={title} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3 space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className={`font-display text-sm font-bold tracking-wide ${accent}`}>
                  {title}
                </h2>
                <span className="font-mono text-xs font-bold text-slate-400 tabular-nums">
                  {list.length}
                </span>
              </div>
              {list.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
                  No {title.toLowerCase()} tickets
                </div>
              ) : (
                <div className="space-y-3">{list.map(renderTicketCard)}</div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="font-display text-base font-bold text-white mb-4">
            Completed &amp; Served Tickets
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {historyTickets.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs space-y-1">
                <div className="flex justify-between font-mono font-bold text-slate-200">
                  <span>{t.orderNumber}</span>
                  <span className="uppercase text-emerald-400">{t.status}</span>
                </div>
                <div className="text-slate-400">
                  {t.stationName} · {t.tableNumber || t.channel}
                </div>
                <div className="text-slate-300 pt-1">
                  {t.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {delayModalTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={handleSubmitDelay}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-amber-400 font-semibold">
              <AlertTriangle className="h-5 w-5" />
              Report Kitchen Delay · {delayModalTicket.orderNumber}
            </div>
            <input
              type="text"
              required
              value={delayReason}
              onChange={(e) => setDelayReason(e.target.value)}
              placeholder="Reason (e.g., Oven batch turnaround +8 mins)"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDelayModalTicket(null)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white"
              >
                Notify Floor &amp; Manager
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
