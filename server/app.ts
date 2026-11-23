import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import {
  createAuthSession,
  deleteAuthSession,
  emitSupabaseRealtimeBroadcast,
  getPublicSupabaseRealtimeConfig,
  getSnapshot,
  getStorageBackend,
  getUploadedMedia,
  isAdminClaimed,
  isFullSupabaseSchemaReady,
  isSupabaseAnonKeyConfigured,
  isSupabaseRlsError,
  isSupabaseSchemaMissingError,
  issueScopedRealtimeJwt,
  mutateSnapshot,
  registerInitialOwner,
  resolveAuthSession,
  saveUploadedMedia,
  setStaffPassword,
  updateStaffCredentialEmail,
  verifyStaffCredentials,
} from './db.ts';
import { getFullSupabaseSchemaSql } from './schemaSql.ts';
import { createInitialSnapshot } from './seedData.ts';
import {
  confirmPresenceAndRevealOtp,
  invalidateOtpRequest,
  issueOtpForRequest,
  verifyOtpSubmission,
} from './otpService.ts';
import { integrationAdapters } from './integrations.ts';
import {
  canStaffConfirmTableOrder,
  deriveOrderStatusFromTickets,
  splitOrderIntoKitchenTickets,
  validateAndPriceOrderItems,
} from '../src/lib/orderEngine.ts';
import {
  applyAuditedAdjustment,
  applyPaymentToBill,
  consolidateSessionOrdersToBill,
} from '../src/lib/billingEngine.ts';
import { hasPermission, type Permission } from '../src/lib/permissions.ts';
import { canDeleteTable, generatePermanentQrToken } from '../src/lib/tableRules.ts';
import { parseValidatedDataImage, validateAppImageUrl } from '../src/lib/mediaValidation.ts';
import type {
  AuditLog,
  CustomerServiceRequest,
  InventoryMovement,
  Order,
  OrderChannel,
  OrderPriority,
  OrderStatus,
  PaymentMethod,
  PaymentRecord,
  RestaurantSnapshot,
  RestaurantTable,
  StaffProfile,
  StaffRole,
  TableSession,
  TableStatus,
  TableVerificationRequest,
  TicketStatus,
} from '../src/types/domain.ts';

interface AuthedRequest extends Request {
  staff?: StaffProfile;
  authToken?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appendAudit(
  snap: RestaurantSnapshot,
  actor: { id: string; name: string; role: string },
  action: string,
  entityType: string,
  recordId: string,
  reason?: string,
  metadata?: Record<string, string | number | boolean | null>
) {
  const log: AuditLog = {
    id: `aud_${crypto.randomUUID().slice(0, 12)}`,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    action,
    entityType,
    recordId,
    reason,
    metadata,
    createdAt: new Date().toISOString(),
  };
  snap.auditLogs.unshift(log);
  if (snap.auditLogs.length > 500) {
    snap.auditLogs = snap.auditLogs.slice(0, 500);
  }
}

function pushNotification(
  snap: RestaurantSnapshot,
  targetRoles: StaffRole[],
  severity: 'info' | 'success' | 'warning' | 'urgent',
  title: string,
  message: string,
  linkPortal?: 'manager' | 'waiter' | 'kitchen' | 'customer',
  linkTab?: string,
  targetUserId?: string
) {
  snap.notifications.unshift({
    id: `ntf_${crypto.randomUUID().slice(0, 12)}`,
    targetRoles,
    targetUserId,
    severity,
    title,
    message,
    linkPortal,
    linkTab,
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  if (snap.notifications.length > 150) {
    snap.notifications = snap.notifications.slice(0, 150);
  }
}

async function resolveBearerStaff(
  authHeader: string | undefined
): Promise<{ staff: StaffProfile; token: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  // Check Express/Supabase-persisted session token
  const staffId = await resolveAuthSession(token);
  if (staffId) {
    const snap = await getSnapshot();
    const staff = snap.staff.find((s) => s.id === staffId && s.status === 'active');
    if (staff) return { staff, token };
  }

  return null;
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const resolved = await resolveBearerStaff(req.headers.authorization);
    if (!resolved) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }
    req.staff = resolved.staff;
    req.authToken = resolved.token;
    next();
  } catch (err) {
    next(err);
  }
}

function requirePerm(permission: Permission) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.staff || !hasPermission(req.staff.role, permission)) {
      return res.status(403).json({
        error: `Access denied: ${req.staff?.role || 'guest'} role lacks "${permission}" permission.`,
      });
    }
    next();
  };
}

function sanitizeSnapshotForRole(snap: RestaurantSnapshot, staff: StaffProfile): RestaurantSnapshot {
  const isKitchen = staff.role === 'kitchen_staff' || staff.role === 'kitchen_supervisor';
  const isWaiter = staff.role === 'waiter';

  if (isKitchen) {
    return {
      ...snap,
      settings: {
        ...snap.settings,
        gstNumber: '',
        email: '',
        phone: '',
      },
      staff: snap.staff.map((s) => ({
        ...s,
        email: '',
        mobile: '',
      })),
      bills: [],
      payments: [],
      auditLogs: [],
      reviews: [],
      platforms: snap.platforms.map((p) => ({ ...p, outletId: '' })),
    };
  }

  if (isWaiter && !hasPermission(staff.role, 'view_all_tables')) {
    const assignedTables = snap.tables.filter(
      (t) =>
        !t.isArchived &&
        (t.assignedWaiterId === staff.id ||
          t.assignedWaiterId === staff.uid ||
          staff.assignedTableIds.includes(t.id))
    );
    const assignedIds = new Set(assignedTables.map((t) => t.id));
    const scopedOrders = snap.orders.filter(
      (o) =>
        (o.tableId && assignedIds.has(o.tableId)) ||
        o.waiterId === staff.id ||
        o.waiterId === staff.uid
    );
    const scopedOrderIds = new Set(scopedOrders.map((o) => o.id));
    const scopedBills = snap.bills.filter((b) => assignedIds.has(b.tableId));
    const scopedBillIds = new Set(scopedBills.map((b) => b.id));

    return {
      ...snap,
      tables: assignedTables,
      verifications: snap.verifications.filter(
        (v) => assignedIds.has(v.tableId) || v.waiterId === staff.id || v.waiterId === staff.uid
      ),
      sessions: snap.sessions.filter(
        (s) => assignedIds.has(s.tableId) || s.waiterId === staff.id || s.waiterId === staff.uid
      ),
      orders: scopedOrders,
      tickets: snap.tickets.filter((tk) => scopedOrderIds.has(tk.orderId)),
      serviceRequests: snap.serviceRequests.filter(
        (sr) => assignedIds.has(sr.tableId) || sr.waiterId === staff.id || sr.waiterId === staff.uid
      ),
      bills: scopedBills,
      payments: snap.payments.filter((p) => scopedBillIds.has(p.billId)),
      staff: snap.staff.map((s) =>
        s.id === staff.id ? s : { ...s, email: '', mobile: '' }
      ),
      auditLogs: [],
      suppliers: [],
      purchaseOrders: [],
    };
  }

  return {
    ...snap,
    reviews: snap.reviews || [],
  };
}

function sanitizePublicSettings(snap: RestaurantSnapshot) {
  const s = snap.settings;
  return {
    id: s.id,
    name: s.name,
    tagline: s.tagline,
    logoUrl: s.logoUrl,
    address: s.address,
    phone: s.phone,
    openingHours: s.openingHours,
    currencySymbol: s.currencySymbol,
    taxRatePercent: s.taxRatePercent,
    serviceChargePercent: s.serviceChargePercent,
    otpExpirySeconds: s.otpExpirySeconds,
    otpResendCooldownSeconds: s.otpResendCooldownSeconds,
    serviceRequestCooldownSeconds: s.serviceRequestCooldownSeconds,
    allowSplitPayment: s.allowSplitPayment,
    allowSplitBill: s.allowSplitBill,
    defaultTheme: s.defaultTheme || 'system',
  };
}

