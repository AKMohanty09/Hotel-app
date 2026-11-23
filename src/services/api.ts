import type {
  Bill,
  CustomerServiceRequest,
  InventoryItem,
  InventoryMovement,
  KitchenTicket,
  MenuCategory,
  MenuItem,
  OnlinePlatformConfig,
  Order,
  OrderChannel,
  OrderPriority,
  OrderStatus,
  PaymentMethod,
  PaymentRecord,
  PurchaseOrder,
  RestaurantReview,
  RestaurantSettings,
  RestaurantSnapshot,
  RestaurantTable,
  StaffProfile,
  StaffRole,
  TableSession,
  TableStatus,
  TableVerificationRequest,
  TicketStatus,
} from '../types/domain';

// Token held strictly in JS memory (never in localStorage) per security policy
let authTokenMemory: string | null = null;

export function setAuthToken(token: string | null) {
  authTokenMemory = token;
}

export function getAuthToken(): string | null {
  return authTokenMemory;
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (authTokenMemory && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authTokenMemory}`);
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface AuthStatusResponse {
  adminClaimed: boolean;
  ownerRegistered?: boolean;
  needsSupabaseSchema?: boolean;
  needsFullDatabaseSchema?: boolean;
  needsSupabaseServiceRoleKey?: boolean;
  restaurantName: string;
  logoUrl: string;
}

export interface CustomerTableBootstrap {
  settings: Partial<RestaurantSettings> & {
    name: string;
    logoUrl: string;
    currencySymbol: string;
    taxRatePercent: number;
    serviceChargePercent: number;
    otpExpirySeconds: number;
    otpResendCooldownSeconds: number;
    serviceRequestCooldownSeconds: number;
    allowSplitPayment: boolean;
    allowSplitBill: boolean;
    defaultTheme?: 'light' | 'dark';
  };
  table: RestaurantTable;
  categories: MenuCategory[];
  menuItems: MenuItem[];
  stations: RestaurantSnapshot['stations'];
  activeSession: TableSession | null;
  pendingRequest: TableVerificationRequest | null;
  sessionOrders: Order[];
  sessionBill: Bill | null;
  serviceRequests: CustomerServiceRequest[];
  sessionReview?: RestaurantReview | null;
}

export const api = {
  // Auth & Setup
  getAuthStatus: () => requestJson<AuthStatusResponse>('/api/auth/status'),
  getSupabaseSchemaSql: () => requestJson<{ sql: string }>('/api/setup/supabase-schema'),
  registerOwner: (payload: {
    restaurantName: string;
    ownerName: string;
    email: string;
    mobile?: string;
    photoUrl?: string;
    passcode: string;
  }) =>
    requestJson<{ token: string; staff: StaffProfile }>('/api/auth/register-owner', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  uploadMedia: (payload: {
    dataUrl: string;
    category: 'staff' | 'menu_item' | 'logo';
    entityId?: string;
    fileName?: string;
  }) =>
    requestJson<{ id: string; url: string; mimeType: string; byteSize: number }>('/api/media/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  login: (identifier: string, passcode: string) =>
    requestJson<{ token: string; staff: StaffProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, passcode }),
    }),
  getMe: () => requestJson<{ staff: StaffProfile }>('/api/auth/me'),
  logout: () => requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  updateProfile: (payload: { email?: string; name?: string; mobile?: string; photoUrl?: string }) =>
    requestJson<{ staff: StaffProfile }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  resetPassword: (newPasscode: string, targetStaffId?: string) =>
    requestJson<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ newPasscode, targetStaffId }),
    }),

  // Public Customer QR Portal
  getPublicTables: () =>
    requestJson<{
      tables: Pick<RestaurantTable, 'id' | 'tableNumber' | 'capacity' | 'floor' | 'section' | 'status' | 'qrToken'>[];
      settings: CustomerTableBootstrap['settings'];
    }>('/api/public/tables'),
  getCustomerTable: (qrToken: string, sessionId?: string) =>
    requestJson<CustomerTableBootstrap>(
      `/api/public/table/${encodeURIComponent(qrToken)}${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`
    ),
  requestVerification: (qrToken: string, guestCount: number, guestLabel?: string) =>
    requestJson<{ verificationRequest: TableVerificationRequest }>('/api/public/verification/request', {
      method: 'POST',
      body: JSON.stringify({ qrToken, guestCount, guestLabel }),
    }),
  resendVerification: (requestId: string) =>
    requestJson<{ verificationRequest: TableVerificationRequest }>('/api/public/verification/resend', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),
  verifyOtp: (requestId: string, otp: string) =>
    requestJson<{ session: TableSession; verificationRequest: TableVerificationRequest }>(
      '/api/public/verification/verify',
      {
        method: 'POST',
        body: JSON.stringify({ requestId, otp }),
      }
    ),
  getPublicSession: (sessionId: string) =>
    requestJson<{
      session: TableSession;
      orders: Order[];
      bill: Bill | null;
      payments: PaymentRecord[];
      serviceRequests: CustomerServiceRequest[];
      table: RestaurantTable;
      review?: RestaurantReview | null;
    }>(`/api/public/session/${encodeURIComponent(sessionId)}`),
  submitCustomerOrder: (
    sessionId: string,
    qrToken: string,
    items: { menuItemId: string; variantId?: string; quantity: number; modifierIds?: string[]; instructions?: string }[]
  ) =>
    requestJson<{ order: Order; tickets: KitchenTicket[] }>('/api/public/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId, qrToken, items }),
    }),
  sendServiceRequest: (
    tableId: string,
    sessionId: string | undefined,
    requestType: CustomerServiceRequest['requestType'],
    notes?: string
  ) =>
    requestJson<{ serviceRequest: CustomerServiceRequest }>('/api/public/service-requests', {
      method: 'POST',
      body: JSON.stringify({ tableId, sessionId, requestType, notes }),
    }),
  generateCustomerBill: (sessionId: string) =>
    requestJson<{ bill: Bill }>('/api/public/bills/generate', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  payCustomerBill: (billId: string, amount: number, method: 'upi' | 'card', reference?: string) =>
    requestJson<{ bill: Bill; payment: PaymentRecord }>('/api/public/payments', {
      method: 'POST',
      body: JSON.stringify({ billId, amount, method, reference }),
    }),
  submitReview: (payload: {
    sessionId?: string;
    qrToken?: string;
    customerName?: string;
    overallRating: number;
    foodRating: number;
    serviceRating: number;
    comment?: string;
  }) =>
    requestJson<{ review: RestaurantReview }>('/api/public/reviews', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  replyToReview: (reviewId: string, reply: string) =>
    requestJson<{ review: RestaurantReview }>(`/api/reviews/${encodeURIComponent(reviewId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply }),
    }),
  deleteReview: (reviewId: string) =>
    requestJson<{ ok: boolean }>(`/api/reviews/${encodeURIComponent(reviewId)}`, {
      method: 'DELETE',
    }),

  // Staff / Manager / Waiter / Kitchen
  getSnapshot: () => requestJson<RestaurantSnapshot>('/api/snapshot'),

  createTable: (payload: Partial<RestaurantTable>) =>
    requestJson<{ table: RestaurantTable }>('/api/tables', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTable: (id: string, payload: Partial<RestaurantTable>) =>
    requestJson<{ table: RestaurantTable }>(`/api/tables/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  revokeTableQr: (id: string, reason: string) =>
    requestJson<{ table: RestaurantTable }>(`/api/tables/${encodeURIComponent(id)}/revoke-qr`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  moveTableSession: (id: string, targetTableId: string) =>
    requestJson<{ ok: boolean }>(`/api/tables/${encodeURIComponent(id)}/move-session`, {
      method: 'POST',
      body: JSON.stringify({ targetTableId }),
    }),
  deleteTable: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/tables/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  confirmPresenceAndRevealOtp: (requestId: string) =>
    requestJson<{ verificationRequest: TableVerificationRequest; otp: string; expiresAt: string }>(
      `/api/verifications/${encodeURIComponent(requestId)}/confirm-presence`,
      { method: 'POST' }
    ),
  rejectVerification: (requestId: string, reason?: string) =>
    requestJson<{ verificationRequest: TableVerificationRequest }>(
      `/api/verifications/${encodeURIComponent(requestId)}/reject`,
      { method: 'POST', body: JSON.stringify({ reason }) }
    ),
  updateServiceRequest: (id: string, status: CustomerServiceRequest['status'], notes?: string) =>
    requestJson<{ serviceRequest: CustomerServiceRequest }>(
      `/api/service-requests/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ status, notes }) }
    ),

  createStaffOrder: (payload: {
    tableId?: string;
    channel: OrderChannel;
    items: { menuItemId: string; variantId?: string; quantity: number; modifierIds?: string[]; instructions?: string }[];
    priority?: OrderPriority;
    notes?: string;
  }) =>
    requestJson<{ order: Order; tickets: KitchenTicket[] }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateOrder: (
    id: string,
    payload: {
      status?: OrderStatus;
      priority?: OrderPriority;
      cancellationReason?: string;
      refireReason?: string;
    }
  ) =>
    requestJson<{ order: Order }>(`/api/orders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  confirmOrder: (id: string) =>
    requestJson<{ order: Order; tickets: KitchenTicket[] }>(
      `/api/orders/${encodeURIComponent(id)}/confirm`,
      { method: 'POST' }
    ),

  getRealtimeConfig: () =>
    requestJson<{
      wsPath: string;
      supabase: {
        enabled: boolean;
        url: string | null;
        anonKey: string | null;
        jwtSigningReady: boolean;
      };
    }>('/api/realtime/config'),
  getRealtimeToken: (body?: { qrToken?: string; tableId?: string; sessionId?: string }) =>
    requestJson<{
      scope: 'staff' | 'customer';
      tableId?: string;
      token: string | null;
      expiresAt: string | null;
    }>('/api/realtime/token', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),

  updateKitchenTicket: (
    id: string,
    payload: {
      status?: TicketStatus;
      delayReason?: string;
      clarificationNote?: string;
      toggleItemId?: string;
    }
  ) =>
    requestJson<{ ticket: KitchenTicket }>(`/api/kitchen/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  generateBill: (sessionId: string) =>
    requestJson<{ bill: Bill }>('/api/bills/generate', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  recordPayment: (billId: string, amount: number, method: PaymentMethod, reference?: string) =>
    requestJson<{ bill: Bill; payment: PaymentRecord }>(
      `/api/bills/${encodeURIComponent(billId)}/payments`,
      { method: 'POST', body: JSON.stringify({ amount, method, reference }) }
    ),
  adjustBill: (billId: string, type: 'discount' | 'correction' | 'refund', amount: number, reason: string) =>
    requestJson<{ bill: Bill }>(`/api/bills/${encodeURIComponent(billId)}/adjustments`, {
      method: 'POST',
      body: JSON.stringify({ type, amount, reason }),
    }),

  createCategory: (payload: { name: string; icon?: string; sortOrder?: number }) =>
    requestJson<{ category: MenuCategory }>('/api/menu/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCategory: (id: string, payload: Partial<MenuCategory>) =>
    requestJson<{ category: MenuCategory }>(`/api/menu/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createMenuItem: (payload: Partial<MenuItem>) =>
    requestJson<{ item: MenuItem }>('/api/menu/items', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMenuItem: (id: string, payload: Partial<MenuItem>) =>
    requestJson<{ item: MenuItem }>(`/api/menu/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  createStaff: (payload: {
    name: string;
    email: string;
    mobile?: string;
    photoUrl?: string;
    role: StaffRole;
    section?: string;
    kitchenStationId?: string;
    shift?: StaffProfile['shift'];
    passcode: string;
  }) =>
    requestJson<{ staff: StaffProfile }>('/api/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateStaff: (id: string, payload: Partial<StaffProfile>) =>
    requestJson<{ staff: StaffProfile }>(`/api/staff/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  toggleShift: () => requestJson<{ onDuty: boolean }>('/api/shifts/toggle', { method: 'POST' }),

  adjustInventory: (
    itemId: string,
    type: InventoryMovement['type'],
    quantity: number,
    reason?: string
  ) =>
    requestJson<{ item: InventoryItem }>('/api/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify({ itemId, type, quantity, reason }),
    }),
  createInventoryItem: (payload: Partial<InventoryItem>) =>
    requestJson<{ item: InventoryItem }>('/api/inventory/items', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createPurchaseOrder: (supplierId: string, itemId: string, quantity: number) =>
    requestJson<{ purchaseOrder: PurchaseOrder }>('/api/purchase-orders', {
      method: 'POST',
      body: JSON.stringify({ supplierId, itemId, quantity }),
    }),

  updateIntegration: (
    platform: 'swiggy' | 'zomato' | 'direct_online',
    payload: { outletId?: string; autoAcceptOrders?: boolean; menuSyncEnabled?: boolean }
  ) =>
    requestJson<{ platform: OnlinePlatformConfig }>(`/api/integrations/${platform}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  simulateOnlineOrder: (
    platform: 'swiggy' | 'zomato',
    payload: {
      externalOrderId?: string;
      items: { menuItemId: string; quantity: number; instructions?: string }[];
      packagingNotes?: string;
    }
  ) =>
    requestJson<{ order: Order; tickets: KitchenTicket[] }>(
      `/api/integrations/${platform}/test-order`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  updateSettings: (payload: Partial<RestaurantSettings>) =>
    requestJson<{ settings: RestaurantSettings }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  markNotificationRead: (id?: string) =>
    requestJson<{ ok: boolean }>('/api/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
};

export type TableStatusFilter = TableStatus | 'All';
