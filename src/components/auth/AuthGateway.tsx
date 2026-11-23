import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Camera,
  Check,
  Copy,
  Database,
  KeyRound,
  Lock,
  Mail,
  Moon,
  Phone,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sun,
  User,
  Utensils,
} from 'lucide-react';
import { api, setAuthToken } from '../../services/api';
import { compressImageFileToDataUrl } from '../../lib/imageUtils';
import type { RestaurantTable, StaffProfile } from '../../types/domain';
import { PWAInstallButton } from '../common/PWAWidgets';
import { SkeletonBlock } from '../common/Skeleton';
import { StaffAvatar } from '../common/StaffAvatar';

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
  const [ownerRegistered, setOwnerRegistered] = useState<boolean | null>(null);
  const [needsSupabaseSchema, setNeedsSupabaseSchema] = useState(false);
  const [needsFullSchema, setNeedsFullSchema] = useState(false);
  const [needsServiceRoleKey, setNeedsServiceRoleKey] = useState(false);
  const [schemaSql, setSchemaSql] = useState('');
  const [copiedSql, setCopiedSql] = useState(false);
  const [restaurantName, setRestaurantName] = useState('Saffron & Hearth OS');
  const [logoUrl, setLogoUrl] = useState('/src/assets/images/restaurant_emblem_1795406025250.jpg');

  // Login state
  const [identifier, setIdentifier] = useState('');
  const [passcode, setPasscode] = useState('');

  // First-run Owner registration state
  const [regRestaurantName, setRegRestaurantName] = useState('');
  const [regOwnerName, setRegOwnerName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regMobile, setRegMobile] = useState('');
  const [regPhotoUrl, setRegPhotoUrl] = useState('');
  const [regPasscode, setRegPasscode] = useState('');
  const [regConfirm, setRegConfirm] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [publicTables, setPublicTables] = useState<
    Pick<RestaurantTable, 'id' | 'tableNumber' | 'capacity' | 'floor' | 'section' | 'status' | 'qrToken'>[]
  >([]);
  const [selectedTableToken, setSelectedTableToken] = useState('');

  const loadGatewayStatus = async () => {
    setError('');
    try {
      const [status, tblRes] = await Promise.all([api.getAuthStatus(), api.getPublicTables()]);
      const schemaMissing = Boolean(status.needsSupabaseSchema);
      const fullMissing = Boolean(status.needsFullDatabaseSchema);
      setNeedsSupabaseSchema(schemaMissing);
      setNeedsFullSchema(fullMissing);
      setNeedsServiceRoleKey(Boolean(status.needsSupabaseServiceRoleKey));
      setOwnerRegistered(status.ownerRegistered ?? status.adminClaimed);
      setRestaurantName(status.restaurantName);
      if (status.logoUrl) setLogoUrl(status.logoUrl);
      setPublicTables(tblRes.tables);
      if (tblRes.tables.length > 0) setSelectedTableToken(tblRes.tables[0].qrToken);
      if (schemaMissing || fullMissing) {
        const sqlRes = await api.getSupabaseSchemaSql();
        setSchemaSql(sqlRes.sql);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach server');
    }
  };

  useEffect(() => {
    void loadGatewayStatus();
  }, []);

  const handleRegisterOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (regRestaurantName.trim().length < 2) {
      setError('Please enter your restaurant or business name.');
      return;
    }
    if (regOwnerName.trim().length < 2) {
      setError('Please enter the Owner full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail.trim())) {
      setError('Please enter a valid Owner email address.');
      return;
    }
    if (regPasscode.length < 6) {
      setError('Passcode must be at least 6 characters.');
      return;
    }
    if (regPasscode !== regConfirm) {
      setError('Passcodes do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.registerOwner({
        restaurantName: regRestaurantName.trim(),
        ownerName: regOwnerName.trim(),
        email: regEmail.trim(),
        mobile: regMobile.trim() || undefined,
        photoUrl: regPhotoUrl || undefined,
        passcode: regPasscode,
      });
      setAuthToken(res.token);
      onAuthenticated(res.staff);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register Owner account.');
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
          {/* Left: First-Run Owner Registration OR Staff & Owner Sign-In */}
          <section className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <p className="text-xs font-semibold text-royal dark:text-amethyst">
                Unified Restaurant Operating System
              </p>
              <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-100 [text-wrap:balance]">
                {needsSupabaseSchema
                  ? 'Initialize Supabase Tables'
                  : ownerRegistered === false
                    ? 'Register Restaurant Owner'
                    : 'Staff & Operations Terminal'}
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-lavender/80 max-w-xl leading-relaxed">
                {needsSupabaseSchema
                  ? 'Your Supabase project is connected, and the database tables need to be created once before registering the Owner.'
                  : ownerRegistered === false
                    ? 'Set up your Owner account and restaurant workspace first. All menus, tables, staff accounts, orders, and billing run directly from your database.'
                    : 'Sign in with your registered Email ID or Employee ID and passcode to access your role-authorized portal.'}
              </p>

              {needsServiceRoleKey && !needsSupabaseSchema && (
                <div
                  role="alert"
                  className="mt-5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed"
                >
                  <strong>Supabase Key Update Required:</strong> Your <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> is currently using an <code className="font-mono">anon</code>/publishable key, which is blocked by Row Level Security on writes. Copy the <strong>service_role</strong> (or <code className="font-mono">sb_secret_...</code>) key from Supabase Dashboard → Project Settings → API into your Secrets/Environment Variables.
                </div>
              )}

              {needsFullSchema && !needsSupabaseSchema && schemaSql && (
                <div
                  role="status"
                  className="mt-4 rounded-xl border border-slate-200 dark:border-dusk bg-slate-50 dark:bg-obsidian/60 px-4 py-3 text-xs text-slate-700 dark:text-slate-200 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <strong>Full Database Schema Update Available:</strong> Paste the updated SQL script in Supabase SQL Editor to enable normalized app tables &amp; uploaded media storage.
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(schemaSql);
                        setCopiedSql(true);
                        window.setTimeout(() => setCopiedSql(false), 2500);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-dusk bg-white dark:bg-plum px-3 py-1.5 font-semibold text-slate-700 dark:text-lavender hover:bg-slate-100"
                    >
                      {copiedSql ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedSql ? 'Copied Full SQL' : 'Copy Full SQL'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadGatewayStatus()}
                      className="rounded-lg bg-royal px-2.5 py-1.5 font-semibold text-white hover:bg-plum"
                    >
                      Verify
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mt-5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300"
                >
                  {error}
                </div>
              )}

              {ownerRegistered === null ? (
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
                  </div>
                </div>
              ) : needsSupabaseSchema ? (
                <div className="mt-6 space-y-4">
                  <div className="rounded-xl border border-slate-200 dark:border-dusk bg-slate-50 dark:bg-obsidian/60 p-4 space-y-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                        <Database className="h-4 w-4 text-royal dark:text-amethyst" />
                        <span>Run in Supabase Dashboard → SQL Editor → New Query</span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!schemaSql) return;
                          await navigator.clipboard.writeText(schemaSql);
                          setCopiedSql(true);
                          window.setTimeout(() => setCopiedSql(false), 2500);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-dusk bg-white dark:bg-plum px-3 py-1.5 font-semibold text-slate-700 dark:text-lavender hover:bg-slate-100 dark:hover:bg-dusk shrink-0"
                      >
                        {copiedSql ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedSql ? 'Copied SQL' : 'Copy SQL Schema'}
                      </button>
                    </div>
                    <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 dark:border-dusk bg-white dark:bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                      {schemaSql || 'Loading schema...'}
                    </pre>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await loadGatewayStatus();
                      setBusy(false);
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-royal px-5 py-3 text-sm font-semibold text-white hover:bg-plum disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                    {busy ? 'Checking Supabase...' : 'Verify Tables & Continue to Owner Registration'}
                  </button>
                </div>
              ) : ownerRegistered === false ? (
                <form onSubmit={handleRegisterOwner} className="mt-6 space-y-4">
                  <div className="flex items-center gap-4 rounded-xl border border-slate-200 dark:border-dusk bg-slate-50 dark:bg-plum/40 px-4 py-3">
                    <StaffAvatar
                      name={regOwnerName || 'Owner'}
                      photoUrl={regPhotoUrl || undefined}
                      size="lg"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                        Owner Profile Photo (Optional)
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-lavender/70">
                        Stored directly in your database &amp; media bucket.
                      </p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-lavender hover:bg-slate-100 shrink-0">
                      <Camera className="h-3.5 w-3.5" />
                      <span>{regPhotoUrl ? 'Change' : 'Upload Photo'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        aria-label="Upload owner profile photo"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const url = await compressImageFileToDataUrl(file, {
                              maxDimension: 400,
                              preferPng: false,
                              quality: 0.84,
                            });
                            setRegPhotoUrl(url);
                            setError('');
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Unable to process photo.');
                          }
                        }}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="reg-restaurant" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                        Restaurant / Hotel Name
                      </label>
                      <div className="relative">
                        <Building2 className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                        <input
                          id="reg-restaurant"
                          type="text"
                          value={regRestaurantName}
                          onChange={(e) => setRegRestaurantName(e.target.value)}
                          placeholder="e.g. Royal Spice Bistro"
                          className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="reg-owner-name" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                        Owner Full Name
                      </label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                        <input
                          id="reg-owner-name"
                          type="text"
                          value={regOwnerName}
                          onChange={(e) => setRegOwnerName(e.target.value)}
                          placeholder="e.g. Rahul Sharma"
                          className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                        Owner Email ID (Used for Sign-In)
                      </label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                        <input
                          id="reg-email"
                          type="email"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="owner@yourrestaurant.com"
                          className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="reg-mobile" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                        Business Phone (Optional)
                      </label>
                      <div className="relative">
                        <Phone className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                        <input
                          id="reg-mobile"
                          type="tel"
                          value={regMobile}
                          onChange={(e) => setRegMobile(e.target.value)}
                          placeholder="+91 98765 43210"
                          className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="reg-pass" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                        Owner Passcode (min 6 chars)
                      </label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                        <input
                          id="reg-pass"
                          type="password"
                          minLength={6}
                          value={regPasscode}
                          onChange={(e) => setRegPasscode(e.target.value)}
                          placeholder="Create passcode"
                          className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="reg-confirm" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                        Confirm Passcode
                      </label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                        <input
                          id="reg-confirm"
                          type="password"
                          minLength={6}
                          value={regConfirm}
                          onChange={(e) => setRegConfirm(e.target.value)}
                          placeholder="Re-enter passcode"
                          className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum pl-10 pr-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-royal px-5 py-3 text-sm font-semibold text-white hover:bg-plum disabled:opacity-50 transition-colors"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {busy ? 'Creating Owner Workspace...' : 'Register Owner & Open Console'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleStaffLogin} className="mt-6 space-y-4">
                  <div>
                    <label htmlFor="staff-id" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                      Email ID or Employee ID
                    </label>
                    <input
                      id="staff-id"
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="owner@yourrestaurant.com or EMP-001"
                      className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-plum px-3.5 py-2.5 text-sm text-slate-950 dark:text-slate-100 focus:border-royal dark:focus:border-amethyst focus:outline-none"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="staff-pass" className="block text-xs font-medium text-slate-700 dark:text-lavender mb-1.5">
                      Passcode
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
                  <div className="pt-1">
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-royal px-5 py-3 text-sm font-semibold text-white hover:bg-plum disabled:opacity-50"
                    >
                      <KeyRound className="h-4 w-4" />
                      {busy ? 'Signing in...' : 'Sign In to Operations Console'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="mt-8 border-t border-slate-100 dark:border-dusk pt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-500 dark:text-slate-400">
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-200">Owner &amp; Managers</div>
                <div className="mt-0.5">Full operations, menus &amp; billing</div>
              </div>
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-200">Waiter Terminals</div>
                <div className="mt-0.5">Table verification, service &amp; orders</div>
              </div>
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-200">Kitchen &amp; Cashier</div>
                <div className="mt-0.5">Live KDS tickets &amp; checkout</div>
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
                {publicTables.length > 0 ? (
                  <>
                    <div>
                      <label htmlFor="qr-table-select" className="block text-xs font-medium text-lavender mb-1.5">
                        Select Active Table QR
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
                  </>
                ) : (
                  <div className="rounded-xl border border-dusk bg-obsidian/40 p-4 text-xs text-lavender/85 leading-relaxed">
                    No dining tables are configured yet. After the Owner registers and creates tables in <strong>Tables &amp; QR</strong>, table QR links and menus will appear here automatically.
                  </div>
                )}
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
