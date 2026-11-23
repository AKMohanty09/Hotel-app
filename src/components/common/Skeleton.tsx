import React from 'react';

interface SkeletonBlockProps {
  className?: string;
}

export const SkeletonBlock: React.FC<SkeletonBlockProps> = ({ className = '' }) => (
  <div aria-hidden="true" className={`skeleton-shimmer rounded-xl ${className}`} />
);

export const CustomerMenuSkeleton: React.FC = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-950" aria-busy="true" aria-label="Loading restaurant menu">
    {/* Sticky Top Bar Skeleton */}
    <div className="border-b border-slate-200 dark:border-dusk bg-white/95 dark:bg-slate-900/95 px-3 sm:px-4 py-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <SkeletonBlock className="h-9 w-9 rounded-xl shrink-0" />
          <div className="space-y-1.5">
            <SkeletonBlock className="h-3.5 w-32 rounded-md" />
            <SkeletonBlock className="h-2.5 w-24 rounded-md" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-9 w-9 rounded-xl" />
          <SkeletonBlock className="h-9 w-28 rounded-xl" />
        </div>
      </div>
    </div>

    <div className="mx-auto max-w-6xl px-3 sm:px-4 pt-4 sm:pt-5 pb-28 space-y-5">
      {/* Hero Menu Card Banner Skeleton */}
      <div className="rounded-3xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <SkeletonBlock className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl shrink-0" />
            <div className="space-y-2">
              <SkeletonBlock className="h-3 w-36 rounded-md" />
              <SkeletonBlock className="h-5 w-48 rounded-md" />
              <SkeletonBlock className="h-3 w-64 max-w-full rounded-md" />
            </div>
          </div>
          <SkeletonBlock className="h-10 w-36 rounded-2xl shrink-0" />
        </div>
      </div>

      {/* Search & Filter Row */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <SkeletonBlock className="h-11 flex-1 rounded-2xl" />
        <SkeletonBlock className="h-11 w-full sm:w-40 rounded-2xl" />
      </div>

      {/* Category Pills Row */}
      <div className="flex gap-2 overflow-hidden">
        {[1, 2, 3, 4, 5].map((i) => (
          <SkeletonBlock key={i} className="h-9 w-24 shrink-0 rounded-2xl" />
        ))}
      </div>

      {/* Menu Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div
            key={n}
            className="flex flex-col overflow-hidden rounded-3xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900"
          >
            <SkeletonBlock className="aspect-[16/10] sm:aspect-[4/3] w-full rounded-none" />
            <div className="p-4 space-y-3">
              <SkeletonBlock className="h-3 w-28 rounded-md" />
              <SkeletonBlock className="h-5 w-4/5 rounded-md" />
              <SkeletonBlock className="h-3.5 w-full rounded-md" />
              <div className="flex gap-1.5 pt-1">
                <SkeletonBlock className="h-6 w-20 rounded-xl" />
                <SkeletonBlock className="h-6 w-20 rounded-xl" />
                <SkeletonBlock className="h-6 w-20 rounded-xl" />
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 dark:border-dusk pt-3">
                <SkeletonBlock className="h-5 w-16 rounded-md" />
                <div className="flex gap-2">
                  <SkeletonBlock className="h-8 w-16 rounded-xl" />
                  <SkeletonBlock className="h-8 w-16 rounded-xl" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const ManagerDashboardSkeleton: React.FC = () => (
  <div className="flex min-h-[calc(100vh-56px)] bg-slate-50 dark:bg-slate-950" aria-busy="true" aria-label="Loading workspace">
    <aside className="hidden lg:flex w-[248px] shrink-0 bg-slate-900 border-r border-dusk flex-col p-3 space-y-2">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
        <SkeletonBlock key={n} className="h-10 w-full rounded-xl" />
      ))}
    </aside>
    <div className="flex-1 p-4 sm:p-5 lg:p-7 space-y-6">
      <div className="space-y-2">
        <SkeletonBlock className="h-7 w-48 rounded-lg" />
        <SkeletonBlock className="h-3.5 w-64 rounded-md" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 space-y-3"
          >
            <SkeletonBlock className="h-3.5 w-28 rounded-md" />
            <SkeletonBlock className="h-7 w-24 rounded-md" />
            <SkeletonBlock className="h-3 w-36 rounded-md" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 space-y-4">
          <SkeletonBlock className="h-5 w-44 rounded-md" />
          <SkeletonBlock className="h-44 w-full rounded-xl" />
        </div>
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 space-y-3">
          <SkeletonBlock className="h-5 w-40 rounded-md" />
          <div className="grid grid-cols-2 gap-3">
            <SkeletonBlock className="h-20 rounded-xl" />
            <SkeletonBlock className="h-20 rounded-xl" />
            <SkeletonBlock className="h-20 rounded-xl" />
            <SkeletonBlock className="h-20 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  </div>
);
