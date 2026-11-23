import React from 'react';
import { AlertTriangle, BellRing, CheckCircle2, Wifi, WifiOff, X } from 'lucide-react';
import type { RealtimeConnectionStatus } from '../../lib/realtimeEvents';

export interface LiveAlertItem {
  id: string;
  title: string;
  message: string;
  tone: 'info' | 'success' | 'urgent';
  createdAt: string;
}

export const RealtimeStatusBadge: React.FC<{
  status: RealtimeConnectionStatus;
  compact?: boolean;
}> = ({ status, compact = false }) => {
  const cfg =
    status === 'connected'
      ? {
          label: 'Live',
          dot: 'bg-emerald-500',
          box: 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
          Icon: Wifi,
        }
      : status === 'reconnecting'
      ? {
          label: 'Reconnecting',
          dot: 'bg-amber-500 animate-pulse',
          box: 'border-amber-200 dark:border-amber-800/80 bg-amber-50/90 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
          Icon: Wifi,
        }
      : {
          label: 'Offline',
          dot: 'bg-red-500',
          box: 'border-red-200 dark:border-red-800/80 bg-red-50/90 dark:bg-red-950/60 text-red-700 dark:text-red-300',
          Icon: WifiOff,
        };

  return (
    <span
      role="status"
      aria-label={`Realtime sync status: ${cfg.label}`}
      title={`Realtime connection: ${cfg.label}`}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${cfg.box}`}
    >
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      {!compact && <span>{cfg.label}</span>}
    </span>
  );
};

export const LiveAlertToaster: React.FC<{
  alerts: LiveAlertItem[];
  onDismiss: (id: string) => void;
}> = ({ alerts, onDismiss }) => {
  if (alerts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 pointer-events-none"
    >
      {alerts.map((al) => {
        const borderClass =
          al.tone === 'urgent'
            ? 'border-orange-400 dark:border-orange-500 bg-white dark:bg-slate-900'
            : al.tone === 'success'
            ? 'border-emerald-400 dark:border-emerald-600 bg-white dark:bg-slate-900'
            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900';

        const Icon =
          al.tone === 'urgent'
            ? AlertTriangle
            : al.tone === 'success'
            ? CheckCircle2
            : BellRing;

        const iconColor =
          al.tone === 'urgent'
            ? 'text-orange-600 dark:text-orange-400'
            : al.tone === 'success'
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-sky-600 dark:text-sky-400';

        return (
          <div
            key={al.id}
            role="status"
            className={`pointer-events-auto rounded-2xl border p-3.5 shadow-xl backdrop-blur-md flex items-start gap-3 transition-all ${borderClass}`}
          >
            <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} />
            <div className="min-w-0 flex-1 text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {al.title}
              </div>
              <p className="mt-0.5 text-slate-600 dark:text-slate-300 leading-snug">
                {al.message}
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss live alert"
              onClick={() => onDismiss(al.id)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export function playRealtimeChime(kind: 'order' | 'ready' | 'urgent' = 'order') {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const startFreq = kind === 'urgent' ? 987.77 : kind === 'ready' ? 783.99 : 659.25;
    const endFreq = kind === 'urgent' ? 1318.51 : kind === 'ready' ? 1046.5 : 880;
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.09, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.32);
  } catch {
    // Ignore autoplay restriction errors prior to user interaction
  }
}
