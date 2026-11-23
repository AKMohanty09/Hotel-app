import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonValue?: string;
  onReasonChange?: (val: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  requireReason = false,
  reasonValue = '',
  onReasonChange,
  onConfirm,
  onCancel,
  busy = false,
}) => {
  if (!open) return null;

  const canSubmit = !busy && (!requireReason || reasonValue.trim().length >= 3);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              destructive
                ? 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{description}</p>
          </div>
        </div>

        {requireReason && (
          <div className="mt-4">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Audit Reason (required)
            </label>
            <input
              type="text"
              value={reasonValue}
              onChange={(e) => onReasonChange?.(e.target.value)}
              placeholder="Enter reason for audit log..."
              className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-royal focus:outline-none"
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-dusk"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-royal hover:bg-plum'
            }`}
          >
            {busy ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
