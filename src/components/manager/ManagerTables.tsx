import React, { useMemo, useState } from 'react';
import {
  Archive,
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  Edit3,
  FileDown,
  Plus,
  Printer,
  QrCode,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  RestaurantSnapshot,
  RestaurantTable,
  TableStatus,
  TableType,
} from '../../types/domain';
import { downloadTablesQrPdf } from '../../lib/exportUtils';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { QrPreviewModal } from '../common/QrPreviewModal';

interface ManagerTablesProps {
  snapshot: RestaurantSnapshot;
  onRefresh: () => Promise<void>;
  onOpenCustomerPreview: (qrToken: string) => void;
}

const TABLE_STATUSES: TableStatus[] = [
  'Available',
  'Reserved',
  'Verification Pending',
  'Occupied',
  'Ordering',
  'Order Active',
  'Preparing',
  'Food Ready',
  'Bill Requested',
  'Payment Pending',
  'Cleaning',
  'Blocked',
];

const TABLE_TYPES: TableType[] = ['regular', 'couple', 'family', 'outdoor', 'vip'];

export const ManagerTables: React.FC<ManagerTablesProps> = ({
  snapshot,
  onRefresh,
  onOpenCustomerPreview,
}) => {
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Create / Edit modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [formNumber, setFormNumber] = useState('');
  const [formCapacity, setFormCapacity] = useState(4);
  const [formFloor, setFormFloor] = useState(snapshot.settings.floors[0] || 'Ground Floor');
  const [formSection, setFormSection] = useState(snapshot.settings.sections[0] || 'Main Hall');
  const [formType, setFormType] = useState<TableType>('regular');
  const [formWaiterId, setFormWaiterId] = useState('');
  const [formStatus, setFormStatus] = useState<TableStatus>('Available');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Modals
  const [qrTable, setQrTable] = useState<RestaurantTable | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RestaurantTable | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [moveSource, setMoveSource] = useState<RestaurantTable | null>(null);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [logsTable, setLogsTable] = useState<RestaurantTable | null>(null);

  const cur = snapshot.settings.currencySymbol || '₹';
  const waiters = useMemo(
    () => snapshot.staff.filter((s) => s.role === 'waiter' || s.role === 'shift_supervisor'),
    [snapshot.staff]
  );

  const visibleTables = useMemo(() => {
    return snapshot.tables.filter((t) => {
      if (!showArchived && t.isArchived) return false;
      if (showArchived && !t.isArchived) return false;
      if (floorFilter !== 'all' && t.floor !== floorFilter) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      return true;
    });
  }, [snapshot.tables, showArchived, floorFilter, statusFilter]);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 5000);
  };

  const openCreateModal = () => {
    setEditingTable(null);
    setFormNumber('');
    setFormCapacity(4);
    setFormFloor(snapshot.settings.floors[0] || 'Ground Floor');
    setFormSection(snapshot.settings.sections[0] || 'Main Hall');
    setFormType('regular');
    setFormWaiterId(waiters[0]?.id || '');
    setFormStatus('Available');
    setFormNotes('');
    setEditorOpen(true);
  };

  const openEditModal = (table: RestaurantTable) => {
    setEditingTable(table);
    setFormNumber(table.tableNumber);
    setFormCapacity(table.capacity);
    setFormFloor(table.floor);
    setFormSection(table.section);
    setFormType(table.tableType);
    setFormWaiterId(table.assignedWaiterId || '');
    setFormStatus(table.status);
    setFormNotes(table.notes || '');
    setEditorOpen(true);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNumber.trim()) return;
    setSaving(true);
    try {
      if (editingTable) {
        await api.updateTable(editingTable.id, {
          tableNumber: formNumber.trim(),
          capacity: Number(formCapacity),
          floor: formFloor,
          section: formSection,
          tableType: formType,
          assignedWaiterId: formWaiterId || undefined,
          status: formStatus,
          notes: formNotes.trim() || undefined,
        });
        showToast('ok', `Updated Table ${formNumber.trim()}. Permanent QR token preserved.`);
      } else {
        const res = await api.createTable({
          tableNumber: formNumber.trim(),
          capacity: Number(formCapacity),
          floor: formFloor,
          section: formSection,
          tableType: formType,
          assignedWaiterId: formWaiterId || undefined,
          status: formStatus,
          notes: formNotes.trim() || undefined,
        });
        showToast('ok', `Created Table ${res.table.tableNumber} with permanent QR token.`);
      }
      setEditorOpen(false);
      await onRefresh();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Unable to save table.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTable = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.deleteTable(deleteTarget.id);
      showToast('ok', `Table ${deleteTarget.tableNumber} deleted.`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Unable to delete table.');
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleMoveSession = async () => {
    if (!moveSource || !moveTargetId) return;
    try {
      await api.moveTableSession(moveSource.id, moveTargetId);
      showToast('ok', `Active session moved from ${moveSource.tableNumber}.`);
      setMoveSource(null);
      setMoveTargetId('');
      await onRefresh();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Unable to move session.');
    }
  };

  const handleBlockToggle = async (table: RestaurantTable) => {
    try {
      const nextStatus: TableStatus = table.status === 'Blocked' ? 'Available' : 'Blocked';
      await api.updateTable(table.id, { status: nextStatus });
      showToast('ok', `Table ${table.tableNumber} marked ${nextStatus}.`);
      await onRefresh();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const handleArchiveToggle = async (table: RestaurantTable) => {
    try {
      await api.updateTable(table.id, { isArchived: !table.isArchived });
      showToast(
        'ok',
        table.isArchived
          ? `Restored Table ${table.tableNumber}.`
          : `Archived Table ${table.tableNumber} (historical orders preserved).`
      );
      await onRefresh();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Archive failed.');
    }
  };

  const activeNonArchived = snapshot.tables.filter((t) => !t.isArchived);

  return (
    <div className="space-y-5">
      {message && (
        <div
          role={message.type === 'err' ? 'alert' : 'status'}
          className={`sticky top-16 z-20 rounded-xl border px-4 py-3 text-sm font-medium shadow-md ${
            message.type === 'err'
              ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300'
              : 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Filter by floor"
            value={floorFilter}
            onChange={(e) => setFloorFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Floors</option>
            {snapshot.settings.floors.map((fl) => (
              <option key={fl} value={fl}>{fl}</option>
            ))}
          </select>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Statuses</option>
            {TABLE_STATUSES.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={`rounded-xl border px-3 py-2 text-xs font-medium whitespace-nowrap ${
              showArchived
                ? 'border-slate-900 dark:border-royal bg-slate-900 dark:bg-royal text-white'
                : 'border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            {showArchived ? 'Viewing Archived' : 'Show Archived'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() =>
              void downloadTablesQrPdf(
                activeNonArchived,
                snapshot.settings.name,
                window.location.origin,
                'a4-grid'
              )
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <Printer className="h-3.5 w-3.5" />
            Bulk A4 QR PDF
          </button>
          <button
            type="button"
            onClick={() =>
              void downloadTablesQrPdf(
                activeNonArchived,
                snapshot.settings.name,
                window.location.origin,
                'compact-labels'
              )
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <FileDown className="h-3.5 w-3.5" />
            Compact Labels PDF
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Add Table
          </button>
        </div>
      </div>

      {/* Table Grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleTables.map((table) => {
          const activeSession = snapshot.sessions.find(
            (s) => s.tableId === table.id && s.status !== 'closed'
          );
          const sessionOrders = activeSession
            ? snapshot.orders.filter((o) => o.sessionId === activeSession.id && o.status !== 'Cancelled')
            : [];
          const orderTotal = sessionOrders.reduce((sum, o) => sum + o.totalAmount, 0);
          const waiter = snapshot.staff.find((s) => s.id === table.assignedWaiterId);
          const pendingVer = snapshot.verifications.find(
            (v) => v.tableId === table.id && (v.status === 'pending' || v.status === 'presence_confirmed')
          );
          const durationMin = activeSession
            ? Math.max(1, Math.round((Date.now() - new Date(activeSession.startedAt).getTime()) / 60000))
            : 0;

          const statusTone =
            table.status === 'Available'
              ? 'text-emerald-700 dark:text-emerald-400'
              : table.status === 'Blocked' || table.status === 'Verification Pending'
              ? 'text-red-700 dark:text-red-400'
              : table.status === 'Food Ready'
              ? 'text-orange-700 dark:text-amethyst'
              : 'text-amber-700 dark:text-amber-400';

          return (
            <div
              key={table.id}
              className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                        {table.tableNumber}
                      </h3>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {table.capacity} Seats · {table.tableType.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {table.floor} · {table.section}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold ${statusTone}`}>{table.status}</span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 text-xs">
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Assigned Waiter</div>
                    <div className="mt-0.5 font-medium text-slate-900 dark:text-slate-100 truncate">
                      {waiter?.name || 'Unassigned'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Session &amp; Total</div>
                    <div className="mt-0.5 font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {activeSession ? `${durationMin}m · ${cur}${orderTotal.toFixed(0)}` : 'Idle'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Verification</div>
                    <div className="mt-0.5 font-medium text-slate-800 dark:text-slate-200">
                      {pendingVer
                        ? pendingVer.presenceConfirmed
                          ? 'OTP Issued'
                          : 'Waiting Waiter'
                        : activeSession
                        ? 'OTP Verified'
                        : 'Ready'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 dark:text-slate-400">Permanent QR</div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">
                      {table.qrToken}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 dark:border-slate-800 pt-3">
                <button
                  type="button"
                  onClick={() => setQrTable(table)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <QrCode className="h-3.5 w-3.5 text-orange-600 dark:text-amethyst" />
                  QR
                </button>
                <button
                  type="button"
                  onClick={() => openEditModal(table)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit
                </button>
                {activeSession && (
                  <button
                    type="button"
                    onClick={() => {
                      setMoveSource(table);
                      const firstFree = activeNonArchived.find(
                        (t) => t.id !== table.id && t.status === 'Available'
                      );
                      setMoveTargetId(firstFree?.id || '');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    Move
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setLogsTable(table)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Logs
                </button>
                <button
                  type="button"
                  onClick={() => void handleBlockToggle(table)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  {table.status === 'Blocked' ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      Unblock
                    </>
                  ) : (
                    <>
                      <Ban className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      Block
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleArchiveToggle(table)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <Archive className="h-3.5 w-3.5" />
                  {table.isArchived ? 'Restore' : 'Archive'}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(table)}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit Modal */}
      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveTable}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {editingTable ? `Edit Table ${editingTable.tableNumber}` : 'Create New Table'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {editingTable
                    ? `Permanent QR token (${editingTable.qrToken}) will remain unchanged.`
                    : 'A unique, permanent, non-sequential QR token will be automatically generated.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Table Number / Name
                </label>
                <input
                  type="text"
                  required
                  value={formNumber}
                  onChange={(e) => setFormNumber(e.target.value)}
                  placeholder="e.g. T-09"
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Seating Capacity
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  required
                  value={formCapacity}
                  onChange={(e) => setFormCapacity(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Floor</label>
                <select
                  value={formFloor}
                  onChange={(e) => setFormFloor(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  {snapshot.settings.floors.map((fl) => (
                    <option key={fl} value={fl}>{fl}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Section / Zone</label>
                <select
                  value={formSection}
                  onChange={(e) => setFormSection(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  {snapshot.settings.sections.map((sec) => (
                    <option key={sec} value={sec}>{sec}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Table Type</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as TableType)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  {TABLE_TYPES.map((tp) => (
                    <option key={tp} value={tp}>{tp.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  <span className="inline-flex items-center gap-1">
                    <UserPlus className="h-3 w-3" /> Assigned Waiter
                  </span>
                </label>
                <select
                  value={formWaiterId}
                  onChange={(e) => setFormWaiterId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  <option value="">Unassigned</option>
                  {waiters.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {editingTable && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Status</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as TableStatus)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                >
                  {TABLE_STATUSES.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Notes</label>
              <input
                type="text"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Optional seating notes (window corner, high chair, etc.)"
                className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="rounded-xl border border-slate-200 dark:border-dusk px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingTable ? 'Save Changes' : 'Create Table & QR'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Move Session Modal */}
      {moveSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Move Active Session from {moveSource.tableNumber}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              All active orders, kitchen tickets, and bills will transfer cleanly to the destination table.
            </p>
            <select
              value={moveTargetId}
              onChange={(e) => setMoveTargetId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              <option value="">Select available table...</option>
              {activeNonArchived
                .filter((t) => t.id !== moveSource.id && t.status === 'Available')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tableNumber} ({t.floor} · {t.capacity} seats)
                  </option>
                ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMoveSource(null)}
                className="rounded-xl border border-slate-200 dark:border-dusk px-4 py-2 text-sm text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!moveTargetId}
                onClick={() => void handleMoveSession()}
                className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirm Transfer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verification Logs Modal */}
      {logsTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Verification Logs · {logsTable.tableNumber}
              </h3>
              <button
                type="button"
                onClick={() => setLogsTable(null)}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Close
              </button>
            </div>
            <div className="mt-4 max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {snapshot.verifications.filter((v) => v.tableId === logsTable.id).length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No verification requests recorded for this table yet.
                </p>
              ) : (
                snapshot.verifications
                  .filter((v) => v.tableId === logsTable.id)
                  .map((v) => (
                    <div key={v.id} className="py-3 text-xs flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {v.guestLabel || 'Guest'} ({v.guestCount} guests)
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          {new Date(v.createdAt).toLocaleString()} · Waiter: {v.waiterName || 'Pending'}
                        </div>
                      </div>
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 uppercase">
                        {v.status}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Permanent QR Modal */}
      <QrPreviewModal
        table={qrTable}
        restaurantName={snapshot.settings.name}
        logoUrl={snapshot.settings.logoUrl}
        onClose={() => setQrTable(null)}
        onOpenCustomerMenu={(token) => {
          setQrTable(null);
          onOpenCustomerPreview(token);
        }}
        onRevokeQr={async (table, reason) => {
          await api.revokeTableQr(table.id, reason);
          showToast('ok', `Permanent QR token rotated for ${table.tableNumber} (audited).`);
          await onRefresh();
        }}
      />

      {/* Delete Guard Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete Table ${deleteTarget?.tableNumber || ''}?`}
        description="Tables with active sessions, orders, or historical bills cannot be deleted and must be archived instead. Proceed only for unused tables."
        confirmLabel="Delete Table"
        destructive
        busy={deleteBusy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteTable()}
      />
    </div>
  );
};