function ingestOnlineOrderIntoCentralEngine(
  snap: RestaurantSnapshot,
  platformKey: 'swiggy' | 'zomato' | 'direct_online',
  rawBody: unknown,
  actor: { id: string; name: string; role: string },
  isSandboxSimulation: boolean
) {
  const adapter = integrationAdapters[platformKey];
  if (!adapter) throw new Error(`Unsupported platform "${platformKey}".`);
  const payload = adapter.normalizePayload(rawBody);
  const now = new Date().toISOString();

  const matchedInputs = (payload.items.length > 0
    ? payload.items
    : [{ menuItemId: snap.menuItems[0]?.id, quantity: 1 }]
  ).map((it) => {
    const found = snap.menuItems.find(
      (m) =>
        m.id === it.menuItemId ||
        m.code.toLowerCase() === (it.code || '').toLowerCase() ||
        m.name.toLowerCase() === (it.name || '').toLowerCase()
    );
    if (!found) throw new Error(`Unmapped external dish: "${it.name || it.menuItemId}"`);
    return { menuItemId: found.id, quantity: it.quantity, instructions: it.instructions };
  });

  const priced = validateAndPriceOrderItems(matchedInputs, snap.menuItems, snap.settings, platformKey);
  const platformCfg = snap.platforms.find((p) => p.platform === platformKey);
  const computedFee =
    payload.platformFee && payload.platformFee > 0
      ? payload.platformFee
      : Math.round(priced.subtotal * ((platformCfg?.commissionPercent || 20) / 100) * 100) / 100;

  const order: Order = {
    id: `ord_${crypto.randomUUID().slice(0, 12)}`,
    orderNumber: `ORD-${1042 + snap.orders.length}`,
    channel: platformKey,
    externalOrderId: payload.externalOrderId,
    platformFee: computedFee,
    packagingNotes: payload.packagingNotes,
    expectedPickupAt: new Date(Date.now() + (payload.expectedPickupMinutes || 20) * 60000).toISOString(),
    status: platformCfg?.autoAcceptOrders ? 'Confirmed' : 'Submitted',
    priority: 'normal',
    items: priced.items,
    subtotal: priced.subtotal,
    taxAmount: priced.taxAmount,
    serviceChargeAmount: 0,
    discountAmount: 0,
    totalAmount: priced.totalAmount,
    paymentStatus: 'paid',
    remakeCount: 0,
    timeline: [
      {
        status: platformCfg?.autoAcceptOrders ? 'Confirmed' : 'Submitted',
        actorId: actor.id,
        actorName: actor.name,
        note: isSandboxSimulation
          ? `Sandbox adapter test (${platformKey.toUpperCase()} ${payload.externalOrderId})`
          : `Live webhook (${platformKey.toUpperCase()} ${payload.externalOrderId})`,
        timestamp: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  const tickets = splitOrderIntoKitchenTickets(order, snap.stations);
  snap.orders.unshift(order);
  snap.tickets.unshift(...tickets);
  snap.integrationEvents.unshift({
    id: `ie_${crypto.randomUUID().slice(0, 10)}`,
    platform: platformKey,
    eventType: isSandboxSimulation ? 'SANDBOX_ORDER_INGESTED' : 'WEBHOOK_ORDER_INGESTED',
    status: 'ok',
    message: `${platformKey.toUpperCase()} order ${payload.externalOrderId} mapped to internal ${order.orderNumber} (${tickets.length} kitchen ticket(s)).`,
    createdAt: now,
  });

  pushNotification(
    snap,
    ['manager', 'owner', 'kitchen_staff', 'kitchen_supervisor'],
    'urgent',
    `New ${platformKey.toUpperCase()} Order`,
    `${payload.externalOrderId} → ${order.orderNumber} (${snap.settings.currencySymbol}${order.totalAmount.toFixed(2)})`,
    'kitchen'
  );

  appendAudit(snap, actor, 'ONLINE_ORDER_INGESTED', 'order', order.id, undefined, {
    platform: platformKey,
    externalOrderId: payload.externalOrderId,
    sandbox: isSandboxSimulation,
  });
  return { order, tickets };
}

export function createApp(options?: {
  onEvent?: (type: string, payload?: Record<string, unknown>) => void;
}) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const broadcastEvent = (type: string, payload: Record<string, unknown> = {}) => {
    const enriched: Record<string, unknown> = {
      ...payload,
      eventId:
        typeof payload.eventId === 'string'
          ? payload.eventId
          : `evt_${crypto.randomUUID().slice(0, 12)}`,
      timestamp: new Date().toISOString(),
    };
    options?.onEvent?.(type, enriched);
    void emitSupabaseRealtimeBroadcast(enriched);
  };

  const SUPABASE_SETUP_SQL = getFullSupabaseSchemaSql();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, storage: getStorageBackend() });
  });

  app.get('/api/realtime/config', (_req, res) => {
    const sbConfig = getPublicSupabaseRealtimeConfig();
    res.json({
      wsPath: '/ws',
      supabase: sbConfig,
    });
  });

  app.post('/api/realtime/token', async (req, res) => {
    try {
      const resolved = await resolveBearerStaff(req.headers.authorization);
      if (resolved) {
        const jwt = issueScopedRealtimeJwt({
          app_scope: 'staff',
          staff_id: resolved.staff.id,
          staff_role: resolved.staff.role,
        });
        return res.json({
          scope: 'staff',
          token: jwt?.token || null,
          expiresAt: jwt?.expiresAt || null,
        });
      }

      const { qrToken, tableId, sessionId } = (req.body || {}) as {
        qrToken?: string;
        tableId?: string;
        sessionId?: string;
      };
      if (!qrToken && !tableId && !sessionId) {
        return res.status(401).json({ error: 'Authentication or active table QR context is required.' });
      }
      const snap = await getSnapshot();
      const matchedTable = snap.tables.find(
        (t) =>
          !t.isArchived &&
          !t.qrRevoked &&
          ((qrToken && t.qrToken === qrToken) || (tableId && t.id === tableId))
      );
      const matchedSession = sessionId
        ? snap.sessions.find(
            (s) =>
              s.id === sessionId &&
              s.status !== 'closed' &&
              (!matchedTable || s.tableId === matchedTable.id)
          )
        : undefined;
      const resolvedTableId = matchedSession?.tableId || matchedTable?.id;
      if (!resolvedTableId) {
        return res.status(403).json({ error: 'Invalid or expired table QR context.' });
      }

      const jwt = issueScopedRealtimeJwt({
        app_scope: 'customer',
        table_id: resolvedTableId,
        session_id: matchedSession?.id,
      });
      return res.json({
        scope: 'customer',
        tableId: resolvedTableId,
        token: jwt?.token || null,
        expiresAt: jwt?.expiresAt || null,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to issue realtime token.' });
    }
  });

  app.get('/api/setup/supabase-schema', (_req, res) => {
    res.json({ sql: SUPABASE_SETUP_SQL });
  });

  // ---------------- MEDIA STORAGE & SERVING ----------------

  app.post('/api/media/upload', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { dataUrl, category, entityId, fileName } = req.body as {
        dataUrl?: string;
        category?: 'staff' | 'menu_item' | 'logo';
        entityId?: string;
        fileName?: string;
      };
      if (category !== 'staff' && category !== 'menu_item' && category !== 'logo') {
        return res.status(400).json({ error: 'Media category must be staff, menu_item, or logo.' });
      }
      const parsed = parseValidatedDataImage(dataUrl);
      if (!parsed) {
        return res.status(400).json({ error: 'Invalid, unsafe, or oversized image upload (max ~650 KB compressed).' });
      }
      const saved = await saveUploadedMedia({
        category,
        entityId: entityId?.trim().slice(0, 80),
        fileName: fileName?.trim().slice(0, 120),
        mimeType: parsed.mimeType,
        base64Data: parsed.base64Data,
        uploadedByStaffId: req.staff!.id,
      });
      res.status(201).json(saved);
    } catch (err: unknown) {
      if (isSupabaseSchemaMissingError(err)) {
        return res.status(503).json({
          error: 'Supabase media_assets table is not created yet. Run the full SQL schema in Supabase SQL Editor first.',
        });
      }
      if (isSupabaseRlsError(err)) {
        return res.status(503).json({
          error: 'Supabase Row Level Security blocked media upload. Check that SUPABASE_SERVICE_ROLE_KEY uses the service_role secret key.',
        });
      }
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to store uploaded image.' });
    }
  });

  app.get('/api/media/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!/^[a-zA-Z0-9_-]{4,64}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid media ID.' });
      }
      const media = await getUploadedMedia(id);
      if (!media) {
        return res.status(404).json({ error: 'Media asset not found.' });
      }
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.send(media.buffer);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to load media.' });
    }
  });

  // ---------------- AUTH ENDPOINTS ----------------

  app.get('/api/auth/status', async (_req, res) => {
    try {
      const [snap, claimed, fullSchemaReady] = await Promise.all([
        getSnapshot(),
        isAdminClaimed(),
        isFullSupabaseSchemaReady(),
      ]);
      res.json({
        adminClaimed: claimed,
        ownerRegistered: claimed,
        needsSupabaseSchema: false,
        needsFullDatabaseSchema: !fullSchemaReady,
        needsSupabaseServiceRoleKey: isSupabaseAnonKeyConfigured(),
        restaurantName: snap.settings.name,
        logoUrl: snap.settings.logoUrl,
      });
    } catch (err) {
      if (isSupabaseSchemaMissingError(err)) {
        const defaults = createInitialSnapshot();
        return res.json({
          adminClaimed: false,
          ownerRegistered: false,
          needsSupabaseSchema: true,
          needsFullDatabaseSchema: true,
          needsSupabaseServiceRoleKey: isSupabaseAnonKeyConfigured(),
          restaurantName: defaults.settings.name,
          logoUrl: defaults.settings.logoUrl,
        });
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to check auth status.' });
    }
  });

  const handleRegisterOwner = async (req: Request, res: Response) => {
    try {
      if (await isAdminClaimed()) {
        return res.status(409).json({
          error: 'An Owner is already registered for this workspace. Please sign in.',
        });
      }
      const { restaurantName, ownerName, email, mobile, photoUrl, passcode } = req.body as {
        restaurantName?: string;
        ownerName?: string;
        email?: string;
        mobile?: string;
        photoUrl?: string;
        passcode?: string;
      };
      if (!restaurantName || restaurantName.trim().length < 2) {
        return res.status(400).json({ error: 'Restaurant name must be at least 2 characters.' });
      }
      if (!ownerName || ownerName.trim().length < 2) {
        return res.status(400).json({ error: 'Owner full name must be at least 2 characters.' });
      }
      if (!email || !EMAIL_REGEX.test(email.trim())) {
        return res.status(400).json({ error: 'Please enter a valid owner email address.' });
      }
      if (!passcode || passcode.trim().length < 6) {
        return res.status(400).json({ error: 'Passcode must be at least 6 characters.' });
      }

      let resolvedPhotoUrl: string | undefined;
      if (photoUrl !== undefined && String(photoUrl).trim() !== '') {
        const parsedImg = parseValidatedDataImage(photoUrl);
        if (parsedImg) {
          try {
            const stored = await saveUploadedMedia({
              category: 'staff',
              entityId: 'stf_owner',
              mimeType: parsedImg.mimeType,
              base64Data: parsedImg.base64Data,
              uploadedByStaffId: 'stf_owner',
            });
            resolvedPhotoUrl = stored.url;
          } catch {
            const validFallback = validateAppImageUrl(photoUrl);
            if (validFallback) resolvedPhotoUrl = validFallback;
          }
        } else {
          const valid = validateAppImageUrl(photoUrl);
          if (!valid) {
            return res.status(400).json({ error: 'Invalid or oversized Owner profile photo.' });
          }
          resolvedPhotoUrl = valid;
        }
      }

      const registered = await registerInitialOwner({
        restaurantName,
        ownerName,
        email,
        mobile,
        photoUrl: resolvedPhotoUrl,
        passcode,
      });
      if (!registered.ok) {
        return res.status(409).json({ error: 'An Owner is already registered for this workspace.' });
      }
      const token = await createAuthSession(registered.owner.id);
      res.status(201).json({ token, staff: registered.owner });
    } catch (err: unknown) {
      if (isSupabaseSchemaMissingError(err)) {
        return res.status(503).json({
          error: 'Supabase tables are not initialized yet. Run the SQL schema in your Supabase SQL Editor first.',
        });
      }
      if (isSupabaseRlsError(err)) {
        return res.status(503).json({
          error:
            'Supabase Row Level Security blocked this write because SUPABASE_SERVICE_ROLE_KEY is currently set to an anon/publishable key. Replace it with your Supabase service_role (or sb_secret_...) key in Settings -> Secrets and restart.',
        });
      }
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to register owner.' });
    }
  };

  app.post('/api/auth/register-owner', handleRegisterOwner);
  app.post('/api/auth/claim-admin', handleRegisterOwner);

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { identifier, passcode } = req.body as { identifier?: string; passcode?: string };
      if (!identifier || !passcode) {
        return res.status(400).json({ error: 'Email/Employee ID and passcode are required.' });
      }
      const staffId = await verifyStaffCredentials(identifier, passcode);
      if (!staffId) {
        return res.status(401).json({ error: 'Invalid staff credentials or passcode.' });
      }
      const snap = await getSnapshot();
      const staff = snap.staff.find((s) => s.id === staffId);
      if (!staff || staff.status !== 'active') {
        return res.status(403).json({ error: 'This staff account is inactive or on leave.' });
      }
      const token = await createAuthSession(staff.id);
      res.json({ token, staff });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sign-in failed.' });
    }
  });

  app.patch('/api/auth/profile', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { email, name, mobile, photoUrl } = req.body as {
        email?: string;
        name?: string;
        mobile?: string;
        photoUrl?: string;
      };

      let validatedPhoto: string | undefined;
      if (photoUrl !== undefined) {
        if (photoUrl === '') {
          validatedPhoto = '';
        } else {
          const checked = validateAppImageUrl(photoUrl);
          if (!checked) {
            return res.status(400).json({ error: 'Invalid or oversized profile photo.' });
          }
          validatedPhoto = checked;
        }
      }

      const result = await mutateSnapshot((snap) => {
        const target = snap.staff.find((s) => s.id === req.staff!.id);
        if (!target) throw new Error('Staff profile not found.');

        const now = new Date().toISOString();
        let emailChanged = false;
        let oldEmail = target.email;

        if (email !== undefined) {
          const cleanEmail = String(email).trim().toLowerCase();
          if (!EMAIL_REGEX.test(cleanEmail)) {
            throw new Error('Please enter a valid email address.');
          }
          if (cleanEmail !== target.email.toLowerCase()) {
            if (target.role !== 'owner' && !hasPermission(req.staff!.role, 'manage_staff')) {
              throw new Error('Only the Owner or Manager can change an account email ID.');
            }
            const dup = snap.staff.find(
              (s) => s.id !== target.id && s.email.toLowerCase() === cleanEmail
            );
            if (dup) {
              throw new Error('Another staff member already uses this email address.');
            }
            oldEmail = target.email;
            target.email = cleanEmail;
            target.uid = target.id;
            emailChanged = true;
          }
        }

        if (name !== undefined && name.trim()) {
          target.name = name.trim().slice(0, 120);
        }
        if (mobile !== undefined) {
          target.mobile = mobile.trim().slice(0, 32);
        }
        if (validatedPhoto !== undefined) {
          target.photoUrl = validatedPhoto || undefined;
        }
        target.updatedAt = now;

        if (emailChanged) {
          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            target.role === 'owner' ? 'OWNER_EMAIL_UPDATED' : 'STAFF_EMAIL_UPDATED',
            'staff',
            target.id,
            undefined,
            { oldEmail, newEmail: target.email }
          );
        } else {
          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            'PROFILE_UPDATED',
            'staff',
            target.id
          );
        }

        return { staff: target, emailChanged };
      });

      if (result.emailChanged) {
        await updateStaffCredentialEmail(result.staff.id, result.staff.email, result.staff.employeeId);
      }

      broadcastEvent('snapshot:updated', {
        reason: 'staff_profile_updated',
        entity: 'staff',
        action: 'update',
        recordId: result.staff.id,
      });
      res.json({ staff: result.staff });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update profile.' });
    }
  });

  app.post('/api/auth/reset-password', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { targetStaffId, newPasscode } = req.body as { targetStaffId?: string; newPasscode?: string };
      if (!newPasscode || newPasscode.trim().length < 6) {
        return res.status(400).json({ error: 'New passcode must be at least 6 characters.' });
      }
      const targetId = targetStaffId || req.staff!.id;
      if (targetId !== req.staff!.id && !hasPermission(req.staff!.role, 'manage_staff')) {
        return res.status(403).json({
          error: 'Only Managers or Owners can reset another staff member passcode.',
        });
      }
      const snap = await getSnapshot();
      const target = snap.staff.find((s) => s.id === targetId);
      if (!target) return res.status(404).json({ error: 'Staff profile not found.' });
      if (target.role === 'owner' && req.staff!.role !== 'owner') {
        return res.status(403).json({ error: 'Only the Owner can reset the Owner account passcode.' });
      }

      await setStaffPassword(target.id, target.email, target.employeeId, newPasscode.trim());
      await mutateSnapshot((s) => {
        appendAudit(
          s,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'PASSWORD_RESET',
          'staff',
          target.id
        );
      });
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update passcode.' });
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ staff: req.staff });
  });

  app.post('/api/auth/logout', requireAuth, async (req: AuthedRequest, res) => {
    if (req.authToken) await deleteAuthSession(req.authToken);
    res.json({ ok: true });
  });

  // ---------------- PUBLIC CUSTOMER QR PORTAL ----------------

  app.get('/api/public/tables', async (_req, res) => {
    try {
      const snap = await getSnapshot();
      const publicTables = snap.tables
        .filter((t) => !t.isArchived && !t.qrRevoked && t.status !== 'Blocked')
        .map((t) => ({
          id: t.id,
          tableNumber: t.tableNumber,
          capacity: t.capacity,
          floor: t.floor,
          section: t.section,
          status: t.status,
          qrToken: t.qrToken,
        }));
      res.json({ tables: publicTables, settings: sanitizePublicSettings(snap) });
    } catch (err) {
      if (isSupabaseSchemaMissingError(err)) {
        return res.json({
          tables: [],
          settings: sanitizePublicSettings(createInitialSnapshot()),
          needsSupabaseSchema: true,
        });
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to fetch tables.' });
    }
  });

  app.get('/api/public/table/:qrToken', async (req, res) => {
    try {
      const { qrToken } = req.params;
      const sessionIdQuery = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
      const snap = await getSnapshot();
      const table = snap.tables.find((t) => t.qrToken === qrToken && !t.isArchived);
      if (!table) {
        return res.status(404).json({ error: 'Table QR code not recognized or archived.' });
      }
      if (table.qrRevoked) {
        return res.status(410).json({ error: 'This table QR code has been revoked by management.' });
      }
      if (table.status === 'Blocked') {
        return res.status(403).json({ error: `Table ${table.tableNumber} is currently unavailable.` });
      }

      let activeSession: TableSession | null = null;
      if (sessionIdQuery) {
        const hasNewerActiveSession = snap.sessions.some(
          (s) => s.tableId === table.id && s.status !== 'closed' && s.id !== sessionIdQuery
        );
        const found = snap.sessions.find(
          (s) =>
            s.id === sessionIdQuery &&
            s.tableId === table.id &&
            (s.status !== 'closed' || !hasNewerActiveSession)
        );
        if (found) activeSession = found;
      }

      const pendingRequest =
        snap.verifications.find(
          (v) =>
            v.tableId === table.id &&
            (v.status === 'pending' || v.status === 'presence_confirmed') &&
            Date.now() <= new Date(v.expiresAt).getTime()
        ) || null;

      const sessionOrders = activeSession
        ? snap.orders.filter((o) => o.sessionId === activeSession!.id)
        : [];
      const sessionBill = activeSession
        ? snap.bills.find((b) => b.sessionId === activeSession!.id) || null
        : null;
      const serviceRequests = activeSession
        ? snap.serviceRequests.filter((sr) => sr.sessionId === activeSession!.id)
        : [];
      const sessionReview = activeSession
        ? (snap.reviews || []).find((r) => r.sessionId === activeSession!.id) || null
        : null;

      res.json({
        settings: sanitizePublicSettings(snap),
        table: {
          id: table.id,
          tableNumber: table.tableNumber,
          capacity: table.capacity,
          floor: table.floor,
          section: table.section,
          tableType: table.tableType,
          status: table.status,
          qrToken: table.qrToken,
        },
        categories: snap.categories.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
        menuItems: snap.menuItems.filter((m) => m.platformAvailability.dineIn),
        stations: snap.stations.filter((st) => st.isActive),
        activeSession,
        pendingRequest,
        sessionOrders,
        sessionBill,
        serviceRequests,
        sessionReview,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to load table.' });
    }
  });

  app.post('/api/public/verification/request', async (req, res) => {
    try {
      const { qrToken, guestCount, guestLabel } = req.body as {
        qrToken?: string;
        guestCount?: number;
        guestLabel?: string;
      };
      if (!qrToken) return res.status(400).json({ error: 'Table QR token is required.' });

      const preSnap = await getSnapshot();
      const preTable = preSnap.tables.find(
        (t) => t.qrToken === qrToken && !t.isArchived && !t.qrRevoked
      );
      if (!preTable) return res.status(400).json({ error: 'Invalid or inactive table QR code.' });
      if (preTable.status === 'Blocked') {
        return res.status(400).json({ error: `Table ${preTable.tableNumber} is currently blocked.` });
      }

      const reqId = `vr_${crypto.randomUUID().slice(0, 12)}`;
      const issued = await issueOtpForRequest({
        requestId: reqId,
        tableId: preTable.id,
        expirySeconds: preSnap.settings.otpExpirySeconds,
        cooldownSeconds: preSnap.settings.otpResendCooldownSeconds,
        maxAttempts: preSnap.settings.otpMaxAttempts,
        isResend: false,
      });

      if (!issued.ok) {
        return res.status(429).json({ error: issued.error });
      }

      let verification: TableVerificationRequest;
      try {
        verification = await mutateSnapshot((snap) => {
          const table = snap.tables.find(
            (t) => t.qrToken === qrToken && !t.isArchived && !t.qrRevoked
          );
          if (!table) throw new Error('Invalid or inactive table QR code.');
          if (table.status === 'Blocked') throw new Error(`Table ${table.tableNumber} is currently blocked.`);

          const now = new Date().toISOString();
          const entry: TableVerificationRequest = {
            id: reqId,
            tableId: table.id,
            tableNumber: table.tableNumber,
            qrToken: table.qrToken,
            status: 'pending',
            presenceConfirmed: false,
            otpVerified: false,
            waiterId: table.assignedWaiterId,
            guestLabel: guestLabel?.trim().slice(0, 40) || 'Dine-in Guest',
            guestCount: Math.max(1, Math.min(table.capacity + 2, Math.floor(Number(guestCount || 2)))),
            expiresAt: issued.expiresAt,
            createdAt: now,
            updatedAt: now,
          };

          snap.verifications.unshift(entry);
          table.status = 'Verification Pending';
          table.updatedAt = now;

          pushNotification(
            snap,
            ['waiter', 'manager', 'owner', 'shift_supervisor'],
            'urgent',
            `Verification Request: ${table.tableNumber}`,
            `Guests at ${table.tableNumber} (${table.section}) want to start ordering. Confirm physical presence to view OTP.`,
            'waiter',
            'verify',
            table.assignedWaiterId
          );

          appendAudit(
            snap,
            { id: 'guest', name: entry.guestLabel || 'Guest', role: 'customer' },
            'VERIFICATION_REQUESTED',
            'table_verification_request',
            entry.id,
            undefined,
            { tableId: table.id, tableNumber: table.tableNumber }
          );

          return entry;
        });
      } catch (innerErr) {
        await invalidateOtpRequest(reqId);
        throw innerErr;
      }

      broadcastEvent('snapshot:updated', {
        reason: 'verification_requested',
        entity: 'verification',
        action: 'create',
        recordId: verification.id,
        tableId: verification.tableId,
        waiterId: verification.waiterId,
      });
      res.json({ verificationRequest: verification });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to start verification.' });
    }
  });

  app.post('/api/public/verification/resend', async (req, res) => {
    try {
      const { requestId } = req.body as { requestId?: string };
      if (!requestId) return res.status(400).json({ error: 'Verification request ID is required.' });

      const preSnap = await getSnapshot();
      const preVr = preSnap.verifications.find((v) => v.id === requestId);
      if (!preVr) return res.status(404).json({ error: 'Verification request not found.' });
      if (preVr.status === 'verified') return res.status(400).json({ error: 'Session already verified.' });

      const issued = await issueOtpForRequest({
        requestId: preVr.id,
        tableId: preVr.tableId,
        expirySeconds: preSnap.settings.otpExpirySeconds,
        cooldownSeconds: preSnap.settings.otpResendCooldownSeconds,
        maxAttempts: preSnap.settings.otpMaxAttempts,
        isResend: true,
      });

      if (!issued.ok) {
        return res.status(429).json({ error: issued.error });
      }

      const verification = await mutateSnapshot((snap) => {
        const vr = snap.verifications.find((v) => v.id === requestId);
        if (!vr) throw new Error('Verification request not found.');
        if (vr.status === 'verified') throw new Error('Session already verified.');

        vr.expiresAt = issued.expiresAt;
        vr.status = vr.presenceConfirmed ? 'presence_confirmed' : 'pending';
        vr.updatedAt = new Date().toISOString();

        pushNotification(
          snap,
          ['waiter', 'manager'],
          'warning',
          `OTP Resent: ${vr.tableNumber}`,
          `New verification code requested for ${vr.tableNumber}.`,
          'waiter',
          'verify',
          vr.waiterId
        );

        return vr;
      });

      broadcastEvent('snapshot:updated', {
        reason: 'verification_resent',
        entity: 'verification',
        action: 'update',
        recordId: verification.id,
        tableId: verification.tableId,
        waiterId: verification.waiterId,
      });
      res.json({ verificationRequest: verification });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to resend OTP.' });
    }
  });

  app.post('/api/public/verification/verify', async (req, res) => {
    try {
      const { requestId, otp } = req.body as { requestId?: string; otp?: string };
      if (!requestId || !otp) {
        return res.status(400).json({ error: 'Verification ID and OTP code are required.' });
      }

      const snapCurrent = await getSnapshot();
      const vrCheck = snapCurrent.verifications.find((v) => v.id === requestId);
      if (!vrCheck) {
        return res.status(404).json({ error: 'Verification request not found.' });
      }

      const verifyResult = await verifyOtpSubmission(requestId, otp);
      if (!verifyResult.ok) {
        await mutateSnapshot((snap) => {
          const vr = snap.verifications.find((v) => v.id === requestId);
          if (vr && verifyResult.remainingAttempts === 0 && verifyResult.error.includes('expired')) {
            vr.status = 'expired';
            vr.updatedAt = new Date().toISOString();
          }
          appendAudit(
            snap,
            { id: 'guest', name: 'Guest', role: 'customer' },
            'VERIFICATION_FAILED',
            'table_verification_request',
            requestId,
            verifyResult.error,
            { tableId: vrCheck.tableId }
          );
        });
        return res.status(400).json({
          error: verifyResult.error,
          remainingAttempts: verifyResult.remainingAttempts,
        });
      }

      const verifiedData = await mutateSnapshot((snap) => {
        const vr = snap.verifications.find((v) => v.id === requestId)!;
        const table = snap.tables.find((t) => t.id === vr.tableId)!;
        const now = new Date().toISOString();

        let session = snap.sessions.find((s) => s.tableId === table.id && s.status !== 'closed');
        if (!session) {
          session = {
            id: `ses_${crypto.randomUUID().slice(0, 12)}`,
            tableId: table.id,
            tableNumber: table.tableNumber,
            verificationRequestId: vr.id,
            waiterId: vr.waiterId || table.assignedWaiterId,
            status: 'active',
            guestCount: vr.guestCount || 2,
            startedAt: now,
          };
          snap.sessions.unshift(session);
        }

        vr.status = 'verified';
        vr.otpVerified = true;
        vr.sessionId = session.id;
        vr.updatedAt = now;

        table.status = 'Ordering';
        table.updatedAt = now;

        appendAudit(
          snap,
          { id: vr.waiterId || 'waiter', name: vr.waiterName || 'Waiter', role: 'waiter' },
          'TABLE_SESSION_VERIFIED',
          'table_session',
          session.id,
          undefined,
          { tableId: table.id, tableNumber: table.tableNumber, verificationRequestId: vr.id }
        );

        return { session, verification: vr };
      });

      broadcastEvent('snapshot:updated', {
        reason: 'session_verified',
        entity: 'verification',
        action: 'update',
        recordId: verifiedData.verification.id,
        tableId: verifiedData.session.tableId,
        sessionId: verifiedData.session.id,
        waiterId: verifiedData.session.waiterId,
      });
      res.json({
        session: verifiedData.session,
        verificationRequest: verifiedData.verification,
      });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'OTP verification failed.' });
    }
  });

  app.get('/api/public/session/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const snap = await getSnapshot();
      const session = snap.sessions.find((s) => s.id === sessionId);
      if (!session) return res.status(404).json({ error: 'Table session not found.' });
      const orders = snap.orders.filter((o) => o.sessionId === session.id);
      const bill = snap.bills.find((b) => b.sessionId === session.id) || null;
      const payments = bill ? snap.payments.filter((p) => p.billId === bill.id) : [];
      const serviceRequests = snap.serviceRequests.filter((sr) => sr.sessionId === session.id);
      const table = snap.tables.find((t) => t.id === session.tableId);
      const review = (snap.reviews || []).find((r) => r.sessionId === session.id) || null;
      res.json({ session, orders, bill, payments, serviceRequests, table, review });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to fetch session.' });
    }
  });

  app.post('/api/public/orders', async (req, res) => {
    try {
      const { sessionId, qrToken, items } = req.body as {
        sessionId?: string;
        qrToken?: string;
        items?: { menuItemId: string; variantId?: string; quantity: number; modifierIds?: string[]; instructions?: string }[];
      };
      if (!sessionId || !qrToken) {
        return res.status(400).json({ error: 'Verified table session is required before placing an order.' });
      }

      const orderResult = await mutateSnapshot((snap) => {
        const table = snap.tables.find((t) => t.qrToken === qrToken && !t.isArchived && !t.qrRevoked);
        if (!table) throw new Error('Invalid or revoked table QR code.');

        const session = snap.sessions.find(
          (s) => s.id === sessionId && s.tableId === table.id && s.status === 'active'
        );
        if (!session) {
          throw new Error('No active verified table session found. Please verify with your waiter first.');
        }

        const priced = validateAndPriceOrderItems(
          items || [],
          snap.menuItems,
          snap.settings,
          'dine_in_qr'
        );

        const now = new Date().toISOString();
        const orderNum = `ORD-${1042 + snap.orders.length}`;
        const waiter = snap.staff.find((s) => s.id === (session.waiterId || table.assignedWaiterId));

        const order: Order = {
          id: `ord_${crypto.randomUUID().slice(0, 12)}`,
          orderNumber: orderNum,
          channel: 'dine_in_qr',
          tableId: table.id,
          tableNumber: table.tableNumber,
          sessionId: session.id,
          waiterId: waiter?.id || table.assignedWaiterId || session.waiterId,
          waiterName: waiter?.name,
          status: 'Submitted',
          priority: table.tableType === 'vip' ? 'vip' : 'normal',
          items: priced.items,
          subtotal: priced.subtotal,
          taxAmount: priced.taxAmount,
          serviceChargeAmount: priced.serviceChargeAmount,
          discountAmount: priced.discountAmount,
          totalAmount: priced.totalAmount,
          paymentStatus: 'unpaid',
          remakeCount: 0,
          timeline: [
            {
              status: 'Submitted',
              actorId: 'guest',
              actorName: `Table ${table.tableNumber} Guest`,
              note: waiter
                ? `Awaiting confirmation by assigned waiter ${waiter.name}`
                : 'Awaiting waiter confirmation before kitchen dispatch',
              timestamp: now,
            },
          ],
          createdAt: now,
          updatedAt: now,
        };

        // Request A: Table QR orders await assigned waiter confirmation before creating KitchenTickets
        snap.orders.unshift(order);
        table.status = 'Order Active';
        table.updatedAt = now;

        pushNotification(
          snap,
          ['waiter', 'shift_supervisor', 'manager', 'owner'],
          'urgent',
          `Confirm Order ${order.orderNumber}: ${table.tableNumber}`,
          `${table.tableNumber} placed ${order.items.length} item(s) (${snap.settings.currencySymbol}${order.totalAmount.toFixed(2)}). Confirm to send to kitchen.`,
          'waiter',
          'tables',
          order.waiterId
        );

        appendAudit(
          snap,
          { id: 'guest', name: `Table ${table.tableNumber} Guest`, role: 'customer' },
          'ORDER_SUBMITTED_QR_AWAITING_WAITER',
          'order',
          order.id,
          undefined,
          { tableId: table.id, sessionId: session.id, waiterId: order.waiterId || null, totalAmount: order.totalAmount }
        );

        return { order, tickets: [] as typeof snap.tickets };
      });

      broadcastEvent('snapshot:updated', {
        reason: 'order_submitted_for_confirmation',
        entity: 'order',
        action: 'create',
        recordId: orderResult.order.id,
        tableId: orderResult.order.tableId,
        sessionId: orderResult.order.sessionId,
        waiterId: orderResult.order.waiterId,
        channel: orderResult.order.channel,
      });
      res.status(201).json(orderResult);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to submit order.' });
    }
  });

  app.post('/api/public/service-requests', async (req, res) => {
    try {
      const { tableId, sessionId, requestType, notes } = req.body as {
        tableId?: string;
        sessionId?: string;
        requestType?: CustomerServiceRequest['requestType'];
        notes?: string;
      };
      if (!tableId || !requestType) {
        return res.status(400).json({ error: 'Table and request type are required.' });
      }

      const created = await mutateSnapshot((snap) => {
        const table = snap.tables.find((t) => t.id === tableId && !t.isArchived);
        if (!table) throw new Error('Table not found.');

        const cooldownMs = snap.settings.serviceRequestCooldownSeconds * 1000;
        const duplicate = snap.serviceRequests.find(
          (sr) =>
            sr.tableId === tableId &&
            sr.requestType === requestType &&
            sr.status !== 'Completed' &&
            Date.now() - new Date(sr.createdAt).getTime() < cooldownMs
        );
        if (duplicate) {
          throw new Error(`A "${requestType}" request was just sent. Please wait a few seconds.`);
        }

        const now = new Date().toISOString();
        const sr: CustomerServiceRequest = {
          id: `sr_${crypto.randomUUID().slice(0, 12)}`,
          tableId: table.id,
          tableNumber: table.tableNumber,
          sessionId,
          waiterId: table.assignedWaiterId,
          requestType,
          status: 'New',
          notes: notes?.trim().slice(0, 200),
          createdAt: now,
          updatedAt: now,
        };
        snap.serviceRequests.unshift(sr);

        if (requestType === 'Bill') {
          table.status = 'Bill Requested';
          table.updatedAt = now;
          const ses = snap.sessions.find((s) => s.id === sessionId);
          if (ses && ses.status === 'active') ses.status = 'bill_requested';
        }

        pushNotification(
          snap,
          ['waiter', 'manager'],
          requestType === 'Bill' || requestType === 'Help' ? 'urgent' : 'info',
          `${requestType}: ${table.tableNumber}`,
          notes ? `${table.tableNumber} requested ${requestType}: "${notes}"` : `${table.tableNumber} requested ${requestType}.`,
          'waiter',
          'service',
          table.assignedWaiterId
        );

        return sr;
      });

      broadcastEvent('snapshot:updated', {
        reason: 'service_request_created',
        entity: 'service_request',
        action: 'create',
        recordId: created.id,
        tableId: created.tableId,
        sessionId: created.sessionId,
        waiterId: created.waiterId,
      });
      res.status(201).json({ serviceRequest: created });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to send request.' });
    }
  });

  app.post('/api/public/bills/generate', async (req, res) => {
    try {
      const { sessionId } = req.body as { sessionId?: string };
      if (!sessionId) return res.status(400).json({ error: 'Session ID is required.' });
      const bill = await mutateSnapshot((snap) => {
        const session = snap.sessions.find((s) => s.id === sessionId);
        if (!session) throw new Error('Session not found.');
        const sessionOrders = snap.orders.filter((o) => o.sessionId === session.id);
        if (sessionOrders.length === 0) throw new Error('No orders placed in this session yet.');

        const existingIdx = snap.bills.findIndex((b) => b.sessionId === session.id);
        const existing = existingIdx >= 0 ? snap.bills[existingIdx] : null;
        const consolidated = consolidateSessionOrdersToBill(
          session.id,
          session.tableId,
          session.tableNumber,
          sessionOrders,
          existing,
          `INV-${1001 + snap.bills.length}`
        );
        if (existingIdx >= 0) {
          snap.bills[existingIdx] = consolidated;
        } else {
          snap.bills.unshift(consolidated);
        }
        const table = snap.tables.find((t) => t.id === session.tableId);
        if (table && consolidated.status !== 'paid') {
          table.status = 'Bill Requested';
          table.updatedAt = new Date().toISOString();
        }
        return consolidated;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'bill_generated',
        entity: 'bill',
        action: 'create',
        recordId: bill.id,
        tableId: bill.tableId,
        sessionId: bill.sessionId,
      });
      res.json({ bill });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to generate bill.' });
    }
  });

  app.post('/api/public/payments', async (req, res) => {
    try {
      const { billId, amount, method, reference } = req.body as {
        billId?: string;
        amount?: number;
        method?: PaymentMethod;
        reference?: string;
      };
      if (!billId || !amount || !method) {
        return res.status(400).json({ error: 'Bill, amount, and payment method are required.' });
      }
      if (method === 'cash') {
        return res.status(403).json({ error: 'Cash payments must be recorded by your waiter or cashier.' });
      }

      const result = await mutateSnapshot((snap) => {
        const idx = snap.bills.findIndex((b) => b.id === billId);
        if (idx < 0) throw new Error('Bill not found.');
        const bill = snap.bills[idx];
        const billPayments = snap.payments.filter((p) => p.billId === bill.id);
        const { updatedBill, isFullyPaid } = applyPaymentToBill(bill, Number(amount), billPayments);

        const payment: PaymentRecord = {
          id: `pay_${crypto.randomUUID().slice(0, 12)}`,
          billId: bill.id,
          billNumber: bill.billNumber,
          sessionId: bill.sessionId,
          tableNumber: bill.tableNumber,
          amount: Number(amount),
          method,
          reference: reference?.trim().slice(0, 64) || `${method.toUpperCase()}-SELF-${Date.now().toString().slice(-5)}`,
          recordedById: 'guest',
          recordedByName: `Table ${bill.tableNumber} Guest`,
          createdAt: new Date().toISOString(),
        };

        snap.bills[idx] = updatedBill;
        snap.payments.unshift(payment);

        if (isFullyPaid) {
          const session = snap.sessions.find((s) => s.id === bill.sessionId);
          if (session) {
            session.status = 'closed';
            session.closedAt = new Date().toISOString();
          }
          const table = snap.tables.find((t) => t.id === bill.tableId);
          if (table) {
            table.status = 'Cleaning';
            table.updatedAt = new Date().toISOString();
          }
          for (const o of snap.orders) {
            if (o.sessionId === bill.sessionId) {
              o.paymentStatus = 'paid';
              if (o.status === 'Served' || o.status === 'Ready') {
                o.status = 'Completed';
              }
            }
          }
        }
        appendAudit(
          snap,
          { id: 'guest', name: `Table ${bill.tableNumber} Guest`, role: 'customer' },
          'CUSTOMER_PAYMENT_RECORDED',
          'bill',
          bill.id,
          undefined,
          { amount: payment.amount, method }
        );
        return { bill: updatedBill, payment };
      });

      broadcastEvent('snapshot:updated', {
        reason: 'payment_recorded',
        entity: 'payment',
        action: 'create',
        recordId: result.payment.id,
        tableId: result.bill.tableId,
        sessionId: result.bill.sessionId,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Payment failed.' });
    }
  });

  app.post('/api/public/reviews', async (req, res) => {
    try {
      const { sessionId, qrToken, customerName, overallRating, foodRating, serviceRating, comment } =
        req.body as {
          sessionId?: string;
          qrToken?: string;
          customerName?: string;
          overallRating?: number;
          foodRating?: number;
          serviceRating?: number;
          comment?: string;
        };
      if (!sessionId && !qrToken) {
        return res.status(400).json({ error: 'Table QR token or dining session ID is required.' });
      }

      const clamp = (val: unknown) => {
        const n = Number(val);
        return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 5;
      };

      const review = await mutateSnapshot((snap) => {
        snap.reviews ||= [];
        const session = sessionId ? snap.sessions.find((s) => s.id === sessionId) : undefined;
        const table = session
          ? snap.tables.find((t) => t.id === session.tableId)
          : qrToken
          ? snap.tables.find((t) => t.qrToken === qrToken && !t.isArchived)
          : undefined;

        if (!session && !table) {
          throw new Error('Table or dining session not found.');
        }

        if (session && snap.reviews.some((r) => r.sessionId === session.id)) {
          throw new Error('Feedback has already been submitted for this dining session.');
        }

        const tableNumber = session?.tableNumber || table?.tableNumber || 'Counter';
        const resolvedTableId = session?.tableId || table?.id;
        const verification = session
          ? snap.verifications.find((v) => v.sessionId === session.id)
          : undefined;
        const cleanCustomerName =
          customerName?.trim().slice(0, 80) ||
          verification?.guestLabel?.trim().slice(0, 80) ||
          undefined;

        const entry = {
          id: `rev_${crypto.randomUUID().slice(0, 12)}`,
          sessionId: session?.id,
          tableId: resolvedTableId,
          tableNumber,
          customerName: cleanCustomerName,
          overallRating: clamp(overallRating),
          foodRating: clamp(foodRating),
          serviceRating: clamp(serviceRating),
          comment: comment?.trim().slice(0, 500) || undefined,
          createdAt: new Date().toISOString(),
        };
        snap.reviews.unshift(entry);

        pushNotification(
          snap,
          ['owner', 'manager'],
          entry.overallRating <= 2 ? 'warning' : 'success',
          `New ${entry.overallRating}★ Guest Review · Table ${tableNumber}`,
          entry.comment ||
            `Overall ${entry.overallRating}/5 · Food ${entry.foodRating}/5 · Service ${entry.serviceRating}/5`,
          'manager',
          'reviews'
        );

        appendAudit(
          snap,
          { id: 'guest', name: cleanCustomerName || `Table ${tableNumber} Guest`, role: 'customer' },
          'REVIEW_SUBMITTED',
          'review',
          entry.id,
          undefined,
          { tableNumber, overallRating: entry.overallRating, foodRating: entry.foodRating, serviceRating: entry.serviceRating }
        );

        return entry;
      });

      broadcastEvent('snapshot:updated', {
        reason: 'review_submitted',
        entity: 'review',
        action: 'create',
        recordId: review.id,
        tableId: review.tableId,
        sessionId: review.sessionId,
      });
      res.status(201).json({ review });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to save review.' });
    }
  });

  app.post('/api/reviews/:id/reply', requireAuth, requirePerm('manage_reviews'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const { reply } = req.body as { reply?: string };
      const cleanReply = reply?.trim().slice(0, 500);
      if (!cleanReply) {
        return res.status(400).json({ error: 'Reply message is required.' });
      }

      const updated = await mutateSnapshot((snap) => {
        snap.reviews ||= [];
        const idx = snap.reviews.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error('Review not found.');
        const existing = snap.reviews[idx];
        const next = {
          ...existing,
          managerReply: cleanReply,
          repliedBy: req.staff!.name,
          repliedAt: new Date().toISOString(),
        };
        snap.reviews[idx] = next;
        appendAudit(
          snap,
          req.staff!,
          'REVIEW_REPLIED',
          'review',
          next.id,
          undefined,
          { tableNumber: next.tableNumber }
        );
        return next;
      });

      broadcastEvent('snapshot:updated', {
        reason: 'review_replied',
        entity: 'review',
        action: 'update',
        recordId: updated.id,
        tableId: updated.tableId,
      });
      res.json({ review: updated });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to save review reply.' });
    }
  });

  app.delete('/api/reviews/:id', requireAuth, requirePerm('manage_reviews'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      await mutateSnapshot((snap) => {
        snap.reviews ||= [];
        const idx = snap.reviews.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error('Review not found.');
        const [removed] = snap.reviews.splice(idx, 1);
        appendAudit(
          snap,
          req.staff!,
          'REVIEW_DELETED',
          'review',
          id,
          undefined,
          { tableNumber: removed.tableNumber }
        );
      });

      broadcastEvent('snapshot:updated', {
        reason: 'review_deleted',
        entity: 'review',
        action: 'delete',
        recordId: id,
      });
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to delete review.' });
    }
  });

  // ---------------- PROTECTED STAFF / MANAGER / WAITER / KITCHEN ENDPOINTS ----------------

  app.get('/api/snapshot', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const snap = await getSnapshot();
      res.json(sanitizeSnapshotForRole(snap, req.staff!));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load workspace snapshot.' });
    }
  });

  // Tables CRUD + Permanent QR
  app.post('/api/tables', requireAuth, requirePerm('manage_tables'), async (req: AuthedRequest, res) => {
    try {
      const { tableNumber, capacity, floor, section, tableType, assignedWaiterId, status, notes } =
        req.body as {
          tableNumber?: string;
          capacity?: number;
          floor?: string;
          section?: string;
          tableType?: RestaurantTable['tableType'];
          assignedWaiterId?: string;
          status?: TableStatus;
          notes?: string;
        };
      if (!tableNumber || !tableNumber.trim()) {
        return res.status(400).json({ error: 'Table number or name is required.' });
      }

      const table = await mutateSnapshot((snap) => {
        const cleanNum = tableNumber.trim();
        if (snap.tables.some((t) => !t.isArchived && t.tableNumber.toLowerCase() === cleanNum.toLowerCase())) {
          throw new Error(`Table "${cleanNum}" already exists.`);
        }
        const now = new Date().toISOString();
        const created: RestaurantTable = {
          id: `tbl_${crypto.randomUUID().slice(0, 12)}`,
          tableNumber: cleanNum,
          capacity: Math.max(1, Math.min(30, Math.floor(Number(capacity || 4)))),
          floor: floor?.trim() || snap.settings.floors[0] || 'Ground Floor',
          section: section?.trim() || snap.settings.sections[0] || 'Main Hall',
          tableType: tableType || 'regular',
          assignedWaiterId: assignedWaiterId || undefined,
          status: status || 'Available',
          qrToken: generatePermanentQrToken(),
          qrRevoked: false,
          isArchived: false,
          notes: notes?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };
        snap.tables.push(created);

        if (created.assignedWaiterId) {
          const waiter = snap.staff.find((s) => s.id === created.assignedWaiterId);
          if (waiter && !waiter.assignedTableIds.includes(created.id)) {
            waiter.assignedTableIds.push(created.id);
          }
        }

        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'TABLE_CREATED',
          'restaurant_table',
          created.id,
          undefined,
          { tableNumber: created.tableNumber, qrToken: created.qrToken }
        );
        return created;
      });

      broadcastEvent('snapshot:updated', {
        reason: 'table_created',
        entity: 'table',
        action: 'create',
        recordId: table.id,
        tableId: table.id,
        waiterId: table.assignedWaiterId,
      });
      res.status(201).json({ table });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create table.' });
    }
  });

  app.patch('/api/tables/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const isManager = hasPermission(req.staff!.role, 'manage_tables');
      const isWaiter = hasPermission(req.staff!.role, 'serve_food');
      if (!isManager && !isWaiter) {
        return res.status(403).json({ error: 'Insufficient permissions to update table.' });
      }

      const updated = await mutateSnapshot((snap) => {
        const table = snap.tables.find((t) => t.id === id);
        if (!table) throw new Error('Table not found.');
        if (
          !isManager &&
          !hasPermission(req.staff!.role, 'view_all_tables') &&
          table.assignedWaiterId !== req.staff!.id &&
          table.assignedWaiterId !== req.staff!.uid &&
          !req.staff!.assignedTableIds.includes(table.id)
        ) {
          throw new Error('Forbidden: you are not assigned to this table.');
        }
        const originalQrToken = table.qrToken;
        const now = new Date().toISOString();

        const body = req.body as Partial<RestaurantTable>;
        if (isManager) {
          if (body.tableNumber !== undefined && body.tableNumber.trim()) {
            const dup = snap.tables.find(
              (t) =>
                t.id !== id &&
                !t.isArchived &&
                t.tableNumber.toLowerCase() === body.tableNumber!.trim().toLowerCase()
            );
            if (dup) throw new Error(`Table number "${body.tableNumber}" already exists.`);
            table.tableNumber = body.tableNumber.trim();
          }
          if (body.capacity !== undefined) table.capacity = Math.max(1, Math.min(30, Number(body.capacity)));
          if (body.floor !== undefined) table.floor = body.floor;
          if (body.section !== undefined) table.section = body.section;
          if (body.tableType !== undefined) table.tableType = body.tableType;
          if (body.assignedWaiterId !== undefined) {
            for (const st of snap.staff) {
              st.assignedTableIds = st.assignedTableIds.filter((tid) => tid !== table.id);
            }
            table.assignedWaiterId = body.assignedWaiterId || undefined;
            if (table.assignedWaiterId) {
              const w = snap.staff.find((s) => s.id === table.assignedWaiterId);
              if (w && !w.assignedTableIds.includes(table.id)) w.assignedTableIds.push(table.id);
            }
          }
          if (body.notes !== undefined) table.notes = body.notes;
          if (body.isArchived !== undefined) table.isArchived = Boolean(body.isArchived);
        }

        if (body.status !== undefined) {
          table.status = body.status;
        }

        table.qrToken = originalQrToken;
        table.updatedAt = now;

        for (const s of snap.sessions) {
          if (s.tableId === table.id) s.tableNumber = table.tableNumber;
        }

        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'TABLE_UPDATED',
          'restaurant_table',
          table.id,
          undefined,
          { tableNumber: table.tableNumber, status: table.status, qrPreserved: true }
        );
        return table;
      });

      broadcastEvent('snapshot:updated', {
        reason: 'table_updated',
        entity: 'table',
        action: 'update',
        recordId: updated.id,
        tableId: updated.id,
        waiterId: updated.assignedWaiterId,
      });
      res.json({ table: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update table.';
      res.status(msg.startsWith('Forbidden:') ? 403 : 400).json({ error: msg });
    }
  });

  app.post('/api/tables/:id/revoke-qr', requireAuth, requirePerm('revoke_qr'), async (req: AuthedRequest, res) => {
    try {
      const { reason } = req.body as { reason?: string };
      if (!reason || reason.trim().length < 4) {
        return res.status(400).json({ error: 'A written reason is required to revoke a permanent QR token.' });
      }
      const updated = await mutateSnapshot((snap) => {
        const table = snap.tables.find((t) => t.id === req.params.id);
        if (!table) throw new Error('Table not found.');
        const oldToken = table.qrToken;
        table.qrToken = generatePermanentQrToken();
        table.qrRevoked = false;
        table.updatedAt = new Date().toISOString();
        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'QR_TOKEN_REVOKED_AND_ROTATED',
          'restaurant_table',
          table.id,
          reason.trim(),
          { oldTokenPrefix: oldToken.slice(0, 10), newTokenPrefix: table.qrToken.slice(0, 10) }
        );
        return table;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'qr_revoked',
        entity: 'table',
        action: 'update',
        recordId: updated.id,
        tableId: updated.id,
      });
      res.json({ table: updated });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to revoke QR.' });
    }
  });

  app.post('/api/tables/:id/move-session', requireAuth, requirePerm('serve_food'), async (req: AuthedRequest, res) => {
    try {
      const { targetTableId } = req.body as { targetTableId?: string };
      if (!targetTableId) return res.status(400).json({ error: 'Target table is required.' });
      const moved = await mutateSnapshot((snap) => {
        const src = snap.tables.find((t) => t.id === req.params.id);
        const dst = snap.tables.find((t) => t.id === targetTableId && !t.isArchived && t.status !== 'Blocked');
        if (!src || !dst) throw new Error('Source or target table not available.');
        const activeSession = snap.sessions.find((s) => s.tableId === src.id && s.status !== 'closed');
        if (!activeSession) throw new Error(`No active session on ${src.tableNumber} to move.`);
        if (snap.sessions.some((s) => s.tableId === dst.id && s.status !== 'closed')) {
          throw new Error(`Target table ${dst.tableNumber} already has an active session.`);
        }

        activeSession.tableId = dst.id;
        activeSession.tableNumber = dst.tableNumber;
        for (const o of snap.orders) {
          if (o.sessionId === activeSession.id) {
            o.tableId = dst.id;
            o.tableNumber = dst.tableNumber;
          }
        }
        for (const tk of snap.tickets) {
          if (snap.orders.some((o) => o.id === tk.orderId && o.sessionId === activeSession.id)) {
            tk.tableNumber = dst.tableNumber;
          }
        }
        for (const b of snap.bills) {
          if (b.sessionId === activeSession.id) {
            b.tableId = dst.id;
            b.tableNumber = dst.tableNumber;
          }
        }
        dst.status = src.status;
        src.status = 'Cleaning';
        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'SESSION_MOVED',
          'table_session',
          activeSession.id,
          undefined,
          { fromTable: src.tableNumber, toTable: dst.tableNumber }
        );
        return { sessionId: activeSession.id, dstTableId: dst.id };
      });
      broadcastEvent('snapshot:updated', {
        reason: 'session_moved',
        entity: 'session',
        action: 'update',
        recordId: moved.sessionId,
        tableId: moved.dstTableId,
        sessionId: moved.sessionId,
      });
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to move session.' });
    }
  });

  app.delete('/api/tables/:id', requireAuth, requirePerm('manage_tables'), async (req: AuthedRequest, res) => {
    try {
      const result = await mutateSnapshot((snap) => {
        const idx = snap.tables.findIndex((t) => t.id === req.params.id);
        if (idx < 0) throw new Error('Table not found.');
        const table = snap.tables[idx];
        const check = canDeleteTable(table, snap.sessions, snap.orders, snap.bills);
        if (!check.allowed) {
          return { blocked: true as const, reason: check.reason };
        }
        snap.tables.splice(idx, 1);
        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'TABLE_DELETED',
          'restaurant_table',
          table.id,
          'Clean table without historical sessions/orders/bills',
          { tableNumber: table.tableNumber }
        );
        return { blocked: false as const, tableId: table.id };
      });

      if (result.blocked) {
        return res.status(409).json({ error: result.reason });
      }
      broadcastEvent('snapshot:updated', {
        reason: 'table_deleted',
        entity: 'table',
        action: 'delete',
        recordId: result.tableId,
        tableId: result.tableId,
      });
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Delete failed.' });
    }
  });

  // Waiter Verification Presence Confirmation & OTP Reveal
  app.post(
    '/api/verifications/:id/confirm-presence',
    requireAuth,
    requirePerm('verify_customer_presence'),
    async (req: AuthedRequest, res) => {
      try {
        const id = String(req.params.id);
        const revealed = await confirmPresenceAndRevealOtp(id, req.staff!.id);
        if (!revealed.ok) {
          return res.status(400).json({ error: revealed.error });
        }

        const vr = await mutateSnapshot((snap) => {
          const entry = snap.verifications.find((v) => v.id === id);
          if (!entry) throw new Error('Verification request not found.');
          entry.presenceConfirmed = true;
          entry.status = 'presence_confirmed';
          entry.waiterId = req.staff!.id;
          entry.waiterName = req.staff!.name;
          entry.updatedAt = new Date().toISOString();

          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            'WAITER_CONFIRMED_PRESENCE',
            'table_verification_request',
            entry.id,
            undefined,
            { tableId: entry.tableId, tableNumber: entry.tableNumber }
          );
          return entry;
        });

        broadcastEvent('snapshot:updated', {
          reason: 'presence_confirmed',
          entity: 'verification',
          action: 'update',
          recordId: vr.id,
          tableId: vr.tableId,
          waiterId: vr.waiterId,
        });
        res.json({ verificationRequest: vr, otp: revealed.otp, expiresAt: revealed.expiresAt });
      } catch (err: unknown) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to confirm presence.' });
      }
    }
  );

  app.post(
    '/api/verifications/:id/reject',
    requireAuth,
    requirePerm('verify_customer_presence'),
    async (req: AuthedRequest, res) => {
      try {
        const id = String(req.params.id);
        const { reason } = req.body as { reason?: string };
        await invalidateOtpRequest(id);
        const vr = await mutateSnapshot((snap) => {
          const entry = snap.verifications.find((v) => v.id === id);
          if (!entry) throw new Error('Verification request not found.');
          entry.status = 'rejected';
          entry.reason = reason?.trim() || 'Guest not present at table';
          entry.waiterId = req.staff!.id;
          entry.waiterName = req.staff!.name;
          entry.updatedAt = new Date().toISOString();

          const table = snap.tables.find((t) => t.id === entry.tableId);
          if (table && table.status === 'Verification Pending') {
            table.status = 'Available';
            table.updatedAt = entry.updatedAt;
          }

          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            'VERIFICATION_REJECTED',
            'table_verification_request',
            entry.id,
            entry.reason,
            { tableNumber: entry.tableNumber }
          );
          return entry;
        });
        broadcastEvent('snapshot:updated', {
          reason: 'verification_rejected',
          entity: 'verification',
          action: 'update',
          recordId: vr.id,
          tableId: vr.tableId,
          waiterId: vr.waiterId,
        });
        res.json({ verificationRequest: vr });
      } catch (err: unknown) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to reject verification.' });
      }
    }
  );

  // Service Requests
  app.patch(
    '/api/service-requests/:id',
    requireAuth,
    requirePerm('handle_service_requests'),
    async (req: AuthedRequest, res) => {
      try {
        const { status, notes } = req.body as {
          status?: CustomerServiceRequest['status'];
          notes?: string;
        };
        const updated = await mutateSnapshot((snap) => {
          const sr = snap.serviceRequests.find((s) => s.id === req.params.id);
          if (!sr) throw new Error('Service request not found.');
          if (
            !hasPermission(req.staff!.role, 'view_all_tables') &&
            sr.waiterId &&
            sr.waiterId !== req.staff!.id &&
            sr.waiterId !== req.staff!.uid &&
            !req.staff!.assignedTableIds.includes(sr.tableId)
          ) {
            throw new Error('Forbidden: this service request belongs to another waiter table.');
          }
          if (status) sr.status = status;
          if (notes !== undefined) sr.notes = notes;
          sr.waiterId = req.staff!.id;
          sr.updatedAt = new Date().toISOString();
          return sr;
        });
        broadcastEvent('snapshot:updated', {
          reason: 'service_request_updated',
          entity: 'service_request',
          action: 'update',
          recordId: updated.id,
          tableId: updated.tableId,
          sessionId: updated.sessionId,
          waiterId: updated.waiterId,
        });
        res.json({ serviceRequest: updated });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to update service request.';
        res.status(msg.startsWith('Forbidden:') ? 403 : 400).json({ error: msg });
      }
    }
  );

  // Waiter & Manager Orders
  app.post('/api/orders', requireAuth, requirePerm('place_waiter_order'), async (req: AuthedRequest, res) => {
    try {
      const { tableId, channel, items, priority, notes } = req.body as {
        tableId?: string;
        channel?: OrderChannel;
        items?: { menuItemId: string; variantId?: string; quantity: number; modifierIds?: string[]; instructions?: string }[];
        priority?: OrderPriority;
        notes?: string;
      };
      const resolvedChannel: OrderChannel = channel || 'waiter';

      const created = await mutateSnapshot((snap) => {
        const table = tableId ? snap.tables.find((t) => t.id === tableId && !t.isArchived) : undefined;
        if ((resolvedChannel === 'waiter' || resolvedChannel === 'dine_in_qr') && !table) {
          throw new Error('Table selection is required for dine-in waiter orders.');
        }
        if (
          table &&
          req.staff!.role === 'waiter' &&
          !hasPermission(req.staff!.role, 'view_all_tables') &&
          table.assignedWaiterId !== req.staff!.id &&
          table.assignedWaiterId !== req.staff!.uid &&
          !req.staff!.assignedTableIds.includes(table.id)
        ) {
          throw new Error('Forbidden: only the waiter assigned to this table (or a manager) can place orders here.');
        }

        const now = new Date().toISOString();
        let session: TableSession | undefined;
        if (table) {
          session = snap.sessions.find((s) => s.tableId === table.id && s.status !== 'closed');
          if (!session) {
            session = {
              id: `ses_${crypto.randomUUID().slice(0, 12)}`,
              tableId: table.id,
              tableNumber: table.tableNumber,
              waiterId: req.staff!.id,
              status: 'active',
              guestCount: Math.min(table.capacity, 2),
              startedAt: now,
            };
            snap.sessions.unshift(session);
          }
        }

        const priced = validateAndPriceOrderItems(items || [], snap.menuItems, snap.settings, resolvedChannel);
        const order: Order = {
          id: `ord_${crypto.randomUUID().slice(0, 12)}`,
          orderNumber: `ORD-${1042 + snap.orders.length}`,
          channel: resolvedChannel,
          tableId: table?.id,
          tableNumber: table?.tableNumber,
          sessionId: session?.id,
          waiterId: req.staff!.id,
          waiterName: req.staff!.name,
          status: 'Confirmed',
          priority: priority || (table?.tableType === 'vip' ? 'vip' : 'normal'),
          items: priced.items,
          subtotal: priced.subtotal,
          taxAmount: priced.taxAmount,
          serviceChargeAmount: priced.serviceChargeAmount,
          discountAmount: priced.discountAmount,
          totalAmount: priced.totalAmount,
          paymentStatus: 'unpaid',
          packagingNotes: notes,
          remakeCount: 0,
          timeline: [{ status: 'Confirmed', actorId: req.staff!.id, actorName: req.staff!.name, timestamp: now }],
          createdAt: now,
          updatedAt: now,
        };

        const tickets = splitOrderIntoKitchenTickets(order, snap.stations);
        snap.orders.unshift(order);
        snap.tickets.unshift(...tickets);
        if (table) {
          table.status = 'Order Active';
          table.updatedAt = now;
        }

        pushNotification(
          snap,
          ['kitchen_staff', 'kitchen_supervisor', 'manager'],
          'info',
          `New ${resolvedChannel === 'waiter' ? 'Waiter' : resolvedChannel} Order ${order.orderNumber}`,
          `${table ? table.tableNumber : 'Takeaway'} • ${order.items.length} items routed to kitchen.`,
          'kitchen'
        );

        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'ORDER_CREATED_STAFF',
          'order',
          order.id,
          undefined,
          { channel: resolvedChannel, totalAmount: order.totalAmount }
        );
        return { order, tickets };
      });

      broadcastEvent('snapshot:updated', {
        reason: 'staff_order_created',
        entity: 'order',
        action: 'create',
        recordId: created.order.id,
        tableId: created.order.tableId,
        sessionId: created.order.sessionId,
        waiterId: created.order.waiterId,
        channel: created.order.channel,
      });
      res.status(201).json(created);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to create order.';
      res.status(msg.startsWith('Forbidden:') ? 403 : 400).json({ error: msg });
    }
  });

  app.post('/api/orders/:id/confirm', requireAuth, requirePerm('confirm_table_order'), async (req: AuthedRequest, res) => {
    try {
      const result = await mutateSnapshot((snap) => {
        const order = snap.orders.find((o) => o.id === req.params.id);
        if (!order) {
          return { statusCode: 404 as const, error: 'Order not found.' };
        }
        const table = order.tableId ? snap.tables.find((t) => t.id === order.tableId) : undefined;
        const session = order.sessionId ? snap.sessions.find((s) => s.id === order.sessionId) : undefined;
        const authCheck = canStaffConfirmTableOrder(order, table, session, req.staff!);
        if (!authCheck.allowed) {
          const isRoleOrAssignment =
            authCheck.reason?.includes('assigned to this table') ||
            authCheck.reason?.includes('cannot confirm');
          return {
            statusCode: (isRoleOrAssignment ? 403 : 400) as 403 | 400,
            error: authCheck.reason || 'Unable to confirm order.',
          };
        }

        const now = new Date().toISOString();
        order.status = 'Confirmed';
        if (!order.waiterId) {
          order.waiterId = req.staff!.id;
          order.waiterName = req.staff!.name;
        }
        order.timeline.push({
          status: 'Confirmed',
          actorId: req.staff!.id,
          actorName: req.staff!.name,
          note: `Confirmed by ${req.staff!.name} and dispatched to kitchen`,
          timestamp: now,
        });
        order.updatedAt = now;

        const existingTickets = snap.tickets.filter((t) => t.orderId === order.id);
        const createdTickets =
          existingTickets.length > 0 ? existingTickets : splitOrderIntoKitchenTickets(order, snap.stations);
        if (existingTickets.length === 0) {
          snap.tickets.unshift(...createdTickets);
        }

        if (table) {
          table.status = 'Order Active';
          table.updatedAt = now;
        }

        pushNotification(
          snap,
          ['kitchen_staff', 'kitchen_supervisor', 'manager', 'owner'],
          'urgent',
          `Confirmed Order ${order.orderNumber}`,
          `${order.tableNumber || order.channel} confirmed by ${req.staff!.name} • ${createdTickets.length} kitchen ticket(s).`,
          'kitchen'
        );

        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'ORDER_CONFIRMED_TO_KITCHEN',
          'order',
          order.id,
          undefined,
          { tableId: order.tableId || null, ticketsCreated: createdTickets.length }
        );

        return { statusCode: 200 as const, order, tickets: createdTickets };
      });

      if (result.statusCode !== 200) {
        return res.status(result.statusCode).json({ error: result.error });
      }

      broadcastEvent('snapshot:updated', {
        reason: 'order_confirmed',
        entity: 'order',
        action: 'update',
        recordId: result.order.id,
        tableId: result.order.tableId,
        sessionId: result.order.sessionId,
        waiterId: result.order.waiterId,
        channel: result.order.channel,
      });
      res.json({ order: result.order, tickets: result.tickets });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to confirm order.' });
    }
  });

  app.patch('/api/orders/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { status, priority, cancellationReason, refireReason } = req.body as {
        status?: OrderStatus;
        priority?: OrderPriority;
        cancellationReason?: string;
        refireReason?: string;
      };

      const updated = await mutateSnapshot((snap) => {
        const order = snap.orders.find((o) => o.id === req.params.id);
        if (!order) throw new Error('Order not found.');
        const now = new Date().toISOString();

        if (status === 'Confirmed' && order.status === 'Submitted') {
          const table = order.tableId ? snap.tables.find((t) => t.id === order.tableId) : undefined;
          const session = order.sessionId ? snap.sessions.find((s) => s.id === order.sessionId) : undefined;
          const authCheck = canStaffConfirmTableOrder(order, table, session, req.staff!);
          if (!authCheck.allowed) {
            throw new Error(`Forbidden: ${authCheck.reason || 'Not authorized to confirm order.'}`);
          }
          order.status = 'Confirmed';
          if (!order.waiterId) {
            order.waiterId = req.staff!.id;
            order.waiterName = req.staff!.name;
          }
          const existingTickets = snap.tickets.filter((t) => t.orderId === order.id);
          if (existingTickets.length === 0) {
            const newTickets = splitOrderIntoKitchenTickets(order, snap.stations);
            snap.tickets.unshift(...newTickets);
          }
          if (table) {
            table.status = 'Order Active';
            table.updatedAt = now;
          }
          pushNotification(
            snap,
            ['kitchen_staff', 'kitchen_supervisor', 'manager', 'owner'],
            'urgent',
            `Confirmed Order ${order.orderNumber}`,
            `${order.tableNumber || order.channel} confirmed by ${req.staff!.name}.`,
            'kitchen'
          );
          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            'ORDER_CONFIRMED_TO_KITCHEN',
            'order',
            order.id
          );
        } else if (status === 'Cancelled') {
          const table = order.tableId ? snap.tables.find((t) => t.id === order.tableId) : undefined;
          const session = order.sessionId ? snap.sessions.find((s) => s.id === order.sessionId) : undefined;
          const waiterRejectingSubmitted =
            order.status === 'Submitted' &&
            canStaffConfirmTableOrder(order, table, session, req.staff!).allowed;
          if (!hasPermission(req.staff!.role, 'cancel_order') && !waiterRejectingSubmitted) {
            throw new Error('Forbidden: Only Managers, Supervisors, or the assigned Waiter (before kitchen dispatch) can cancel orders.');
          }
          if (!cancellationReason || cancellationReason.trim().length < 3) {
            throw new Error('Cancellation reason is required.');
          }
          order.status = 'Cancelled';
          order.cancellationReason = cancellationReason.trim();
          for (const t of snap.tickets) {
            if (t.orderId === order.id) {
              t.status = 'cancelled';
              t.updatedAt = now;
            }
          }
          if (table) {
            const otherActive = snap.orders.some(
              (o) =>
                o.id !== order.id &&
                o.tableId === table.id &&
                o.status !== 'Cancelled' &&
                o.status !== 'Completed'
            );
            if (!otherActive) {
              table.status = 'Occupied';
              table.updatedAt = now;
            }
          }
          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            'ORDER_CANCELLED',
            'order',
            order.id,
            cancellationReason.trim()
          );
        } else if (status) {
          order.status = status;
        }

        if (priority) {
          order.priority = priority;
          for (const t of snap.tickets) {
            if (t.orderId === order.id) {
              t.priority = priority;
              t.updatedAt = now;
            }
          }
        }

        if (refireReason) {
          order.remakeCount += 1;
          order.status = 'Preparing';
          for (const t of snap.tickets) {
            if (t.orderId === order.id) {
              t.status = 'new';
              t.remakeReason = refireReason;
              t.updatedAt = now;
            }
          }
          pushNotification(
            snap,
            ['kitchen_staff', 'kitchen_supervisor'],
            'urgent',
            `REFIRE: ${order.orderNumber}`,
            `${order.tableNumber || order.channel}: ${refireReason}`,
            'kitchen'
          );
          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            'ORDER_REFIRED',
            'order',
            order.id,
            refireReason
          );
        }

        order.timeline.push({
          status: order.status,
          actorId: req.staff!.id,
          actorName: req.staff!.name,
          note: cancellationReason || refireReason,
          timestamp: now,
        });
        order.updatedAt = now;
        return order;
      });

      broadcastEvent('snapshot:updated', {
        reason: 'order_updated',
        entity: 'order',
        action: 'update',
        recordId: updated.id,
        tableId: updated.tableId,
        sessionId: updated.sessionId,
        waiterId: updated.waiterId,
        channel: updated.channel,
      });
      res.json({ order: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to update order.';
      res.status(msg.startsWith('Forbidden:') ? 403 : 400).json({ error: msg });
    }
  });

  // Kitchen KDS Ticket Actions
  app.patch('/api/kitchen/tickets/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const canKitchen = hasPermission(req.staff!.role, 'update_kitchen_ticket');
      const canServe = hasPermission(req.staff!.role, 'serve_food');
      if (!canKitchen && !canServe) {
        return res.status(403).json({ error: 'Forbidden: cannot update kitchen tickets.' });
      }

      const { status, delayReason, clarificationNote, toggleItemId } = req.body as {
        status?: TicketStatus;
        delayReason?: string;
        clarificationNote?: string;
        toggleItemId?: string;
      };

      const result = await mutateSnapshot((snap) => {
        const ticket = snap.tickets.find((t) => t.id === req.params.id);
        if (!ticket) throw new Error('Kitchen ticket not found.');
        const order = snap.orders.find((o) => o.id === ticket.orderId);
        if (
          !canKitchen &&
          canServe &&
          !hasPermission(req.staff!.role, 'view_all_tables') &&
          order?.tableId &&
          !req.staff!.assignedTableIds.includes(order.tableId) &&
          order.waiterId !== req.staff!.id &&
          order.waiterId !== req.staff!.uid
        ) {
          throw new Error('Forbidden: you are not assigned to this table.');
        }

        const now = new Date().toISOString();

        if (toggleItemId) {
          const item = ticket.items.find((i) => i.orderItemId === toggleItemId);
          if (item) {
            item.status = item.status === 'ready' ? 'preparing' : 'ready';
          }
          if (ticket.items.every((i) => i.status === 'ready')) {
            ticket.status = 'ready';
          } else if (ticket.items.some((i) => i.status === 'ready' || i.status === 'preparing')) {
            ticket.status = 'preparing';
          }
        }

        if (status) {
          ticket.status = status;
          if (status === 'ready' || status === 'completed') {
            for (const it of ticket.items) it.status = 'ready';
          } else if (status === 'preparing') {
            for (const it of ticket.items) if (it.status === 'new') it.status = 'preparing';
          }
        }
        if (delayReason !== undefined) ticket.delayReason = delayReason;
        if (clarificationNote !== undefined) ticket.clarificationNote = clarificationNote;
        ticket.updatedAt = now;

        if (order) {
          const siblingTickets = snap.tickets.filter((t) => t.orderId === order.id);
          const derived = deriveOrderStatusFromTickets(siblingTickets, order.channel, order.status);
          if (derived !== order.status) {
            order.status = derived;
            order.timeline.push({
              status: derived,
              actorId: req.staff!.id,
              actorName: req.staff!.name,
              note:
                ticket.status === 'completed'
                  ? `${ticket.stationName} completed order (moved to kitchen history)`
                  : `${ticket.stationName} ticket ${ticket.status}`,
              timestamp: now,
            });
          }
          order.updatedAt = now;

          if (order.tableId) {
            const table = snap.tables.find((t) => t.id === order.tableId);
            if (table) {
              if (order.status === 'Ready' || order.status === 'Partially Ready') {
                table.status = 'Food Ready';
              } else if (order.status === 'Preparing') {
                table.status = 'Preparing';
              } else if (order.status === 'Served' || order.status === 'Completed') {
                const otherOpenOrders = snap.orders.some(
                  (o) =>
                    o.id !== order.id &&
                    o.tableId === table.id &&
                    o.status !== 'Cancelled' &&
                    o.status !== 'Completed' &&
                    o.status !== 'Served'
                );
                if (!otherOpenOrders) {
                  table.status = 'Occupied';
                }
              }
              table.updatedAt = now;
            }
          }

          if (ticket.status === 'ready') {
            pushNotification(
              snap,
              ['waiter', 'manager'],
              'success',
              `Food Ready: ${order.tableNumber || order.channel}`,
              `${ticket.stationName} completed ${order.orderNumber}. Ready for pickup!`,
              'waiter',
              'pickup',
              order.waiterId
            );
          } else if (ticket.status === 'completed') {
            pushNotification(
              snap,
              ['waiter', 'manager', 'owner'],
              'success',
              `Order Completed: ${order.orderNumber}`,
              `${ticket.stationName} moved ${order.orderNumber} (${order.tableNumber || order.channel}) to Kitchen History.`,
              'manager',
              'orders',
              order.waiterId
            );
            appendAudit(
              snap,
              { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
              'KITCHEN_TICKET_COMPLETED',
              'kitchen_ticket',
              ticket.id,
              undefined,
              { orderId: order.id, orderNumber: order.orderNumber }
            );
          } else if (ticket.status === 'delayed') {
            pushNotification(
              snap,
              ['manager', 'waiter'],
              'urgent',
              `Order Delayed: ${order.orderNumber}`,
              `${ticket.stationName}: ${delayReason || 'Kitchen reported delay'}`,
              'manager',
              'kitchen',
              order.waiterId
            );
          }
        }

        return { ticket, order };
      });

      broadcastEvent('snapshot:updated', {
        reason: 'kitchen_ticket_updated',
        entity: 'kitchen_ticket',
        action: 'update',
        recordId: result.ticket.id,
        tableId: result.order?.tableId,
        sessionId: result.order?.sessionId,
        waiterId: result.order?.waiterId,
        stationId: result.ticket.stationId,
        channel: result.order?.channel,
      });
      res.json({ ticket: result.ticket });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to update ticket.';
      res.status(msg.startsWith('Forbidden:') ? 403 : 400).json({ error: msg });
    }
  });

  // Billing & Payments
  app.post('/api/bills/generate', requireAuth, requirePerm('generate_bill'), async (req: AuthedRequest, res) => {
    try {
      const { sessionId } = req.body as { sessionId?: string };
      if (!sessionId) return res.status(400).json({ error: 'Session ID required.' });
      const bill = await mutateSnapshot((snap) => {
        const session = snap.sessions.find((s) => s.id === sessionId);
        if (!session) throw new Error('Session not found.');
        const sessionOrders = snap.orders.filter((o) => o.sessionId === session.id);
        if (sessionOrders.length === 0) throw new Error('No billable orders in session.');

        const idx = snap.bills.findIndex((b) => b.sessionId === session.id);
        const existing = idx >= 0 ? snap.bills[idx] : null;
        const consolidated = consolidateSessionOrdersToBill(
          session.id,
          session.tableId,
          session.tableNumber,
          sessionOrders,
          existing,
          `INV-${1001 + snap.bills.length}`
        );
        if (idx >= 0) snap.bills[idx] = consolidated;
        else snap.bills.unshift(consolidated);

        const table = snap.tables.find((t) => t.id === session.tableId);
        if (table && consolidated.status !== 'paid') {
          table.status = 'Payment Pending';
          table.updatedAt = new Date().toISOString();
        }
        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'BILL_GENERATED',
          'bill',
          consolidated.id,
          undefined,
          { totalAmount: consolidated.totalAmount, tableNumber: consolidated.tableNumber }
        );
        return consolidated;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'bill_generated',
        entity: 'bill',
        action: 'create',
        recordId: bill.id,
        tableId: bill.tableId,
        sessionId: bill.sessionId,
      });
      res.json({ bill });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate bill.' });
    }
  });

  app.post('/api/bills/:id/payments', requireAuth, requirePerm('record_payment'), async (req: AuthedRequest, res) => {
    try {
      const { amount, method, reference } = req.body as {
        amount?: number;
        method?: PaymentMethod;
        reference?: string;
      };
      if (!amount || !method) {
        return res.status(400).json({ error: 'Amount and payment method are required.' });
      }

      const result = await mutateSnapshot((snap) => {
        const idx = snap.bills.findIndex((b) => b.id === req.params.id);
        if (idx < 0) throw new Error('Bill not found.');
        const bill = snap.bills[idx];
        const existingPayments = snap.payments.filter((p) => p.billId === bill.id);
        const { updatedBill, isFullyPaid } = applyPaymentToBill(bill, Number(amount), existingPayments);

        const payment: PaymentRecord = {
          id: `pay_${crypto.randomUUID().slice(0, 12)}`,
          billId: bill.id,
          billNumber: bill.billNumber,
          sessionId: bill.sessionId,
          tableNumber: bill.tableNumber,
          amount: Number(amount),
          method,
          reference: reference?.trim() || `${method.toUpperCase()}-${Date.now().toString().slice(-5)}`,
          recordedById: req.staff!.id,
          recordedByName: req.staff!.name,
          createdAt: new Date().toISOString(),
        };
        snap.bills[idx] = updatedBill;
        snap.payments.unshift(payment);

        if (isFullyPaid) {
          const session = snap.sessions.find((s) => s.id === bill.sessionId);
          if (session) {
            session.status = 'closed';
            session.closedAt = new Date().toISOString();
          }
          const table = snap.tables.find((t) => t.id === bill.tableId);
          if (table) {
            table.status = 'Cleaning';
            table.updatedAt = new Date().toISOString();
          }
          for (const o of snap.orders) {
            if (o.sessionId === bill.sessionId) {
              o.paymentStatus = 'paid';
              if (o.status === 'Served' || o.status === 'Ready') o.status = 'Completed';
            }
          }
          pushNotification(
            snap,
            ['waiter', 'manager'],
            'success',
            `Table ${bill.tableNumber} Settled`,
            `${bill.billNumber} paid in full. Table moved to Cleaning.`,
            'waiter',
            'tables'
          );
        }

        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'PAYMENT_RECORDED',
          'payment',
          payment.id,
          undefined,
          { billId: bill.id, amount: payment.amount, method: payment.method, settled: isFullyPaid }
        );
        return { bill: updatedBill, payment };
      });

      broadcastEvent('snapshot:updated', {
        reason: 'payment_recorded',
        entity: 'payment',
        action: 'create',
        recordId: result.payment.id,
        tableId: result.bill.tableId,
        sessionId: result.bill.sessionId,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to record payment.' });
    }
  });

  app.post('/api/bills/:id/adjustments', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { type, amount, reason } = req.body as {
        type?: 'discount' | 'correction' | 'refund';
        amount?: number;
        reason?: string;
      };
      if (!type || !amount || !reason) {
        return res.status(400).json({ error: 'Adjustment type, amount, and audit reason are required.' });
      }

      const updated = await mutateSnapshot((snap) => {
        const idx = snap.bills.findIndex((b) => b.id === req.params.id);
        if (idx < 0) throw new Error('Bill not found.');
        const next = applyAuditedAdjustment(snap.bills[idx], req.staff!.role, {
          id: `adj_${crypto.randomUUID().slice(0, 10)}`,
          type,
          amount: Number(amount),
          reason: reason.trim(),
          actorId: req.staff!.id,
          actorName: req.staff!.name,
          createdAt: new Date().toISOString(),
        });
        snap.bills[idx] = next;
        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          `BILL_${type.toUpperCase()}`,
          'bill',
          next.id,
          reason.trim(),
          { amount: Number(amount), newTotal: next.totalAmount }
        );
        return next;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'bill_adjusted',
        entity: 'bill',
        action: 'update',
        recordId: updated.id,
        tableId: updated.tableId,
        sessionId: updated.sessionId,
      });
      res.json({ bill: updated });
    } catch (err: unknown) {
      res.status(403).json({ error: err instanceof Error ? err.message : 'Adjustment denied.' });
    }
  });

  // Menu Management
  app.post('/api/menu/categories', requireAuth, requirePerm('manage_menu'), async (req: AuthedRequest, res) => {
    try {
      const { name, icon, sortOrder } = req.body as { name?: string; icon?: string; sortOrder?: number };
      if (!name?.trim()) return res.status(400).json({ error: 'Category name is required.' });
      const cat = await mutateSnapshot((snap) => {
        const entry = {
          id: `cat_${crypto.randomUUID().slice(0, 10)}`,
          name: name.trim(),
          icon: icon || 'Utensils',
          sortOrder: Number(sortOrder ?? snap.categories.length + 1),
          isActive: true,
        };
        snap.categories.push(entry);
        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'CATEGORY_CREATED',
          'menu_category',
          entry.id
        );
        return entry;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'menu_updated',
        entity: 'menu',
        action: 'create',
        recordId: cat.id,
      });
      res.status(201).json({ category: cat });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create category.' });
    }
  });

  app.patch('/api/menu/categories/:id', requireAuth, requirePerm('manage_menu'), async (req: AuthedRequest, res) => {
    try {
      const updated = await mutateSnapshot((snap) => {
        const cat = snap.categories.find((c) => c.id === req.params.id);
        if (!cat) throw new Error('Category not found.');
        Object.assign(cat, req.body);
        return cat;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'menu_updated',
        entity: 'menu',
        action: 'update',
        recordId: updated.id,
      });
      res.json({ category: updated });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update category.' });
    }
  });

  app.post('/api/menu/items', requireAuth, requirePerm('manage_menu'), async (req: AuthedRequest, res) => {
    try {
      const body = req.body;
      const rawVariants = Array.isArray(body.variants)
        ? body.variants
            .filter(
              (v: { name?: string; price?: number }) =>
                v && String(v.name || '').trim() && Number(v.price) >= 0
            )
            .map((v: { id?: string; name: string; price: number }, idx: number) => ({
              id: v.id || `var_${Date.now()}_${idx}`,
              name: String(v.name).trim().slice(0, 40),
              price: Math.round(Number(v.price) * 100) / 100,
            }))
        : [];
      const derivedPrice =
        rawVariants.length > 0
          ? Math.min(...rawVariants.map((v: { price: number }) => v.price))
          : Number(body.price);

      if (!body.name || !body.categoryId || !Number.isFinite(derivedPrice) || derivedPrice < 0) {
        return res.status(400).json({ error: 'Dish name, category, and non-negative price are required.' });
      }
      let validatedPhotoUrl = '/src/assets/images/dish_truffle_pizza_1795406026216.jpg';
      if (body.photoUrl !== undefined && String(body.photoUrl).trim() !== '') {
        const checked = validateAppImageUrl(body.photoUrl);
        if (!checked) {
          return res.status(400).json({ error: 'Invalid or oversized dish photo image.' });
        }
        validatedPhotoUrl = checked;
      }

      const item = await mutateSnapshot((snap) => {
        const entry = {
          id: `item_${crypto.randomUUID().slice(0, 10)}`,
          code: body.code || `DSH-${100 + snap.menuItems.length}`,
          name: String(body.name).trim(),
          description: String(body.description || ''),
          categoryId: String(body.categoryId),
          price: derivedPrice,
          variants: rawVariants.length > 0 ? rawVariants : undefined,
          vegType: body.vegType || 'veg',
          isAvailable: body.isAvailable ?? true,
          isTemporarilySoldOut: body.isTemporarilySoldOut ?? false,
          isFeatured: body.isFeatured ?? false,
          prepTimeMinutes: Number(body.prepTimeMinutes || 15),
          portionSize:
            body.portionSize ||
            (rawVariants.length > 0
              ? rawVariants.map((v: { name: string }) => v.name).join(' / ')
              : 'Regular'),
          spiceLevel: body.spiceLevel || 'Medium',
          allergens: Array.isArray(body.allergens) ? body.allergens : [],
          stationId: body.stationId || 'st_main',
          photoUrl: validatedPhotoUrl,
          modifiers: Array.isArray(body.modifiers) ? body.modifiers : [],
          taxCategory: body.taxCategory || 'standard',
          platformAvailability: body.platformAvailability || {
            dineIn: true,
            swiggy: true,
            zomato: true,
            takeaway: true,
          },
        };
        snap.menuItems.push(entry);
        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'MENU_ITEM_CREATED',
          'menu_item',
          entry.id,
          undefined,
          { price: entry.price }
        );
        return entry;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'menu_updated',
        entity: 'menu',
        action: 'create',
        recordId: item.id,
      });
      res.status(201).json({ item });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create menu item.' });
    }
  });

  app.patch('/api/menu/items/:id', requireAuth, requirePerm('manage_menu'), async (req: AuthedRequest, res) => {
    try {
      if (req.body.photoUrl !== undefined) {
        const checked = validateAppImageUrl(req.body.photoUrl);
        if (!checked) {
          return res.status(400).json({ error: 'Invalid or oversized dish photo image.' });
        }
      }
      const item = await mutateSnapshot((snap) => {
        const entry = snap.menuItems.find((m) => m.id === req.params.id);
        if (!entry) throw new Error('Menu item not found.');
        const oldPrice = entry.price;
        const body = { ...req.body };
        if (body.photoUrl !== undefined) {
          body.photoUrl = validateAppImageUrl(body.photoUrl) || entry.photoUrl;
        }
        if (Array.isArray(body.variants)) {
          const cleanVariants = body.variants
            .filter(
              (v: { name?: string; price?: number }) =>
                v && String(v.name || '').trim() && Number(v.price) >= 0
            )
            .map((v: { id?: string; name: string; price: number }, idx: number) => ({
              id: v.id || `var_${Date.now()}_${idx}`,
              name: String(v.name).trim().slice(0, 40),
              price: Math.round(Number(v.price) * 100) / 100,
            }));
          body.variants = cleanVariants.length > 0 ? cleanVariants : undefined;
          if (cleanVariants.length > 0 && body.price === undefined) {
            body.price = Math.min(...cleanVariants.map((v: { price: number }) => v.price));
          }
        }
        Object.assign(entry, body);
        if (req.body.price !== undefined && Number(req.body.price) !== oldPrice) {
          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            'MENU_PRICE_CHANGED',
            'menu_item',
            entry.id,
            undefined,
            { oldPrice, newPrice: entry.price }
          );
        }
        return entry;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'menu_updated',
        entity: 'menu',
        action: 'update',
        recordId: item.id,
      });
      res.json({ item });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update menu item.' });
    }
  });

  // Staff & Shifts
  app.post('/api/staff', requireAuth, requirePerm('manage_staff'), async (req: AuthedRequest, res) => {
    try {
      const { name, email, mobile, photoUrl, role, section, kitchenStationId, shift, passcode } = req.body as {
        name?: string;
        email?: string;
        mobile?: string;
        photoUrl?: string;
        role?: StaffRole;
        section?: string;
        kitchenStationId?: string;
        shift?: StaffProfile['shift'];
        passcode?: string;
      };
      if (!name || !email || !role || !passcode || passcode.length < 6) {
        return res.status(400).json({
          error: 'Name, email, role, and a 6+ character initial passcode are required.',
        });
      }
      const cleanEmail = email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(cleanEmail)) {
        return res.status(400).json({ error: 'Please enter a valid work email address.' });
      }
      let validatedPhoto: string | undefined;
      if (photoUrl !== undefined && String(photoUrl).trim() !== '') {
        const checked = validateAppImageUrl(photoUrl);
        if (!checked) {
          return res.status(400).json({ error: 'Invalid or oversized staff profile photo.' });
        }
        validatedPhoto = checked;
      }
      const created = await mutateSnapshot((snap) => {
        if (snap.staff.some((s) => s.email.toLowerCase() === cleanEmail)) {
          throw new Error('A staff account with this email already exists.');
        }
        const now = new Date().toISOString();
        const id = `stf_${crypto.randomUUID().slice(0, 10)}`;
        const empId = `EMP-${String(snap.staff.length + 1).padStart(3, '0')}`;
        const profile: StaffProfile = {
          id,
          uid: id,
          employeeId: empId,
          name: name.trim(),
          email: cleanEmail,
          mobile: mobile?.trim() || '',
          photoUrl: validatedPhoto,
          role,
          section,
          assignedTableIds: [],
          kitchenStationId,
          shift: shift || 'Evening',
          joinDate: now.slice(0, 10),
          status: 'active',
          onDuty: false,
          createdAt: now,
          updatedAt: now,
        };
        snap.staff.push(profile);
        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'STAFF_CREATED',
          'staff',
          profile.id,
          undefined,
          { role }
        );
        return profile;
      });
      await setStaffPassword(created.id, created.email, created.employeeId, passcode.trim());
      broadcastEvent('snapshot:updated', {
        reason: 'staff_updated',
        entity: 'staff',
        action: 'create',
        recordId: created.id,
      });
      res.status(201).json({ staff: created });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to create staff account.' });
    }
  });

  app.patch('/api/staff/:id', requireAuth, requirePerm('manage_staff'), async (req: AuthedRequest, res) => {
    try {
      const bodyInput = req.body as Partial<StaffProfile>;
      let validatedPhoto: string | undefined;
      if (bodyInput.photoUrl !== undefined) {
        if (bodyInput.photoUrl === '') {
          validatedPhoto = '';
        } else {
          const checked = validateAppImageUrl(bodyInput.photoUrl);
          if (!checked) {
            return res.status(400).json({ error: 'Invalid or oversized staff profile photo.' });
          }
          validatedPhoto = checked;
        }
      }

      const result = await mutateSnapshot((snap) => {
        const target = snap.staff.find((s) => s.id === req.params.id);
        if (!target) throw new Error('Staff profile not found.');

        const body = req.body as Partial<StaffProfile>;
        if (target.role === 'owner' && req.staff!.role !== 'owner') {
          throw new Error('Only the Owner can modify the Owner account.');
        }
        if (target.role === 'owner' && body.role && body.role !== 'owner') {
          throw new Error('The Owner role cannot be reassigned.');
        }

        let emailChanged = false;
        const oldEmail = target.email;
        if (body.email !== undefined) {
          const cleanEmail = String(body.email).trim().toLowerCase();
          if (!EMAIL_REGEX.test(cleanEmail)) {
            throw new Error('Please enter a valid email address.');
          }
          if (cleanEmail !== target.email.toLowerCase()) {
            const dup = snap.staff.find(
              (s) => s.id !== target.id && s.email.toLowerCase() === cleanEmail
            );
            if (dup) throw new Error('Another staff member already uses this email address.');
            target.email = cleanEmail;
            target.uid = target.id;
            emailChanged = true;
          }
        }

        if (body.name !== undefined && body.name.trim()) target.name = body.name.trim();
        if (body.mobile !== undefined) target.mobile = body.mobile.trim();
        if (validatedPhoto !== undefined) target.photoUrl = validatedPhoto || undefined;
        if (body.role !== undefined && target.role !== 'owner') target.role = body.role;
        if (body.section !== undefined) target.section = body.section;
        if (body.kitchenStationId !== undefined) target.kitchenStationId = body.kitchenStationId;
        if (body.shift !== undefined) target.shift = body.shift;
        if (body.status !== undefined && target.role !== 'owner') target.status = body.status;
        target.updatedAt = new Date().toISOString();

        if (emailChanged) {
          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            target.role === 'owner' ? 'OWNER_EMAIL_UPDATED' : 'STAFF_EMAIL_UPDATED',
            'staff',
            target.id,
            undefined,
            { oldEmail, newEmail: target.email }
          );
        } else {
          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            'STAFF_UPDATED',
            'staff',
            target.id,
            undefined,
            { role: target.role, status: target.status }
          );
        }
        return { staff: target, emailChanged };
      });
      if (result.emailChanged) {
        await updateStaffCredentialEmail(result.staff.id, result.staff.email, result.staff.employeeId);
      }
      broadcastEvent('snapshot:updated', {
        reason: 'staff_updated',
        entity: 'staff',
        action: 'update',
        recordId: result.staff.id,
      });
      res.json({ staff: result.staff });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to update staff.' });
    }
  });

  app.post('/api/shifts/toggle', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const result = await mutateSnapshot((snap) => {
        const me = snap.staff.find((s) => s.id === req.staff!.id);
        if (!me) throw new Error('Staff not found.');
        const now = new Date().toISOString();
        me.onDuty = !me.onDuty;
        me.updatedAt = now;
        if (me.onDuty) {
          snap.shifts.unshift({
            id: `shf_${crypto.randomUUID().slice(0, 10)}`,
            staffId: me.id,
            staffName: me.name,
            role: me.role,
            status: 'active',
            startedAt: now,
          });
        } else {
          const activeShift = snap.shifts.find((sh) => sh.staffId === me.id && sh.status === 'active');
          if (activeShift) {
            activeShift.status = 'ended';
            activeShift.endedAt = now;
          }
        }
        return { onDuty: me.onDuty };
      });
      broadcastEvent('snapshot:updated', {
        reason: 'shift_toggled',
        entity: 'staff',
        action: 'update',
        recordId: req.staff!.id,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to toggle shift.' });
    }
  });

  // Inventory & Suppliers
  app.post('/api/inventory/adjust', requireAuth, requirePerm('manage_inventory'), async (req: AuthedRequest, res) => {
    try {
      const { itemId, type, quantity, reason } = req.body as {
        itemId?: string;
        type?: InventoryMovement['type'];
        quantity?: number;
        reason?: string;
      };
      if (!itemId || !type || !quantity || Number(quantity) <= 0) {
        return res.status(400).json({ error: 'Item, movement type, and positive quantity are required.' });
      }
      const updated = await mutateSnapshot((snap) => {
        const item = snap.inventory.find((i) => i.id === itemId);
        if (!item) throw new Error('Inventory item not found.');
        const qty = Number(quantity);
        if (type === 'in') {
          item.currentStock = Math.round((item.currentStock + qty) * 100) / 100;
        } else {
          item.currentStock = Math.max(0, Math.round((item.currentStock - qty) * 100) / 100);
        }
        item.updatedAt = new Date().toISOString();
        snap.inventoryMovements.unshift({
          id: `mov_${crypto.randomUUID().slice(0, 10)}`,
          itemId: item.id,
          itemName: item.name,
          type,
          quantity: qty,
          unit: item.unit,
          reason: reason?.trim() || `${type} update`,
          actorName: req.staff!.name,
          createdAt: item.updatedAt,
        });
        if (item.currentStock <= item.minStock) {
          pushNotification(
            snap,
            ['manager', 'owner'],
            'warning',
            `Low Stock: ${item.name}`,
            `${item.currentStock} ${item.unit} remaining (min ${item.minStock} ${item.unit}).`,
            'manager',
            'inventory'
          );
        }
        return item;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'inventory_updated',
        entity: 'inventory',
        action: 'update',
        recordId: updated.id,
      });
      res.json({ item: updated });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Inventory adjustment failed.' });
    }
  });

  app.post('/api/inventory/items', requireAuth, requirePerm('manage_inventory'), async (req: AuthedRequest, res) => {
    try {
      const body = req.body;
      if (!body.name || !body.unit) return res.status(400).json({ error: 'Name and unit required.' });
      const item = await mutateSnapshot((snap) => {
        const entry = {
          id: `inv_${crypto.randomUUID().slice(0, 10)}`,
          name: String(body.name).trim(),
          sku: body.sku || `ING-${100 + snap.inventory.length}`,
          category: body.category || 'General',
          unit: String(body.unit).trim(),
          currentStock: Number(body.currentStock || 0),
          minStock: Number(body.minStock || 5),
          costPerUnit: Number(body.costPerUnit || 0),
          supplierName: body.supplierName || '',
          expiryDate: body.expiryDate || undefined,
          updatedAt: new Date().toISOString(),
        };
        snap.inventory.push(entry);
        return entry;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'inventory_updated',
        entity: 'inventory',
        action: 'create',
        recordId: item.id,
      });
      res.status(201).json({ item });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create inventory item.' });
    }
  });

  app.post('/api/purchase-orders', requireAuth, requirePerm('manage_inventory'), async (req: AuthedRequest, res) => {
    try {
      const { supplierId, itemId, quantity } = req.body as {
        supplierId?: string;
        itemId?: string;
        quantity?: number;
      };
      if (!supplierId || !itemId || !quantity) {
        return res.status(400).json({ error: 'Supplier, item, and quantity required.' });
      }
      const po = await mutateSnapshot((snap) => {
        const supplier = snap.suppliers.find((s) => s.id === supplierId);
        const item = snap.inventory.find((i) => i.id === itemId);
        if (!supplier || !item) throw new Error('Supplier or inventory item not found.');
        const qty = Number(quantity);
        const entry = {
          id: `po_${crypto.randomUUID().slice(0, 10)}`,
          poNumber: `PO-2026-${100 + snap.purchaseOrders.length}`,
          supplierId: supplier.id,
          supplierName: supplier.name,
          status: 'ordered' as const,
          items: [{ itemId: item.id, itemName: item.name, quantity: qty, unitCost: item.costPerUnit }],
          totalCost: Math.round(qty * item.costPerUnit * 100) / 100,
          createdAt: new Date().toISOString(),
        };
        snap.purchaseOrders.unshift(entry);
        return entry;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'po_created',
        entity: 'inventory',
        action: 'create',
        recordId: po.id,
      });
      res.status(201).json({ purchaseOrder: po });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create purchase order.' });
    }
  });

  // Online Integrations (Swiggy / Zomato / Direct Online)
  app.patch(
    '/api/integrations/:platform',
    requireAuth,
    requirePerm('manage_integrations'),
    async (req: AuthedRequest, res) => {
      try {
        const platformKey = req.params.platform as 'swiggy' | 'zomato' | 'direct_online';
        const updated = await mutateSnapshot((snap) => {
          const cfg = snap.platforms.find((p) => p.platform === platformKey);
          if (!cfg) throw new Error('Platform not found.');
          const { outletId, autoAcceptOrders, menuSyncEnabled } = req.body as {
            outletId?: string;
            autoAcceptOrders?: boolean;
            menuSyncEnabled?: boolean;
          };
          if (outletId !== undefined) cfg.outletId = outletId.trim();
          if (autoAcceptOrders !== undefined) cfg.autoAcceptOrders = Boolean(autoAcceptOrders);
          if (menuSyncEnabled !== undefined) cfg.menuSyncEnabled = Boolean(menuSyncEnabled);
          const secretEnv =
            platformKey === 'swiggy'
              ? process.env.SWIGGY_WEBHOOK_SECRET
              : process.env.ZOMATO_WEBHOOK_SECRET;
          cfg.connectionStatus = cfg.outletId && secretEnv ? 'connected' : 'sandbox_bridge';
          cfg.lastSyncAt = new Date().toISOString();

          snap.integrationEvents.unshift({
            id: `ie_${crypto.randomUUID().slice(0, 10)}`,
            platform: platformKey,
            eventType: 'CONFIG_UPDATED',
            status: cfg.connectionStatus === 'connected' ? 'ok' : 'warning',
            message:
              cfg.connectionStatus === 'connected'
                ? `Connected ${cfg.displayName} outlet ${cfg.outletId}.`
                : `Saved outlet "${cfg.outletId || 'unset'}". Live webhook signature verification remains in sandbox until partner secret is added to environment secrets.`,
            createdAt: cfg.lastSyncAt,
          });
          appendAudit(
            snap,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            'INTEGRATION_CONFIG_UPDATED',
            'online_platform',
            cfg.id
          );
          return cfg;
        });
        broadcastEvent('snapshot:updated', {
          reason: 'integration_updated',
          entity: 'integration',
          action: 'update',
          recordId: updated.id,
          channel: platformKey,
        });
        res.json({ platform: updated });
      } catch (err: unknown) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Integration update failed.' });
      }
    }
  );

  app.post('/api/integrations/:platform/webhook', async (req, res) => {
    try {
      const platformKey = req.params.platform as 'swiggy' | 'zomato' | 'direct_online';
      const adapter = integrationAdapters[platformKey];
      if (!adapter) return res.status(404).json({ error: 'Unknown platform.' });
      const secret =
        platformKey === 'swiggy'
          ? process.env.SWIGGY_WEBHOOK_SECRET
          : process.env.ZOMATO_WEBHOOK_SECRET;
      const sig = req.header('x-webhook-signature');
      if (!adapter.verifySignature(JSON.stringify(req.body), sig, secret)) {
        return res.status(401).json({
          error:
            'Partner webhook signature missing or invalid. Configure partner webhook secret to accept live webhook traffic.',
        });
      }
      const result = await mutateSnapshot((snap) =>
        ingestOnlineOrderIntoCentralEngine(
          snap,
          platformKey,
          req.body,
          { id: platformKey, name: `${platformKey} Webhook`, role: 'integration' },
          false
        )
      );
      broadcastEvent('snapshot:updated', {
        reason: 'online_order_received',
        entity: 'order',
        action: 'create',
        recordId: result.order.id,
        channel: platformKey,
      });
      res.status(201).json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Webhook ingestion failed.' });
    }
  });

  app.post(
    '/api/integrations/:platform/test-order',
    requireAuth,
    requirePerm('manage_integrations'),
    async (req: AuthedRequest, res) => {
      try {
        const platformKey = req.params.platform as 'swiggy' | 'zomato' | 'direct_online';
        const result = await mutateSnapshot((snap) =>
          ingestOnlineOrderIntoCentralEngine(
            snap,
            platformKey,
            req.body,
            { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
            true
          )
        );
        broadcastEvent('snapshot:updated', {
          reason: 'sandbox_online_order',
          entity: 'order',
          action: 'create',
          recordId: result.order.id,
          channel: platformKey,
        });
        res.status(201).json(result);
      } catch (err: unknown) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Sandbox order test failed.' });
      }
    }
  );

  // Settings & Notifications
  app.patch('/api/settings', requireAuth, requirePerm('manage_settings'), async (req: AuthedRequest, res) => {
    try {
      const body = { ...req.body };
      if (body.logoUrl !== undefined) {
        const checkedLogo = validateAppImageUrl(body.logoUrl);
        if (!checkedLogo) {
          return res.status(400).json({ error: 'Invalid or oversized restaurant logo image.' });
        }
        body.logoUrl = checkedLogo;
      }
      if (
        body.defaultTheme !== undefined &&
        body.defaultTheme !== 'system' &&
        body.defaultTheme !== 'light' &&
        body.defaultTheme !== 'dark'
      ) {
        return res.status(400).json({ error: 'Default theme must be system, light, or dark.' });
      }
      const updated = await mutateSnapshot((snap) => {
        Object.assign(snap.settings, body, { updatedAt: new Date().toISOString() });
        appendAudit(
          snap,
          { id: req.staff!.id, name: req.staff!.name, role: req.staff!.role },
          'SETTINGS_UPDATED',
          'restaurant',
          snap.settings.id
        );
        return snap.settings;
      });
      broadcastEvent('snapshot:updated', {
        reason: 'settings_updated',
        entity: 'settings',
        action: 'update',
        recordId: updated.id,
      });
      res.json({ settings: updated });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update settings.' });
    }
  });

  app.post('/api/notifications/mark-read', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { id } = req.body as { id?: string };
      await mutateSnapshot((snap) => {
        for (const n of snap.notifications) {
          if (!id || n.id === id) n.isRead = true;
        }
      });
      broadcastEvent('snapshot:updated', {
        reason: 'notifications_read',
        entity: 'notification',
        action: 'update',
        recordId: id,
      });
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to mark read.' });
    }
  });

  return app;
}

const app = createApp();
export default app;
