import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  MessageSquare,
  Search,
  Send,
  Star,
  Trash2,
  Utensils,
  Users,
} from 'lucide-react';
import type { RestaurantReview, RestaurantSnapshot, StaffProfile } from '../../types/domain';
import { api } from '../../services/api';
import { hasPermission } from '../../lib/permissions';
import { computeReviewMetrics, sortReviewsNewestFirst } from '../../lib/reviewUtils';

interface ManagerReviewsProps {
  snapshot: RestaurantSnapshot;
  currentStaff: StaffProfile;
  onRefresh: () => Promise<void>;
}

const StarRow: React.FC<{ value: number; size?: 'sm' | 'md' }> = ({ value, size = 'sm' }) => {
  const cls = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${cls} ${
            n <= Math.round(value)
              ? 'fill-amber-400 text-amber-500'
              : 'text-slate-300 dark:text-slate-700'
          }`}
        />
      ))}
    </div>
  );
};

export const ManagerReviews: React.FC<ManagerReviewsProps> = ({
  snapshot,
  currentStaff,
  onRefresh,
}) => {
  const reviews = useMemo(
    () => sortReviewsNewestFirst(snapshot.reviews || []),
    [snapshot.reviews]
  );
  const metrics = useMemo(() => computeReviewMetrics(reviews), [reviews]);

  const [filterMode, setFilterMode] = useState<'all' | '5' | '4' | '3' | 'low' | 'unreplied'>('all');
  const [search, setSearch] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const canManage = hasPermission(currentStaff.role, 'manage_reviews');

  const filteredReviews = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reviews.filter((r) => {
      if (filterMode === '5' && r.overallRating !== 5) return false;
      if (filterMode === '4' && r.overallRating !== 4) return false;
      if (filterMode === '3' && r.overallRating !== 3) return false;
      if (filterMode === 'low' && r.overallRating > 2) return false;
      if (filterMode === 'unreplied' && r.managerReply && r.managerReply.trim().length > 0) {
        return false;
      }
      if (q) {
        const hay = `${r.tableNumber} ${r.customerName || ''} ${r.comment || ''} ${
          r.managerReply || ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reviews, filterMode, search]);

  const handleSaveReply = async (review: RestaurantReview) => {
    const text = (replyDrafts[review.id] ?? review.managerReply ?? '').trim();
    if (!text) return;
    setBusyId(review.id);
    setFeedback(null);
    try {
      await api.replyToReview(review.id, text);
      setEditingReplyId(null);
      setFeedback({ type: 'ok', text: `Reply saved for Table ${review.tableNumber} review.` });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save reply.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteReview = async (review: RestaurantReview) => {
    setBusyId(review.id);
    setFeedback(null);
    try {
      await api.deleteReview(review.id);
      setConfirmDeleteId(null);
      setFeedback({ type: 'ok', text: `Review from Table ${review.tableNumber} removed.` });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to delete review.',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.type === 'err'
              ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300'
              : 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* KPI Summary Row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Overall Guest Rating</span>
            <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {metrics.totalCount > 0 ? metrics.avgOverall.toFixed(1) : '—'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">/ 5.0</span>
          </div>
          <div className="mt-2">
            <StarRow value={metrics.avgOverall} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Food Quality Score</span>
            <Utensils className="h-4 w-4 text-orange-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {metrics.totalCount > 0 ? metrics.avgFood.toFixed(1) : '—'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">/ 5.0</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Kitchen &amp; dish quality rating
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Table Service Score</span>
            <Users className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {metrics.totalCount > 0 ? metrics.avgService.toFixed(1) : '—'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">/ 5.0</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Hospitality &amp; speed rating
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Total Reviews &amp; Replies</span>
            <MessageSquare className="h-4 w-4 text-lavender" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {metrics.totalCount}
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {metrics.repliedCount} replied ({metrics.responseRatePercent}% response rate)
          </div>
        </div>
      </div>

      {/* Distribution + Filters */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Rating Breakdown
          </h2>
          <div className="mt-4 space-y-2.5">
            {metrics.distribution.map((row) => (
              <div key={row.stars} className="flex items-center gap-3 text-xs">
                <span className="w-8 font-mono font-medium text-slate-700 dark:text-slate-300">
                  {row.stars} ★
                </span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-amber-500 transition-all"
                    style={{ width: `${row.percent}%` }}
                  />
                </div>
                <span className="w-16 whitespace-nowrap text-right font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {row.count} ({row.percent}%)
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by table, guest name, or feedback..."
                className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', 'All'],
                  ['5', '5★'],
                  ['4', '4★'],
                  ['3', '3★'],
                  ['low', '1–2★'],
                  ['unreplied', 'Needs Reply'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterMode(key)}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                    filterMode === key
                      ? 'bg-orange-600 text-white'
                      : 'border border-slate-200 dark:border-dusk bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Review Cards */}
          {filteredReviews.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-dusk bg-white dark:bg-slate-900 p-10 text-center">
              <Star className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {reviews.length === 0 ? 'No Guest Reviews Yet' : 'No Matching Reviews'}
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {reviews.length === 0
                  ? 'Guest feedback submitted from the Customer QR Menu & Billing Portal will appear here in real time.'
                  : 'Try clearing your search or rating filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredReviews.map((review) => {
                const isEditing = editingReplyId === review.id;
                const draft = replyDrafts[review.id] ?? review.managerReply ?? '';
                const isBusy = busyId === review.id;

                return (
                  <article
                    key={review.id}
                    className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-lg bg-slate-900 dark:bg-royal px-2.5 py-0.5 text-[11px] font-semibold text-white">
                            Table {review.tableNumber}
                          </span>
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {review.customerName || 'Verified Table Guest'}
                          </span>
                          <span className="text-xs text-slate-400">
                            · {new Date(review.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
                          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                            Overall: <StarRow value={review.overallRating} />
                            <span className="font-mono font-semibold">{review.overallRating}/5</span>
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            Food: <strong className="text-slate-800 dark:text-slate-200">{review.foodRating}/5</strong>
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            Service: <strong className="text-slate-800 dark:text-slate-200">{review.serviceRating}/5</strong>
                          </span>
                        </div>
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingReplyId(isEditing ? null : review.id);
                              setReplyDrafts((prev) => ({
                                ...prev,
                                [review.id]: prev[review.id] ?? review.managerReply ?? '',
                              }));
                            }}
                            className="rounded-lg border border-slate-200 dark:border-dusk px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            {review.managerReply ? 'Edit Reply' : 'Reply'}
                          </button>

                          {confirmDeleteId === review.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleDeleteReview(review)}
                                className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="rounded-lg border border-slate-200 dark:border-dusk px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Delete review from Table ${review.tableNumber}`}
                              onClick={() => setConfirmDeleteId(review.id)}
                              className="rounded-lg border border-slate-200 dark:border-dusk p-1.5 text-slate-400 hover:text-red-600 hover:border-red-300 dark:hover:border-red-800"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {review.comment ? (
                      <p className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-dusk/70 px-3.5 py-2.5 text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                        &ldquo;{review.comment}&rdquo;
                      </p>
                    ) : (
                      <p className="text-xs italic text-slate-400">
                        No written comment provided.
                      </p>
                    )}

                    {review.managerReply && !isEditing && (
                      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs">
                        <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Response from {review.repliedBy || 'Management'}
                          {review.repliedAt && (
                            <span className="font-normal text-emerald-700/80 dark:text-emerald-400/80">
                              · {new Date(review.repliedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-emerald-900 dark:text-emerald-200">
                          {review.managerReply}
                        </p>
                      </div>
                    )}

                    {isEditing && (
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <input
                          type="text"
                          value={draft}
                          onChange={(e) =>
                            setReplyDrafts((prev) => ({ ...prev, [review.id]: e.target.value }))
                          }
                          placeholder="Write an owner/manager response to this guest..."
                          className="flex-1 rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isBusy || !draft.trim()}
                            onClick={() => void handleSaveReply(review)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                          >
                            <Send className="h-3.5 w-3.5" />
                            {isBusy ? 'Saving...' : 'Save Reply'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingReplyId(null)}
                            className="rounded-xl border border-slate-200 dark:border-dusk px-3 py-2 text-xs text-slate-600 dark:text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
