import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CheckCheck,
  ChefHat,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  QrCode,
  Sun,
  UserCheck,
  X,
} from 'lucide-react';
import { api, setAuthToken } from './services/api';
import { canAccessPortal, getDefaultPortalForRole } from './lib/permissions';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import type { PortalKey, RestaurantSnapshot, StaffProfile } from './types/domain';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { OfflineBanner, PWAInstallButton } from './components/common/PWAWidgets';
import { ManagerDashboardSkeleton } from './components/common/Skeleton';
import { StaffAvatar } from './components/common/StaffAvatar';
import { uploadImageFileToDatabase } from './lib/imageUtils';
import { AuthGateway } from './components/auth/AuthGateway';
import { CustomerPortal } from './components/customer/CustomerPortal';
import { WaiterPortal } from './components/waiter/WaiterPortal';
import { KitchenPortal } from './components/kitchen/KitchenPortal';
import { ManagerPortal } from './components/manager/ManagerPortal';

function parseUrlParams(): { portal?: string | null; tableToken?: string | null } {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  return {
    portal: params.get('portal'),
    tableToken: params.get('tableToken'),
  };
}

function AppShell() {
  const initialUrl = useMemo(() => parseUrlParams(), []);
  const [customerQrToken, setCustomerQrToken] = useState<string | null>(
    initialUrl.portal === 'customer' && initialUrl.tableToken ? initialUrl.tableToken : null
  );
  const [currentStaff, setCurrentStaff] = useState<StaffProfile | null>(null);
  const [activePortal, setActivePortal] = useState<PortalKey>('manager');
  const [snapshot, setSnapshot] = useState<RestaurantSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [loadError, setLoadError] = useState('');

  // System-aware Theme & Manager Sidebar Drawers / Modals
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('sh_theme_mode') || localStorage.getItem('sh_theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'system';
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const [managerSidebarOpen, setManagerSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [profileEmail, setProfileEmail] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [uploadingMyPhoto, setUploadingMyPhoto] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    themeMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themeMode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', resolvedTheme === 'dark' ? '#0E0B1D' : '#F7F5FC');
    }
  }, [resolvedTheme]);

  const toggleTheme = () => {
    const next: 'light' | 'dark' = resolvedTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('sh_theme_mode', next);
    localStorage.setItem('sh_theme', next);
    setThemeMode(next);
  };

  const syncDefaultThemeIfUnset = useCallback((def?: 'system' | 'light' | 'dark') => {
    const hasManualOverride = Boolean(
      localStorage.getItem('sh_theme_mode') || localStorage.getItem('sh_theme')
    );
    if (!hasManualOverride && def) {
      setThemeMode(def);
    }
  }, []);

  const currentStaffId = currentStaff?.id ?? null;

  const fetchSnapshot = useCallback(async () => {
    if (!currentStaffId) return;
    setLoadingSnapshot(true);
    setLoadError('');
    try {
      const data = await api.getSnapshot();
      setSnapshot(data);
      syncDefaultThemeIfUnset(data.settings.defaultTheme);
      const updatedMe = data.staff.find((s) => s.id === currentStaffId);
      if (updatedMe) {
        setCurrentStaff((prev) =>
          prev && JSON.stringify(prev) === JSON.stringify(updatedMe) ? prev : updatedMe
        );
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load workspace snapshot.');
    } finally {
      setLoadingSnapshot(false);
    }
  }, [currentStaffId, syncDefaultThemeIfUnset]);

  useEffect(() => {
    if (currentStaffId && !customerQrToken) {
      void fetchSnapshot();
    }
  }, [currentStaffId, customerQrToken, fetchSnapshot]);

  // Real-time WebSocket updates across all open terminals
  useRealtimeSync(
    useCallback(() => {
      if (currentStaff && !customerQrToken) {
        void fetchSnapshot();
      }
    }, [currentStaff, customerQrToken, fetchSnapshot]),
    Boolean(currentStaff && !customerQrToken)
  );

  const openCustomerTableUrl = (qrToken: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('portal', 'customer');
    url.searchParams.set('tableToken', qrToken);
    window.history.pushState({}, '', url.toString());
    setCustomerQrToken(qrToken);
  };

  const exitCustomerPortal = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('portal');
    url.searchParams.delete('tableToken');
    window.history.pushState({}, '', url.toString());
    setCustomerQrToken(null);
  };

  const handleAuthenticated = (staff: StaffProfile) => {
    setCurrentStaff(staff);
    setActivePortal(getDefaultPortalForRole(staff.role));
  };

  const handleSignOut = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setAuthToken(null);
    setCurrentStaff(null);
    setSnapshot(null);
  };

  // Customer QR Portal View (public menu browsing + waiter OTP gated ordering)
  if (customerQrToken) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <OfflineBanner />
        <CustomerPortal
          qrToken={customerQrToken}
          theme={resolvedTheme}
          onToggleTheme={toggleTheme}
          onSyncDefaultTheme={(def) => syncDefaultThemeIfUnset(def)}
          onExitToPortalSelect={exitCustomerPortal}
        />
      </div>
    );
  }

  // Unauthenticated Terminal Gate
  if (!currentStaff) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <OfflineBanner />
        <AuthGateway
          theme={resolvedTheme}
          onToggleTheme={toggleTheme}
          onAuthenticated={handleAuthenticated}
          onOpenCustomerPortal={openCustomerTableUrl}
        />
      </div>
    );
  }

  const unreadNotifs = (snapshot?.notifications || []).filter((n) => !n.isRead);
  const portalTabs: { id: PortalKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'manager', label: 'Manager', icon: LayoutDashboard },
    { id: 'waiter', label: 'Waiter', icon: UserCheck },
    { id: 'kitchen', label: 'Kitchen (KDS)', icon: ChefHat },
  ];
  const allowedPortals = portalTabs.filter((p) => canAccessPortal(currentStaff.role, p.id));

  const effectivePortal = canAccessPortal(currentStaff.role, activePortal)
    ? activePortal
    : getDefaultPortalForRole(currentStaff.role);

  const firstActiveTableToken =
    snapshot?.tables.find((t) => !t.isArchived)?.qrToken || '';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <OfflineBanner />

      {/* Top Operations Bar */}
      <header className="sticky top-0 z-40 h-14 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {effectivePortal === 'manager' && (
            <button
              type="button"
              aria-label={managerSidebarOpen ? 'Close manager navigation' : 'Open manager navigation'}
              onClick={() => setManagerSidebarOpen((v) => !v)}
              className="lg:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              {managerSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          )}
          <img
            src={snapshot?.settings.logoUrl || '/src/assets/images/restaurant_emblem_1795406025250.jpg'}
            alt={snapshot?.settings.name || 'Saffron & Hearth'}
            referrerPolicy="no-referrer"
            className="h-8 w-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-white"
          />
          <span className="font-display text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate whitespace-nowrap">
            {snapshot?.settings.name || 'Saffron & Hearth'}
          </span>
        </div>

        {/* Role-Gated Portal Switcher */}
        <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto" aria-label="Portal Switcher">
          {allowedPortals.map((p) => {
            const Icon = p.icon;
            const active = effectivePortal === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActivePortal(p.id);
                  setManagerSidebarOpen(false);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-orange-600'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{p.label}</span>
              </button>
            );
          })}

          {currentStaff.role !== 'kitchen_staff' &&
            currentStaff.role !== 'kitchen_supervisor' &&
            firstActiveTableToken && (
              <button
                type="button"
                title="Preview Customer Table QR Menu"
                onClick={() => openCustomerTableUrl(firstActiveTableToken)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <QrCode className="h-3.5 w-3.5 text-orange-600" />
                <span>Customer QR</span>
              </button>
            )}
        </nav>

        {/* Right Utility Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <PWAInstallButton variant={resolvedTheme} />

          <button
            type="button"
            aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={resolvedTheme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            onClick={toggleTheme}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-600 dark:text-lavender hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button
            type="button"
            aria-label="Notifications"
            onClick={() => setNotifOpen((v) => !v)}
            className="relative rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Bell className="h-4 w-4" />
            {unreadNotifs.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white">
                {unreadNotifs.length}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-label="Account, profile photo and passcode settings"
            title="Account, Profile Photo &amp; Passcode"
            onClick={() => {
              setResetOpen(true);
              setProfileEmail(currentStaff.email);
              setNewPasscode('');
              setResetMessage('');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <StaffAvatar name={currentStaff.name} photoUrl={currentStaff.photoUrl} size="xs" />
            <KeyRound className="h-3.5 w-3.5 hidden sm:inline" />
          </button>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Active Portal Body */}
      <div className="flex-1">
        {loadError && (
          <div role="alert" className="m-6 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/50 p-4 text-sm text-red-700 dark:text-red-300">
            {loadError}
          </div>
        )}

        {!snapshot ? (
          <ManagerDashboardSkeleton />
        ) : effectivePortal === 'manager' ? (
          <ManagerPortal
            snapshot={snapshot}
            currentStaff={currentStaff}
            sidebarOpen={managerSidebarOpen}
            onCloseSidebar={() => setManagerSidebarOpen(false)}
            onRefresh={fetchSnapshot}
            onOpenCustomerPreview={openCustomerTableUrl}
          />
        ) : effectivePortal === 'waiter' ? (
          <WaiterPortal
            snapshot={snapshot}
            currentStaff={currentStaff}
            onRefresh={fetchSnapshot}
          />
        ) : (
          <KitchenPortal snapshot={snapshot} onRefresh={fetchSnapshot} />
        )}
      </div>

      {/* Notification Drawer */}
      {notifOpen && snapshot && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800">
            <div className="border-b border-slate-200 dark:border-slate-800 px-5 py-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Operational Alerts ({unreadNotifs.length} unread)
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await api.markNotificationRead();
                    await fetchSnapshot();
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {snapshot.notifications.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">No alerts yet.</p>
              ) : (
                snapshot.notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-5 py-3.5 text-xs ${n.isRead ? 'bg-white dark:bg-slate-900' : 'bg-orange-50/40 dark:bg-orange-950/20'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{n.title}</span>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0">
                        {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-400 leading-relaxed">{n.message}</p>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.markNotificationRead(n.id);
                          await fetchSnapshot();
                        }}
                        className="mt-2 text-[11px] font-medium text-orange-600 hover:underline"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Account Email & Passcode Modal */}
      {resetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl space-y-5 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Account &amp; Security
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {currentStaff.name} · {currentStaff.employeeId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {resetMessage && (
              <div className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-slate-800 dark:text-slate-200">
                {resetMessage}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3">
              <div className="flex items-center gap-3 min-w-0">
                <StaffAvatar name={currentStaff.name} photoUrl={currentStaff.photoUrl} size="md" />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 dark:text-slate-100">Profile Photo</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {currentStaff.photoUrl ? 'Saved in database' : 'No photo uploaded'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <label className="cursor-pointer rounded-lg bg-slate-900 dark:bg-royal px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800">
                  {uploadingMyPhoto ? 'Uploading...' : currentStaff.photoUrl ? 'Change' : 'Upload'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    aria-label="Upload my profile photo"
                    disabled={uploadingMyPhoto}
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingMyPhoto(true);
                      try {
                        const url = await uploadImageFileToDatabase(file, 'staff', {
                          maxDimension: 400,
                          preferPng: false,
                          quality: 0.84,
                          entityId: currentStaff.id,
                        });
                        const res = await api.updateProfile({ photoUrl: url });
                        setCurrentStaff(res.staff);
                        setResetMessage('Profile photo uploaded and saved to database.');
                        await fetchSnapshot();
                      } catch (err) {
                        setResetMessage(err instanceof Error ? err.message : 'Unable to upload photo.');
                      } finally {
                        setUploadingMyPhoto(false);
                      }
                    }}
                  />
                </label>
                {currentStaff.photoUrl && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await api.updateProfile({ photoUrl: '' });
                        setCurrentStaff(res.staff);
                        setResetMessage('Profile photo removed.');
                        await fetchSnapshot();
                      } catch (err) {
                        setResetMessage(err instanceof Error ? err.message : 'Unable to remove photo.');
                      }
                    }}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {(currentStaff.role === 'owner' || currentStaff.role === 'manager') && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const res = await api.updateProfile({ email: profileEmail });
                    setCurrentStaff(res.staff);
                    setProfileEmail(res.staff.email);
                    setResetMessage(`Account email updated to ${res.staff.email}.`);
                    await fetchSnapshot();
                  } catch (err) {
                    setResetMessage(err instanceof Error ? err.message : 'Unable to update email.');
                  }
                }}
                className="space-y-2.5 border-b border-slate-200 dark:border-slate-800 pb-4"
              >
                <label className="block font-medium text-slate-700 dark:text-slate-300">
                  {currentStaff.role === 'owner' ? 'Owner Email ID (Login)' : 'Account Email ID'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    placeholder="owner@restaurant.com"
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    className="rounded-xl bg-slate-900 dark:bg-royal px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 shrink-0"
                  >
                    Update Email
                  </button>
                </div>
              </form>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.resetPassword(newPasscode);
                  setResetMessage('Passcode updated successfully.');
                  setNewPasscode('');
                } catch (err) {
                  setResetMessage(err instanceof Error ? err.message : 'Unable to update passcode.');
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  New Passcode (6+ chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPasscode}
                  onChange={(e) => setNewPasscode(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetOpen(false)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm text-slate-700 dark:text-slate-300"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  Save Passcode
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loadingSnapshot && !snapshot && (
        <div className="sr-only">Loading operational snapshot...</div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
