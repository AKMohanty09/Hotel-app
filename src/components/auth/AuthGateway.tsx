import React, { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Lock, Moon, QrCode, ShieldCheck, Sun, Utensils } from 'lucide-react';
import { api, setAuthToken } from '../../services/api';
import { signInWithGoogleFirebase } from '../../lib/firebase';
import type { RestaurantTable, StaffProfile } from '../../types/domain';
import { PWAInstallButton } from '../common/PWAWidgets';
import { SkeletonBlock } from '../common/Skeleton';

interface AuthGatewayProps {
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onAuthenticated: (staff: StaffProfile) => void;
  onOpenCustomerPortal: (qrToken: string) => void;
}

export const AuthGateway: React.FC<AuthGatewayProps> = ({
  theme = 'light',
  onToggleTheme,
  onAuthenticated,
  onOpenCustomerPortal,
}) => {
  const [adminClaimed, setAdminClaimed] = useState<boolean | null>(null);
  const [restaurantName, setRestaurantName] = useState('Saffron & Hearth');
  const [logoUrl, setLogoUrl] = useState('/src/assets/images/restaurant_emblem_1795406025250.jpg');
  const [identifier, setIdentifier] = useState('adyanshacademy@gmail.com');
  const [passcode, setPasscode] = useState('');
  const [claimPasscode, setClaimPasscode] = useState('');
  const [confirmClaim, setConfirmClaim] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [publicTables, setPublicTables] = useState<
    Pick<RestaurantTable, 'id' | 'tableNumber' | 'capacity' | 'floor' | 'section' | 'status' | 'qrToken'>[]
  >([]);
  const [selectedTableToken, setSelectedTableToken] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([api.getAuthStatus(), api.getPublicTables()])
      .then(([status, tblRes]) => {
        if (!active) return;
        setAdminClaimed(status.adminClaimed);
        setRestaurantName(status.restaurantName);
        if (status.logoUrl) setLogoUrl(status.logoUrl);
        setPublicTables(tblRes.tables);
        if (tblRes.tables.length > 0) setSelectedTableToken(tblRes.tables[0].qrToken);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to reach server');
      });
    return () => {
      active = false;
    };
  }, []);

  const handleClaimAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (claimPasscode.length < 6) {
      setError('Passcode must be at least 6 characters.');
      return;
    }
    if (claimPasscode !== confirmClaim) {
      setError('Passcodes do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.claimAdmin(claimPasscode);
      setAuthToken(res.token);
      onAuthenticated(res.staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim admin account.');
    } finally {
      setBusy(false);
    }
  };

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !passcode.trim()) {
      setError('Please enter your email or employee ID and passcode.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.login(identifier.trim(), passcode.trim());
      setAuthToken(res.token);
      onAuthenticated(res.staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials.');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setBusy(true);
    try {
      const { idToken } = await signInWithGoogleFirebase();
      const res = await api.exchangeFirebaseToken(idToken);
      setAuthToken(res.token);
      onAuthenticated(res.staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed or was cancelled.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-obsidian flex flex-col">
      <header className="border-b border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 px-4 sm:px-6 py-3.5 sm:py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 sm:gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={logoUrl}
              alt={restaurantName}
              referrerPolicy="no-referrer"
              className="h-9 w-9 rounded-xl object-cover border border-slate-200 dark:border-dusk shrink-0 bg-white"
            />
            <span className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-950 dark:text-slate-100 truncate whitespace-nowrap">
              {restaurantName}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {onToggleTheme && (
              <button
                type="button"
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                onClick={onToggleTheme}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-plum text-slate-600 dark:text-lavender hover:bg-slate-50 dark:hover:bg-dusk"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            )}
            <PWAInstallButton variant={theme} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 sm:px-6 py-6 sm:py-10">
        <div className="grid w-full gap-6 sm:gap-10 lg:grid-cols-12 items-stretch">
          {/* Left: Staff & Manager POS Sign-In */}
          <section className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <p className="text-xs font-semibold text-royal dark:text-amethyst">Unified Restaurant Operating System</p>
              <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-100 [text-wrap:balance]">
                Staff &amp; Operations Terminal
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-lavender/80 max-w-xl leading-relaxed">
                Sign in to access your role-authorized portal across Manager Console, Waiter Service, Kitchen Display (KDS), and Cashier Billing.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300"
                >
                  {error}
                </div>
              )}

              {adminClaimed === null ? (
                <div className="mt-8 space-y-4">
                  <div className="space-y-2">
                    <SkeletonBlock className="h-3.5 w-36 rounded-md" />
                    <SkeletonBlock className="h-11 w-full rounded-xl" />
                  </div>
                  <div className="space-y-2">
                    <SkeletonBlock className="h-3.5 w-28 rounded-md" />
                    <SkeletonBlock className="h-11 w-full rounded-xl" />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <SkeletonBlock className="h-12 flex-1 rounded-xl" />
                    <SkeletonBlock className="h-12 w-full sm:w-44 rounded-xl" />
                  </div>
                </div>
              ) : adminClaimed === false ? (
                <form onSubmit={handleClaimAdmin} className="mt-6 space-y-4">
                  <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/50 p-4 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    <strong>First-Run Owner Setup:</strong> Set an operational workspace passcode for the Owner account (<span className="font-mono">adyanshacademy@gmail.com</span> / <span className="font-mono">EMP-001</span>) and initial staff terminals.
                  </div>
                  <div>
                    <label htmlFor="claim-pass" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                      Create Workspace Passcode (min 6 characters)
                    </label>
                    <input
                      id="claim-pass"
                      type="password"
                      value={claimPasscode}
                      onChange={(e) => setClaimPasscode(e.target.value)}
                      placeholder="Enter secure passcode"
                      className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="claim-confirm" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                      Confirm Passcode
                    </label>
                    <input
                      id="claim-confirm"
                      type="password"
                      value={confirmClaim}
                      onChange={(e) => setConfirmClaim(e.target.value)}
                      placeholder="Re-enter passcode"
                      className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-royal px-5 py-3 text-sm font-semibold text-white hover:bg-plum disabled:opacity-50 transition-colors"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {busy ? 'Initializing Workspace...' : 'Claim Owner Account & Enter Console'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleStaffLogin} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="staff-id" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                      Staff Email or Employee ID
                    </label>
                    <input
                      id="staff-id"
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="e.g. adyanshacademy@gmail.com or EMP-003"
                      className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum px-3.5 py-2.5 text-sm text-slate-950 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="staff-pass" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                      Staff Passcode
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                      <input
                        id="staff-pass"
                        type="password"
                        value={passcode}
                        onChange={(e) => setPasscode(e.target.value)}
                        placeholder="Enter passcode"
                        className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum pl-10 pr-3.5 py-2.5 text-sm text-slate-950 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-royal px-5 py-3 text-sm font-semibold text-white hover:bg-plum disabled:opacity-50"
                    >
                      <KeyRound className="h-4 w-4" />
                      {busy ? 'Signing in...' : 'Sign In with Staff Credentials'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleGoogleSignIn()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum px-5 py-3 text-sm font-medium text-slate-700 dark:text-lavender hover:bg-slate-50 dark:hover:bg-dusk disabled:opacity-50 whitespace-nowrap"
                    >
                      Sign in with Google
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="mt-8 border-t border-slate-100 dark:border-dusk pt-5 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs text-slate-500 dark:text-slate-400">
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-200">Manager / Owner</div>
                <div className="font-mono mt-0.5">EMP-001 · EMP-002</div>
              </div>
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-200">Waiter Terminals</div>
                <div className="font-mono mt-0.5">EMP-003 · EMP-004</div>
              </div>
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-200">Kitchen &amp; Cashier</div>
                <div className="font-mono mt-0.5">EMP-005 · EMP-006</div>
              </div>
            </div>
          </section>

          {/* Right: Guest QR Menu Launcher */}
          <section className="lg:col-span-5 rounded-2xl border border-dusk bg-plum dark:bg-slate-900 text-slate-100 p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-royal/60 border border-amethyst/30 text-lavender">
                <QrCode className="h-6 w-6" />
              </div>
              <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-white [text-wrap:balance]">
                Customer QR Dining Portal
              </h2>
              <p className="mt-2 text-sm text-lavender/90 leading-relaxed">
                Guests scan any table&apos;s permanent QR code to browse the live menu immediately—no account or app required. Ordering unlocks after waiter table confirmation and OTP verification.
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label htmlFor="qr-table-select" className="block text-xs font-medium text-lavender mb-1.5">
                    Select Table QR to Simulate Scan
                  </label>
                  <select
                    id="qr-table-select"
                    value={selectedTableToken}
                    onChange={(e) => setSelectedTableToken(e.target.value)}
                    className="w-full rounded-xl border border-dusk bg-obsidian/70 px-3.5 py-2.5 text-sm text-white focus:border-amethyst focus:outline-none"
                  >
                    {publicTables.map((t) => (
                      <option key={t.id} value={t.qrToken}>
                        Table {t.tableNumber} — {t.floor} ({t.section}, {t.capacity} seats)
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  disabled={!selectedTableToken}
                  onClick={() => onOpenCustomerPortal(selectedTableToken)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-royal px-5 py-3 text-sm font-semibold text-white hover:bg-amethyst hover:text-obsidian disabled:opacity-50"
                >
                  <Utensils className="h-4 w-4" />
                  Open Table QR Menu
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-8 border-t border-dusk pt-5 text-xs text-lavender/75 leading-relaxed">
              Permanent QR tokens identify the physical table only. Order submission is strictly gated behind an active server-verified table session.
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};
