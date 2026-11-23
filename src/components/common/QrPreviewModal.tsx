import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, Printer, ShieldAlert, X } from 'lucide-react';
import type { RestaurantTable } from '../../types/domain';
import { buildTableQrUrl } from '../../lib/tableRules';
import {
  downloadTableQrPng,
  downloadTablesQrPdf,
  generateQrDataUrl,
} from '../../lib/exportUtils';

interface QrPreviewModalProps {
  table: RestaurantTable | null;
  restaurantName: string;
  logoUrl?: string;
  onClose: () => void;
  onOpenCustomerMenu: (qrToken: string) => void;
  onRevokeQr: (table: RestaurantTable, reason: string) => Promise<void>;
}

export const QrPreviewModal: React.FC<QrPreviewModalProps> = ({
  table,
  restaurantName,
  logoUrl,
  onClose,
  onOpenCustomerMenu,
  onRevokeQr,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [revokeMode, setRevokeMode] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [busy, setBusy] = useState(false);

  const url = table ? buildTableQrUrl(window.location.origin, table.qrToken) : '';

  useEffect(() => {
    if (!url) return;
    let active = true;
    generateQrDataUrl(url, 420).then((data) => {
      if (active) setQrDataUrl(data);
    });
    return () => {
      active = false;
    };
  }, [url]);

  if (!table) return null;

  const handleRevoke = async () => {
    if (revokeReason.trim().length < 4) return;
    setBusy(true);
    try {
      await onRevokeQr(table, revokeReason.trim());
      setRevokeMode(false);
      setRevokeReason('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Table {table.tableNumber} Permanent QR
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {table.floor} · {table.section} · {table.capacity} Seats
            </p>
          </div>
          <button
            type="button"
            aria-label="Close QR modal"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-5">
          <div className="flex items-center gap-2">
            {logoUrl && (
              <img
                src={logoUrl}
                alt={restaurantName}
                referrerPolicy="no-referrer"
                className="h-7 w-7 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
              />
            )}
            <div className="text-xs font-semibold tracking-wide text-slate-900 dark:text-slate-100">
              {restaurantName}
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-white p-3 border border-slate-200 dark:border-dusk">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`Permanent QR code for Table ${table.tableNumber}`}
                className="h-48 w-48"
              />
            ) : (
              <div className="h-48 w-48 skeleton-shimmer rounded-lg" />
            )}
          </div>
          <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Scan to View Menu &amp; Order
          </div>
          <div className="mt-1 font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all text-center">
            {table.qrToken}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => void downloadTableQrPng(table, restaurantName, window.location.origin, logoUrl)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-dusk"
          >
            <Download className="h-3.5 w-3.5" />
            Download PNG
          </button>
          <button
            type="button"
            onClick={() => void downloadTablesQrPdf([table], restaurantName, window.location.origin)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-dusk"
          >
            <FileText className="h-3.5 w-3.5" />
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-dusk"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Label
          </button>
          <button
            type="button"
            onClick={() => onOpenCustomerMenu(table.qrToken)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-royal px-3 py-2 text-xs font-medium text-white hover:bg-plum"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Menu URL
          </button>
        </div>

        <div className="mt-4 border-t border-slate-100 dark:border-dusk pt-4">
          {!revokeMode ? (
            <button
              type="button"
              onClick={() => setRevokeMode(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Revoke &amp; Rotate Permanent QR
            </button>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-red-700 dark:text-red-300">
                Warning: Revoking invalidates printed QR stickers for Table {table.tableNumber}. This action is audited.
              </p>
              <input
                type="text"
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Reason (e.g., damaged sticker replaced)"
                className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRevokeMode(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy || revokeReason.trim().length < 4}
                  onClick={() => void handleRevoke()}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? 'Revoking...' : 'Confirm Revoke'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
