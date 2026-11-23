import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChefHat,
  Clock,
  CreditCard,
  Minus,
  Moon,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Sun,
  Utensils,
  X,
} from 'lucide-react';
import { api, type CustomerTableBootstrap } from '../../services/api';
import { useRealtimeSync } from '../../hooks/useRealtimeSync';
import type {
  CustomerServiceRequest,
  MenuItem,
  Order,
  ServiceRequestType,
} from '../../types/domain';
import { downloadBillPdf } from '../../lib/exportUtils';
import { CustomerMenuSkeleton } from '../common/Skeleton';

interface CartLine {
  key: string;
  menuItem: MenuItem;
  variantId?: string;
  variantName?: string;
  unitBasePrice: number;
  quantity: number;
  modifierIds: string[];
  instructions: string;
}

interface CustomerPortalProps {
  qrToken: string;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onSyncDefaultTheme?: (theme?: 'system' | 'light' | 'dark') => void;
  onExitToPortalSelect?: () => void;
}

const SERVICE_BUTTONS: ServiceRequestType[] = [
  'Call Waiter',
  'Water',
  'Extra Plates',
  'Cutlery',
  'Napkins',
  'Sauce',
  'Bill',
  'Help',
  'Other',
];

export const CustomerPortal: React.FC<CustomerPortalProps> = ({
  qrToken,
  theme = 'light',
  onToggleTheme,
  onSyncDefaultTheme,
  onExitToPortalSelect,
}) => {
  const sessionStorageKey = `sh_session_${qrToken}`;
  const reqStorageKey = `sh_vreq_${qrToken}`;

  const [data, setData] = useState<CustomerTableBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [activeTab, setActiveTab] = useState<'menu' | 'orders' | 'service' | 'bill'>('menu');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [vegOnly, setVegOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected size variant per item on dish cards
  const [selectedVariantByItem, setSelectedVariantByItem] = useState<Record<string, string>>({});

  // Detail modal state
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [detailVariantId, setDetailVariantId] = useState<string | undefined>(undefined);
  const [detailModifiers, setDetailModifiers] = useState<string[]>([]);
  const [detailQty, setDetailQty] = useState(1);
  const [detailInstructions, setDetailInstructions] = useState('');

  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Verification / OTP states
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [guestCount, setGuestCount] = useState(2);
  const [guestLabel, setGuestLabel] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(() =>
    sessionStorage.getItem(reqStorageKey)
  );
  const [sessionId, setSessionId] = useState<string | null>(() =>
    sessionStorage.getItem(sessionStorageKey)
  );

  // Service & Payment & Review states
  const [customNote, setCustomNote] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'upi' | 'card'>('upi');
  const [paying, setPaying] = useState(false);
  const [overallRating, setOverallRating] = useState(5);
  const [foodRating, setFoodRating] = useState(5);
  const [serviceRating, setServiceRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  const loadBootstrap = useCallback(async () => {
    try {
      const savedSes = sessionStorage.getItem(sessionStorageKey) || undefined;
      const res = await api.getCustomerTable(qrToken, savedSes);
      setData(res);
      if (res.settings.defaultTheme) {
        onSyncDefaultTheme?.(res.settings.defaultTheme);
      }
      if (res.activeSession) {
        setSessionId(res.activeSession.id);
        sessionStorage.setItem(sessionStorageKey, res.activeSession.id);
      } else if (savedSes) {
        const check = await api.getPublicSession(savedSes).catch(() => null);
        if (check?.session) {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  activeSession: check.session,
                  sessionOrders: check.orders,
                  sessionBill: check.bill,
                  serviceRequests: check.serviceRequests,
                }
              : prev
          );
        } else {
          sessionStorage.removeItem(sessionStorageKey);
          setSessionId(null);
        }
      }
      if (res.pendingRequest) {
        setRequestId(res.pendingRequest.id);
        sessionStorage.setItem(reqStorageKey, res.pendingRequest.id);
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load table menu.');
    } finally {
      setLoading(false);
    }
  }, [qrToken, reqStorageKey, sessionStorageKey, onSyncDefaultTheme]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useRealtimeSync(() => {
    void loadBootstrap();
  }, true);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 4000);
  };

  const currency = data?.settings.currencySymbol || '₹';

  const getActiveVariant = useCallback(
    (item: MenuItem, explicitVariantId?: string) => {
      if (!item.variants || item.variants.length === 0) return undefined;
      const chosenId = explicitVariantId ?? selectedVariantByItem[item.id];
      return item.variants.find((v) => v.id === chosenId) || item.variants[0];
    },
    [selectedVariantByItem]
  );

  const filteredItems = useMemo(() => {
    if (!data) return [];
    return data.menuItems.filter((item) => {
      if (selectedCategory !== 'all' && item.categoryId !== selectedCategory) return false;
      if (vegOnly && item.vegType === 'non_veg') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        if (
          !item.name.toLowerCase().includes(q) &&
          !item.description.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [data, selectedCategory, vegOnly, searchQuery]);

  const cartTotals = useMemo(() => {
    if (!data) return { subtotal: 0, tax: 0, service: 0, total: 0, count: 0 };
    const subtotal = cart.reduce((sum, line) => {
      const modSum = line.modifierIds.reduce((mSum, mid) => {
        const mod = line.menuItem.modifiers.find((m) => m.id === mid);
        return mSum + (mod?.priceDelta || 0);
      }, 0);
      return sum + (line.unitBasePrice + modSum) * line.quantity;
    }, 0);
    const tax = Math.round(subtotal * (data.settings.taxRatePercent / 100) * 100) / 100;
    const service = Math.round(subtotal * (data.settings.serviceChargePercent / 100) * 100) / 100;
    const total = Math.round((subtotal + tax + service) * 100) / 100;
    const count = cart.reduce((s, l) => s + l.quantity, 0);
    return { subtotal, tax, service, total, count };
  }, [cart, data]);

  const openDetailModal = (item: MenuItem) => {
    const activeVariant = getActiveVariant(item);
    setDetailItem(item);
    setDetailVariantId(activeVariant?.id);
    setDetailModifiers([]);
    setDetailQty(1);
    setDetailInstructions('');
  };

  const addToCart = (
    item: MenuItem,
    modifierIds: string[],
    quantity: number,
    instructions: string,
    explicitVariantId?: string
  ) => {
    const variant = getActiveVariant(item, explicitVariantId);
    const unitBasePrice = variant ? variant.price : item.price;
    const key = `${item.id}_${variant?.id || ''}_${[...modifierIds].sort().join(',')}_${instructions.trim()}`;

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + quantity };
        return copy;
      }
      return [
        ...prev,
        {
          key,
          menuItem: item,
          variantId: variant?.id,
          variantName: variant?.name,
          unitBasePrice,
          quantity,
          modifierIds,
          instructions: instructions.trim(),
        },
      ];
    });
    setDetailItem(null);
    showToast(`Added ${item.name}${variant ? ` (${variant.name})` : ''} to cart`);
  };

  const updateCartQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) => (line.key === key ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0)
    );
  };

  const handleRequestVerification = async () => {
    setVerifyError('');
    setVerifyBusy(true);
    try {
      const res = await api.requestVerification(qrToken, guestCount, guestLabel);
      setRequestId(res.verificationRequest.id);
      sessionStorage.setItem(reqStorageKey, res.verificationRequest.id);
      await loadBootstrap();
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Unable to send verification request.');
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleResendOtp = async () => {
    if (!requestId) return;
    setVerifyError('');
    setVerifyBusy(true);
    try {
      await api.resendVerification(requestId);
      showToast('New verification code generated for your waiter.');
      await loadBootstrap();
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Resend cooldown active.');
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestId || otpInput.trim().length < 4) {
      setVerifyError('Please enter the 4-digit OTP shared by your waiter.');
      return;
    }
    setVerifyError('');
    setVerifyBusy(true);
    try {
      const res = await api.verifyOtp(requestId, otpInput.trim());
      setSessionId(res.session.id);
      sessionStorage.setItem(sessionStorageKey, res.session.id);
      setVerifyOpen(false);
      setOtpInput('');
      showToast(`Table ${data?.table.tableNumber} verified. You can now place orders!`);
      await loadBootstrap();
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'OTP verification failed.');
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleSubmitOrder = async () => {
    if (!data?.activeSession || data.activeSession.status !== 'active') {
      setCartOpen(false);
      setVerifyOpen(true);
      return;
    }
    if (cart.length === 0 || submittingOrder) return;
    setSubmittingOrder(true);
    try {
      const res = await api.submitCustomerOrder(
        data.activeSession.id,
        qrToken,
        cart.map((l) => ({
          menuItemId: l.menuItem.id,
          variantId: l.variantId,
          quantity: l.quantity,
          modifierIds: l.modifierIds,
          instructions: l.instructions,
        }))
      );
      setCart([]);
      setCartOpen(false);
      setActiveTab('orders');
      showToast(`Order ${res.order.orderNumber} sent to the kitchen!`);
      await loadBootstrap();
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Order failed');
      showToast(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleServiceButton = async (type: ServiceRequestType) => {
    if (!data) return;
    try {
      await api.sendServiceRequest(
        data.table.id,
        data.activeSession?.id,
        type,
        type === 'Other' ? customNote : undefined
      );
      if (type === 'Other') setCustomNote('');
      showToast(`${type} request sent to your waiter.`);
      await loadBootstrap();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not send request');
    }
  };

  const handleGenerateBill = async () => {
    if (!data?.activeSession) return;
    try {
      const res = await api.generateCustomerBill(data.activeSession.id);
      setPayAmount(String(res.bill.balanceAmount));
      await loadBootstrap();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to generate bill');
    }
  };

  const handleCustomerPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.sessionBill) return;
    const amt = Number(payAmount || data.sessionBill.balanceAmount);
    setPaying(true);
    try {
      await api.payCustomerBill(data.sessionBill.id, amt, payMethod);
      showToast('Payment recorded! Thank you.');
      await loadBootstrap();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Payment error');
    } finally {
      setPaying(false);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.activeSession) return;
    try {
      await api.submitReview({
        sessionId: data.activeSession.id,
        overallRating,
        foodRating,
        serviceRating,
        comment: reviewComment,
      });
      setReviewSubmitted(true);
      showToast('Thank you for your feedback!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to submit review');
    }
  };

  if (loading) {
    return <CustomerMenuSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">QR Table Unavailable</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error || 'Unable to load menu.'}</p>
          {onExitToPortalSelect && (
            <button
              type="button"
              onClick={onExitToPortalSelect}
              className="mt-5 rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-2 text-sm font-medium text-white"
            >
              Return to Portal Launcher
            </button>
          )}
        </div>
      </div>
    );
  }

  const isSessionActive = data.activeSession?.status === 'active';
  const isSessionClosed = data.activeSession?.status === 'closed';
  const pendingReq = data.pendingRequest;

  const detailActiveVariant = detailItem ? getActiveVariant(detailItem, detailVariantId) : undefined;
  const detailBasePrice = detailItem
    ? detailActiveVariant
      ? detailActiveVariant.price
      : detailItem.price
    : 0;
  const detailModifierTotal = detailItem
    ? detailModifiers.reduce((sum, mid) => {
        const mod = detailItem.modifiers.find((m) => m.id === mid);
        return sum + (mod?.priceDelta || 0);
      }, 0)
    : 0;
  const detailLineTotal = (detailBasePrice + detailModifierTotal) * detailQty;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Compact Sticky Top App Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 sm:py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {onExitToPortalSelect && (
              <button
                type="button"
                aria-label="Back to Staff Login"
                onClick={onExitToPortalSelect}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <img
              src={data.settings.logoUrl}
              alt={data.settings.name}
              referrerPolicy="no-referrer"
              className="h-9 w-9 shrink-0 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-white"
            />
            <div className="min-w-0">
              <div className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {data.settings.name}
              </div>
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                Table {data.table.tableNumber} · {data.table.section}
                {isSessionActive ? ' · Verified' : isSessionClosed ? ' · Closed' : ' · Menu Card'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {onToggleTheme && (
              <button
                type="button"
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                onClick={onToggleTheme}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-amber-400 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            )}
            {!isSessionActive && !isSessionClosed && (
              <button
                type="button"
                onClick={() => setVerifyOpen(true)}
                className="rounded-xl bg-orange-600 px-3 sm:px-3.5 py-2 text-xs font-semibold text-white hover:bg-orange-700 whitespace-nowrap shadow-sm shadow-orange-600/20"
              >
                Start Ordering
              </button>
            )}
            {isSessionActive && (
              <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1.5 text-[11px] sm:text-xs font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">Verified</span>
              </span>
            )}
          </div>
        </div>
      </header>

      {toast && (
        <div
          role="status"
          className="fixed top-16 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-50 rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-2.5 text-xs font-medium text-white shadow-lg pointer-events-none whitespace-nowrap"
        >
          {toast}
        </div>
      )}

      <main className="mx-auto max-w-6xl px-3 sm:px-4 pt-4 sm:pt-5 pb-40 sm:pb-28">
        {/* Desktop Sub-navigation Tabs */}
        <div className="hidden sm:inline-flex items-center gap-1 rounded-xl bg-slate-200/70 dark:bg-slate-800/80 p-1">
          {(
            [
              ['menu', 'Menu Card', Utensils],
              ['orders', `Orders (${data.sessionOrders.length})`, ChefHat],
              ['service', 'Waiter Call', Bell],
              ['bill', 'Bill & Pay', Receipt],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                activeTab === key
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* MENU TAB */}
        {activeTab === 'menu' && (
          <div className="sm:mt-5 space-y-4 sm:space-y-5">
            {/* Table Digital Menu Card Header */}
            <section className="relative overflow-hidden rounded-3xl border border-slate-200 dark:border-dusk bg-gradient-to-br from-white via-orange-50/50 to-lavender/25 dark:from-plum dark:via-slate-900 dark:to-obsidian p-4 sm:p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <img
                    src={data.settings.logoUrl}
                    alt={data.settings.name}
                    referrerPolicy="no-referrer"
                    className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 bg-white shadow-sm shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                      <Sparkles className="h-3.5 w-3.5" />
                      Table {data.table.tableNumber} Menu Card · {data.table.floor}
                    </div>
                    <h1 className="mt-0.5 font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
                      {data.settings.name}
                    </h1>
                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                      {data.settings.tagline || 'Freshly fired from our hearth to your table'} · {data.table.capacity} seats ({data.table.section})
                    </p>
                  </div>
                </div>

                {!isSessionActive && !isSessionClosed ? (
                  <button
                    type="button"
                    onClick={() => setVerifyOpen(true)}
                    className="shrink-0 rounded-2xl bg-slate-900 dark:bg-orange-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700 transition-colors whitespace-nowrap"
                  >
                    Verify Table to Order
                  </button>
                ) : isSessionActive ? (
                  <div className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 shrink-0 self-start sm:self-center">
                    <ShieldCheck className="h-4 w-4" />
                    Table Verified · Ordering Open
                  </div>
                ) : null}
              </div>
            </section>

            {/* Search & Dietary Filters */}
            <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search dishes, wood-fired pizzas, beverages..."
                  className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setVegOnly((v) => !v)}
                className={`rounded-2xl border px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  vegOnly
                    ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {vegOnly ? 'Showing Veg / Vegan Only' : 'All Dietary Types'}
              </button>
            </div>

            {/* Category Selector */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`rounded-2xl px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  selectedCategory === 'all'
                    ? 'bg-slate-900 dark:bg-orange-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                All Categories
              </button>
              {data.categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`rounded-2xl px-4 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-slate-900 dark:bg-orange-600 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {/* Menu Grid */}
            {filteredItems.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                No dishes match your current filter.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredItems.map((item) => {
                  const soldOut = !item.isAvailable || item.isTemporarilySoldOut;
                  const variants = item.variants || [];
                  const activeVariant = getActiveVariant(item);
                  const displayPrice = activeVariant ? activeVariant.price : item.price;

                  return (
                    <article
                      key={item.id}
                      className="group flex flex-col overflow-hidden rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="relative aspect-[16/10] sm:aspect-[4/3] w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <img
                          src={item.photoUrl}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${
                            soldOut ? 'opacity-50 grayscale' : ''
                          }`}
                        />
                        {item.isFeatured && !soldOut && (
                          <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-xl bg-slate-950/75 backdrop-blur-sm px-2.5 py-1 text-[11px] font-semibold text-amber-300">
                            <Sparkles className="h-3 w-3" />
                            Chef Special
                          </span>
                        )}
                        {soldOut && (
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs font-semibold text-white">
                            Temporarily Sold Out
                          </div>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col justify-between p-4">
                        <div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <span
                              className={`inline-block h-2.5 w-2.5 rounded-sm border ${
                                item.vegType === 'non_veg'
                                  ? 'border-red-600 bg-red-600'
                                  : 'border-emerald-600 bg-emerald-600'
                              }`}
                              aria-label={item.vegType === 'non_veg' ? 'Non-vegetarian' : 'Vegetarian'}
                            />
                            <span className="font-medium">
                              {item.vegType === 'non_veg' ? 'Non-Veg' : item.vegType === 'vegan' ? 'Vegan' : 'Veg'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>~{item.prepTimeMinutes} min</span>
                            {item.spiceLevel !== 'None' && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{item.spiceLevel}</span>
                              </>
                            )}
                          </div>

                          <h3 className="mt-1.5 font-display text-base font-bold text-slate-900 dark:text-slate-100">
                            {item.name}
                          </h3>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>

                          {/* Interactive Size Selector Pills (e.g. Small / Medium / Large) */}
                          {variants.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={`Select size for ${item.name}`}>
                              {variants.map((v) => {
                                const selected = activeVariant?.id === v.id;
                                return (
                                  <button
                                    key={v.id}
                                    type="button"
                                    disabled={soldOut}
                                    onClick={() =>
                                      setSelectedVariantByItem((prev) => ({ ...prev, [item.id]: v.id }))
                                    }
                                    className={`rounded-xl px-2.5 py-1 text-[11px] font-semibold ${
                                      selected
                                        ? 'bg-orange-600 text-white shadow-sm'
                                        : 'border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-orange-400'
                                    }`}
                                  >
                                    {v.name} · {currency}{v.price.toFixed(0)}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                          <div>
                            <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                              {currency}{displayPrice.toFixed(0)}
                            </div>
                            {activeVariant && (
                              <div className="text-[10px] font-medium text-orange-600 dark:text-orange-400">
                                {activeVariant.name}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openDetailModal(item)}
                              className="min-h-[38px] rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              disabled={soldOut}
                              onClick={() =>
                                item.modifiers.length > 0
                                  ? openDetailModal(item)
                                  : addToCart(item, [], 1, '', activeVariant?.id)
                              }
                              className="min-h-[38px] rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-40 shadow-sm shadow-orange-600/20"
                            >
                              + Add
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ORDERS TRACKING TAB */}
        {activeTab === 'orders' && (
          <div className="sm:mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Live Session Orders
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Updates live directly from the kitchen
              </span>
            </div>

            {data.sessionOrders.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
                <p className="text-sm text-slate-600 dark:text-slate-400">No orders placed in this session yet.</p>
                <button
                  type="button"
                  onClick={() => setActiveTab('menu')}
                  className="mt-4 rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white"
                >
                  Browse Menu
                </button>
              </div>
            ) : (
              data.sessionOrders.map((order: Order) => (
                <div key={order.id} className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                    <div>
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                        {order.orderNumber}
                      </span>
                      <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                        · Placed {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                      Status: {order.status}
                    </span>
                  </div>

                  {/* Visual Stage Progression */}
                  <div className="mt-3 grid grid-cols-6 gap-1 text-[11px] text-center">
                    {['Submitted', 'Confirmed', 'Preparing', 'Partially Ready', 'Ready', 'Served'].map(
                      (stage) => {
                        const steps = ['Submitted', 'Confirmed', 'Preparing', 'Partially Ready', 'Ready', 'Served', 'Completed'];
                        const activeIdx = steps.indexOf(order.status);
                        const stageIdx = steps.indexOf(stage);
                        const done = activeIdx >= stageIdx && activeIdx >= 0;
                        return (
                          <div key={stage} className="space-y-1">
                            <div
                              className={`h-1.5 rounded-full ${
                                done ? 'bg-emerald-600' : 'bg-slate-200 dark:bg-slate-800'
                              }`}
                            />
                            <div className={`truncate ${done ? 'font-semibold text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-600'}`}>
                              {stage === 'Partially Ready' ? 'Partial' : stage}
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>

                  <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex items-center justify-between py-2">
                        <div>
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {item.quantity} × {item.name}
                          </span>
                          {item.modifiers.length > 0 && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {item.modifiers.map((m) => m.name).join(', ')}
                            </div>
                          )}
                          {item.instructions && (
                            <div className="text-xs text-amber-700 dark:text-amber-400">Note: {item.instructions}</div>
                          )}
                        </div>
                        <span className="font-mono text-sm text-slate-800 dark:text-slate-200 tabular-nums">
                          {currency}{item.lineTotal.toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex justify-between border-t border-slate-100 dark:border-slate-800 pt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <span>Order Total (incl. tax &amp; service)</span>
                    <span className="font-mono tabular-nums">{currency}{order.totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* WAITER CALL / SERVICE TAB */}
        {activeTab === 'service' && (
          <div className="sm:mt-5 space-y-5">
            <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                Request Table Assistance
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Your assigned waiter receives these requests immediately.
              </p>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {SERVICE_BUTTONS.filter((b) => b !== 'Other').map((btn) => (
                  <button
                    key={btn}
                    type="button"
                    onClick={() => void handleServiceButton(btn)}
                    className="min-h-[48px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 transition-colors"
                  >
                    {btn}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder="Custom request note (e.g. high chair, allergy check)..."
                  className="flex-1 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void handleServiceButton('Other')}
                  className="rounded-2xl bg-slate-900 dark:bg-orange-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700 whitespace-nowrap"
                >
                  Send Request
                </button>
              </div>
            </div>

            {data.serviceRequests.length > 0 && (
              <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Recent Requests</h3>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.serviceRequests.map((sr: CustomerServiceRequest) => (
                    <div key={sr.id} className="flex items-center justify-between py-2.5 text-sm">
                      <div>
                        <span className="font-medium text-slate-900 dark:text-slate-100">{sr.requestType}</span>
                        {sr.notes && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">({sr.notes})</span>}
                      </div>
                      <span
                        className={`text-xs font-semibold ${
                          sr.status === 'Completed'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : sr.status === 'Accepted'
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {sr.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* BILLING & FEEDBACK TAB */}
        {activeTab === 'bill' && (
          <div className="sm:mt-5 space-y-5">
            {!data.activeSession ? (
              <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-600 dark:text-slate-400">
                Verify your table session and place an order to view your consolidated bill.
              </div>
            ) : !data.sessionBill ? (
              <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center">
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                  Consolidated Table Bill
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {data.sessionOrders.length} order(s) ready to consolidate for Table {data.table.tableNumber}.
                </p>
                <button
                  type="button"
                  disabled={data.sessionOrders.length === 0}
                  onClick={() => void handleGenerateBill()}
                  className="mt-4 rounded-2xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40"
                >
                  Request Consolidated Bill
                </button>
              </div>
            ) : (
              <div className="grid gap-5 lg:grid-cols-12">
                <div className="lg:col-span-7 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                      <div className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                        {data.sessionBill.billNumber}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Table {data.table.tableNumber} · Status: {data.sessionBill.status.toUpperCase()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        downloadBillPdf(data.sessionBill!, data.settings as never)
                      }
                      className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      Download PDF Receipt
                    </button>
                  </div>

                  <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {data.sessionBill.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between py-2">
                        <div>
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {it.quantity} × {it.name}
                          </span>
                          <span className="ml-2 font-mono text-[11px] text-slate-400">
                            {it.orderNumber}
                          </span>
                        </div>
                        <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {currency}{it.lineTotal.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-4 text-sm">
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Subtotal</span>
                      <span className="font-mono tabular-nums">{currency}{data.sessionBill.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Tax ({data.settings.taxRatePercent}%)</span>
                      <span className="font-mono tabular-nums">{currency}{data.sessionBill.taxAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Service Charge ({data.settings.serviceChargePercent}%)</span>
                      <span className="font-mono tabular-nums">{currency}{data.sessionBill.serviceChargeAmount.toFixed(2)}</span>
                    </div>
                    {data.sessionBill.discountAmount > 0 && (
                      <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                        <span>Discount</span>
                        <span className="font-mono tabular-nums">-{currency}{data.sessionBill.discountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-2 text-base font-bold text-slate-900 dark:text-slate-100">
                      <span>Total</span>
                      <span className="font-mono tabular-nums">{currency}{data.sessionBill.totalAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                      <span>Paid</span>
                      <span className="font-mono tabular-nums">{currency}{data.sessionBill.paidAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-orange-600 dark:text-orange-400">
                      <span>Balance Due</span>
                      <span className="font-mono tabular-nums">{currency}{data.sessionBill.balanceAmount.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5 space-y-5">
                  {data.sessionBill.balanceAmount > 0 ? (
                    <form
                      onSubmit={handleCustomerPay}
                      className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4"
                    >
                      <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                        Pay Online or Split Payment
                      </h3>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Payment Method
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {(['upi', 'card'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setPayMethod(m)}
                              className={`rounded-xl border py-2.5 text-xs font-semibold uppercase ${
                                payMethod === m
                                  ? 'border-orange-600 bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-400'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label htmlFor="cust-pay-amt" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          Amount to Pay ({currency})
                        </label>
                        <input
                          id="cust-pay-amt"
                          type="number"
                          step="0.01"
                          min="1"
                          max={data.sessionBill.balanceAmount}
                          value={payAmount || data.sessionBill.balanceAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3.5 py-2.5 font-mono text-sm"
                        />
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          Enter a partial amount to split payment with friends, or leave full balance. For cash payment, ask your waiter.
                        </p>
                      </div>
                      <button
                        type="submit"
                        disabled={paying}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CreditCard className="h-4 w-4" />
                        {paying ? 'Recording Payment...' : `Pay ${currency}${Number(payAmount || data.sessionBill.balanceAmount).toFixed(2)}`}
                      </button>
                    </form>
                  ) : (
                    <div className="rounded-3xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 p-6">
                      <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold">
                        <CheckCircle2 className="h-5 w-5" />
                        Bill Paid in Full
                      </div>
                      <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                        Thank you for dining at {data.settings.name}!
                      </p>

                      {!reviewSubmitted ? (
                        <form onSubmit={handleSubmitReview} className="mt-4 space-y-3 border-t border-emerald-200 dark:border-emerald-800 pt-4">
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Rate Your Experience</h4>
                          {(
                            [
                              ['Overall', overallRating, setOverallRating],
                              ['Food Quality', foodRating, setFoodRating],
                              ['Service', serviceRating, setServiceRating],
                            ] as const
                          ).map(([label, val, setter]) => (
                            <div key={label} className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-700 dark:text-slate-300">{label}</span>
                              <div className="flex gap-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    key={star}
                                    type="button"
                                    aria-label={`${label} ${star} stars`}
                                    onClick={() => setter(star)}
                                    className="p-0.5"
                                  >
                                    <Star
                                      className={`h-4 w-4 ${
                                        star <= val ? 'fill-amber-400 text-amber-500' : 'text-slate-300 dark:text-slate-600'
                                      }`}
                                    />
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                          <textarea
                            rows={2}
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder="Optional feedback for our chef and team..."
                            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-xs"
                          />
                          <button
                            type="submit"
                            className="w-full rounded-xl bg-slate-900 dark:bg-orange-600 py-2.5 text-xs font-semibold text-white"
                          >
                            Submit Feedback
                          </button>
                        </form>
                      ) : (
                        <div className="mt-4 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                          Feedback saved. We hope to welcome you again soon!
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Sticky Floating Cart Bar (Positioned cleanly above Mobile Bottom Nav) */}
      {cartTotals.count > 0 && !cartOpen && (
        <div className="fixed bottom-[86px] left-3 right-3 sm:bottom-0 sm:left-0 sm:right-0 z-30 rounded-2xl sm:rounded-none border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-4 py-3 shadow-xl sm:shadow-none">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {cartTotals.count} item{cartTotals.count === 1 ? '' : 's'} in cart
              </div>
              <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {currency}{cartTotals.total.toFixed(2)}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">est. total</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 sm:py-3 text-sm font-semibold text-white hover:bg-orange-700 shadow-sm shadow-orange-600/20"
            >
              <ShoppingBag className="h-4 w-4" />
              View Cart
            </button>
          </div>
        </div>
      )}

      {/* Mobile App Bottom Navigation Dock */}
      <nav
        aria-label="Customer Mobile Navigation"
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-4 h-16 items-center">
          {(
            [
              ['menu', 'Menu', Utensils, 0],
              ['orders', 'Orders', ChefHat, data.sessionOrders.length],
              ['service', 'Waiter', Bell, 0],
              ['bill', 'Bill', Receipt, 0],
            ] as const
          ).map(([key, label, Icon, badge]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`relative flex flex-col items-center justify-center h-full text-[11px] font-semibold transition-colors ${
                activeTab === key
                  ? 'text-orange-600 dark:text-orange-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {badge > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </div>
              <span className="mt-1">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Dish Detail / Size & Customization Bottom Sheet Modal */}
      {detailItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/65 sm:p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold">{detailItem.name}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {detailActiveVariant ? detailActiveVariant.name : detailItem.portionSize} · Spice: {detailItem.spiceLevel} · ~{detailItem.prepTimeMinutes} min
                </p>
              </div>
              <button
                type="button"
                aria-label="Close dish details"
                onClick={() => setDetailItem(null)}
                className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <img
              src={detailItem.photoUrl}
              alt={detailItem.name}
              referrerPolicy="no-referrer"
              className="mt-4 aspect-[16/9] w-full rounded-2xl object-cover"
            />
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{detailItem.description}</p>
            {detailItem.allergens.length > 0 && (
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 rounded-xl px-3 py-1.5">
                Allergens: {detailItem.allergens.join(', ')}
              </p>
            )}

            {/* Size Variants Picker */}
            {detailItem.variants && detailItem.variants.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Choose Size / Portion
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {detailItem.variants.map((v) => {
                    const selected = detailActiveVariant?.id === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setDetailVariantId(v.id)}
                        className={`rounded-2xl border px-3 py-2.5 text-left transition-all ${
                          selected
                            ? 'border-orange-600 bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 ring-1 ring-orange-600'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="text-xs font-semibold truncate">{v.name}</div>
                        <div className="font-mono text-sm font-bold mt-0.5">
                          {currency}{v.price.toFixed(0)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {detailItem.modifiers.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Customizations &amp; Add-ons
                </h4>
                <div className="space-y-2">
                  {detailItem.modifiers.map((mod) => {
                    const checked = detailModifiers.includes(mod.id);
                    return (
                      <label
                        key={mod.id}
                        className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <span className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setDetailModifiers((prev) =>
                                checked ? prev.filter((id) => id !== mod.id) : [...prev, mod.id]
                              )
                            }
                            className="h-4 w-4 accent-orange-600"
                          />
                          <span>
                            {mod.groupName ? `${mod.groupName}: ` : ''}
                            {mod.name}
                          </span>
                        </span>
                        <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                          +{currency}{mod.priceDelta}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Kitchen Instructions (optional)
              </label>
              <input
                type="text"
                value={detailInstructions}
                onChange={(e) => setDetailInstructions(e.target.value)}
                placeholder="e.g. No onions, extra crispy"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm"
              />
            </div>

            <div className="mt-5 flex items-center justify-between gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-1">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setDetailQty((q) => Math.max(1, q - 1))}
                  className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center font-mono text-sm font-semibold">{detailQty}</span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setDetailQty((q) => q + 1)}
                  className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                disabled={!detailItem.isAvailable || detailItem.isTemporarilySoldOut}
                onClick={() =>
                  addToCart(detailItem, detailModifiers, detailQty, detailInstructions, detailActiveVariant?.id)
                }
                className="flex-1 rounded-2xl bg-orange-600 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40 shadow-sm shadow-orange-600/20"
              >
                Add to Cart · {currency}{detailLineTotal.toFixed(0)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/65 sm:p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 max-h-[90vh] flex flex-col p-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-display text-lg font-bold">
                Your Order Cart · Table {data.table.tableNumber}
              </h3>
              <button
                type="button"
                aria-label="Close cart"
                onClick={() => setCartOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {cart.map((line) => {
                const mods = line.menuItem.modifiers.filter((m) => line.modifierIds.includes(m.id));
                const unit = line.unitBasePrice + mods.reduce((s, m) => s + m.priceDelta, 0);
                return (
                  <div key={line.key} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">
                        {line.menuItem.name}
                        {line.variantName ? ` (${line.variantName})` : ''}
                      </div>
                      {mods.length > 0 && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {mods.map((m) => m.name).join(', ')}
                        </div>
                      )}
                      {line.instructions && (
                        <div className="text-xs text-amber-700 dark:text-amber-400">Note: {line.instructions}</div>
                      )}
                      <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                        {currency}{(unit * line.quantity).toFixed(2)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 p-1">
                      <button
                        type="button"
                        aria-label={`Remove one ${line.menuItem.name}`}
                        onClick={() => updateCartQty(line.key, -1)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center font-mono text-xs font-semibold">{line.quantity}</span>
                      <button
                        type="button"
                        aria-label={`Add one ${line.menuItem.name}`}
                        onClick={() => updateCartQty(line.key, 1)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 border-t border-slate-200 dark:border-slate-800 pt-4 space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">{currency}{cartTotals.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Tax ({data.settings.taxRatePercent}%)</span>
                <span className="font-mono tabular-nums">{currency}{cartTotals.tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Service Charge ({data.settings.serviceChargePercent}%)</span>
                <span className="font-mono tabular-nums">{currency}{cartTotals.service.toFixed(2)}</span>
              </div>
              <div className="flex justify-between pt-2 text-base font-bold">
                <span>Total</span>
                <span className="font-mono tabular-nums">{currency}{cartTotals.total.toFixed(2)}</span>
              </div>
            </div>

            <button
              type="button"
              disabled={submittingOrder}
              onClick={() => void handleSubmitOrder()}
              className="mt-5 w-full rounded-2xl bg-orange-600 py-3.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {isSessionActive
                ? submittingOrder
                  ? 'Sending to Kitchen...'
                  : 'Submit Order to Kitchen'
                : 'Verify Table to Submit Order'}
            </button>
          </div>
        </div>
      )}

      {/* Waiter Presence + OTP Verification Modal */}
      {verifyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-lg font-bold">
                  Verify Table {data.table.tableNumber}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Waiter physical presence check protects your table from unauthorized orders.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close verification"
                onClick={() => setVerifyOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {verifyError && (
              <div role="alert" className="mt-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                {verifyError}
              </div>
            )}

            {!pendingReq || pendingReq.status === 'rejected' || pendingReq.status === 'expired' ? (
              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="guest-count" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Party Size
                    </label>
                    <input
                      id="guest-count"
                      type="number"
                      min={1}
                      max={data.table.capacity + 2}
                      value={guestCount}
                      onChange={(e) => setGuestCount(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="guest-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Guest Name (optional)
                    </label>
                    <input
                      id="guest-name"
                      type="text"
                      value={guestLabel}
                      onChange={(e) => setGuestLabel(e.target.value)}
                      placeholder="e.g. Priya"
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={verifyBusy}
                  onClick={() => void handleRequestVerification()}
                  className="w-full rounded-2xl bg-orange-600 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {verifyBusy ? 'Notifying Waiter...' : 'Request Table Verification'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4">
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 text-xs text-slate-700 dark:text-slate-300 space-y-1.5">
                  <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <Clock className="h-4 w-4 text-orange-600" />
                    {pendingReq.presenceConfirmed
                      ? 'Waiter confirmed your seating! Enter the 4-digit OTP.'
                      : 'Waiter notified. Waiting for waiter to confirm your table presence...'}
                  </div>
                  <p className="text-slate-500 dark:text-slate-400">
                    Your waiter will share the 4-digit code at Table {data.table.tableNumber} once presence is confirmed.
                  </p>
                </div>

                <div>
                  <label htmlFor="otp-code-input" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    4-Digit Verification OTP
                  </label>
                  <input
                    id="otp-code-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter 4-digit OTP"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-center font-mono text-xl font-bold tracking-widest focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={verifyBusy}
                    onClick={() => void handleResendOtp()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Resend
                  </button>
                  <button
                    type="submit"
                    disabled={verifyBusy || otpInput.length < 4}
                    className="flex-1 rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {verifyBusy ? 'Verifying...' : 'Verify & Unlock Ordering'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
