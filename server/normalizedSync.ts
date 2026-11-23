import crypto from 'node:crypto';
import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RestaurantSnapshot } from '../src/types/domain.ts';

export type MediaCategory = 'staff' | 'menu_item' | 'logo';

export interface MediaAssetRecord {
  id: string;
  url: string;
  mimeType: string;
  byteSize: number;
  storagePath?: string | null;
}

export interface StoredMediaBinary {
  id: string;
  mimeType: string;
  buffer: Buffer;
  publicUrl?: string | null;
}

function extFromMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    default:
      return 'jpg';
  }
}

export function isSchemaMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    msg.includes('schema cache') ||
    msg.includes('PGRST205') ||
    msg.includes('does not exist') ||
    msg.includes('42P01')
  );
}

export async function storeMediaAssetInDb(params: {
  backend: 'postgres' | 'supabase' | 'sqlite';
  pgPool?: Pool;
  supabase?: SupabaseClient;
  sqlite?: import('node:sqlite').DatabaseSync;
  category: MediaCategory;
  entityId?: string;
  fileName?: string;
  mimeType: string;
  base64Data: string;
  uploadedByStaffId?: string;
}): Promise<MediaAssetRecord> {
  const id = `med_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const buffer = Buffer.from(params.base64Data, 'base64');
  const byteSize = buffer.length;
  const fallbackUrl = `/api/media/${id}`;
  let storagePath: string | null = null;
  let publicUrl: string | null = fallbackUrl;

  if (params.backend === 'supabase' && params.supabase) {
    const sb = params.supabase;
    const ext = extFromMime(params.mimeType);
    const candidatePath = `${params.category}/${params.entityId || 'unassigned'}/${id}.${ext}`;
    try {
      const uploadRes = await sb.storage
        .from('restaurant-media')
        .upload(candidatePath, buffer, {
          contentType: params.mimeType,
          upsert: true,
        });
      if (!uploadRes.error) {
        storagePath = candidatePath;
        const pub = sb.storage.from('restaurant-media').getPublicUrl(candidatePath);
        if (pub.data?.publicUrl) {
          publicUrl = pub.data.publicUrl;
        }
      }
    } catch {
      // Fall back to serving from public.media_assets via /api/media/:id
    }

    const { error } = await sb.from('media_assets').insert({
      id,
      category: params.category,
      entity_id: params.entityId || null,
      file_name: params.fileName || `${id}.${ext}`,
      mime_type: params.mimeType,
      byte_size: byteSize,
      data_base64: params.base64Data,
      storage_path: storagePath,
      public_url: publicUrl,
      uploaded_by_staff_id: params.uploadedByStaffId || null,
      created_at: now,
    });

    if (error) {
      if (isSchemaMissingError(error)) {
        if (storagePath && publicUrl && publicUrl.startsWith('https://')) {
          return { id, url: publicUrl, mimeType: params.mimeType, byteSize, storagePath };
        }
        throw new Error(
          'Supabase media_assets table is not created yet. Run the updated full SQL schema in your Supabase SQL Editor first.'
        );
      }
      throw new Error(`Supabase media save failed: ${error.message}`);
    }

    return {
      id,
      url: publicUrl || fallbackUrl,
      mimeType: params.mimeType,
      byteSize,
      storagePath,
    };
  }

  if (params.backend === 'postgres' && params.pgPool) {
    await params.pgPool.query(
      `INSERT INTO media_assets (
         id, category, entity_id, file_name, mime_type, byte_size, data_base64,
         storage_path, public_url, uploaded_by_staff_id, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        params.category,
        params.entityId || null,
        params.fileName || `${id}.${extFromMime(params.mimeType)}`,
        params.mimeType,
        byteSize,
        params.base64Data,
        null,
        fallbackUrl,
        params.uploadedByStaffId || null,
        now,
      ]
    );
    return { id, url: fallbackUrl, mimeType: params.mimeType, byteSize };
  }

  if (params.sqlite) {
    params.sqlite
      .prepare(
        `INSERT INTO media_assets (
           id, category, entity_id, file_name, mime_type, byte_size, data_base64,
           storage_path, public_url, uploaded_by_staff_id, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        params.category,
        params.entityId || null,
        params.fileName || `${id}.${extFromMime(params.mimeType)}`,
        params.mimeType,
        byteSize,
        params.base64Data,
        null,
        fallbackUrl,
        params.uploadedByStaffId || null,
        now
      );
    return { id, url: fallbackUrl, mimeType: params.mimeType, byteSize };
  }

  throw new Error('No database backend available for media storage.');
}

export async function readMediaAssetFromDb(params: {
  backend: 'postgres' | 'supabase' | 'sqlite';
  pgPool?: Pool;
  supabase?: SupabaseClient;
  sqlite?: import('node:sqlite').DatabaseSync;
  id: string;
}): Promise<StoredMediaBinary | null> {
  if (params.backend === 'supabase' && params.supabase) {
    const { data, error } = await params.supabase
      .from('media_assets')
      .select('id, mime_type, data_base64, public_url')
      .eq('id', params.id)
      .maybeSingle();
    if (error || !data?.data_base64) return null;
    return {
      id: String(data.id),
      mimeType: String(data.mime_type),
      buffer: Buffer.from(String(data.data_base64), 'base64'),
      publicUrl: data.public_url ? String(data.public_url) : null,
    };
  }

  if (params.backend === 'postgres' && params.pgPool) {
    const { rows } = await params.pgPool.query<{
      id: string;
      mime_type: string;
      data_base64: string;
      public_url: string | null;
    }>('SELECT id, mime_type, data_base64, public_url FROM media_assets WHERE id = $1', [params.id]);
    const r = rows[0];
    if (!r?.data_base64) return null;
    return {
      id: r.id,
      mimeType: r.mime_type,
      buffer: Buffer.from(r.data_base64, 'base64'),
      publicUrl: r.public_url,
    };
  }

  if (params.sqlite) {
    const r = params.sqlite
      .prepare('SELECT id, mime_type, data_base64, public_url FROM media_assets WHERE id = ?')
      .get(params.id) as
      | { id?: string; mime_type?: string; data_base64?: string; public_url?: string | null }
      | undefined;
    if (!r?.id || !r.data_base64 || !r.mime_type) return null;
    return {
      id: r.id,
      mimeType: r.mime_type,
      buffer: Buffer.from(r.data_base64, 'base64'),
      publicUrl: r.public_url || null,
    };
  }

  return null;
}

type SqlRow = Record<string, unknown>;

function buildNormalizedRows(snapshot: RestaurantSnapshot): Record<string, SqlRow[]> {
  const s = snapshot.settings;
  return {
    restaurant_settings: [
      {
        id: s.id,
        name: s.name,
        tagline: s.tagline || '',
        logo_url: s.logoUrl || '',
        address: s.address || '',
        phone: s.phone || '',
        email: s.email || '',
        gst_number: s.gstNumber || '',
        opening_hours: s.openingHours || '',
        currency_symbol: s.currencySymbol || '₹',
        tax_rate_percent: Number(s.taxRatePercent ?? 5),
        service_charge_percent: Number(s.serviceChargePercent ?? 5),
        default_discount_limit_percent: Number(s.defaultDiscountLimitPercent ?? 20),
        otp_expiry_seconds: Number(s.otpExpirySeconds ?? 180),
        otp_resend_cooldown_seconds: Number(s.otpResendCooldownSeconds ?? 30),
        otp_max_attempts: Number(s.otpMaxAttempts ?? 5),
        service_request_cooldown_seconds: Number(s.serviceRequestCooldownSeconds ?? 20),
        allow_split_payment: Boolean(s.allowSplitPayment),
        allow_split_bill: Boolean(s.allowSplitBill),
        enable_sound_alerts: Boolean(s.enableSoundAlerts),
        default_theme: s.defaultTheme || 'system',
        floors_json: JSON.stringify(s.floors || []),
        sections_json: JSON.stringify(s.sections || []),
        updated_at: s.updatedAt || new Date().toISOString(),
      },
    ],
    staff_profiles: snapshot.staff.map((st) => ({
      id: st.id,
      uid: st.uid || st.id,
      employee_id: st.employeeId,
      name: st.name,
      email: st.email.toLowerCase(),
      mobile: st.mobile || '',
      photo_url: st.photoUrl || null,
      role: st.role,
      section: st.section || null,
      assigned_table_ids_json: JSON.stringify(st.assignedTableIds || []),
      kitchen_station_id: st.kitchenStationId || null,
      shift: st.shift || 'Full Day',
      join_date: st.joinDate,
      status: st.status,
      on_duty: Boolean(st.onDuty),
      created_at: st.createdAt,
      updated_at: st.updatedAt,
    })),
    staff_shifts: snapshot.shifts.map((sh) => ({
      id: sh.id,
      staff_id: sh.staffId,
      staff_name: sh.staffName,
      role: sh.role,
      status: sh.status,
      started_at: sh.startedAt,
      ended_at: sh.endedAt || null,
      notes: sh.notes || null,
    })),
    restaurant_tables: snapshot.tables.map((t) => ({
      id: t.id,
      table_number: t.tableNumber,
      capacity: t.capacity,
      floor: t.floor,
      section: t.section,
      table_type: t.tableType,
      assigned_waiter_id: t.assignedWaiterId || null,
      status: t.status,
      qr_token: t.qrToken,
      qr_revoked: Boolean(t.qrRevoked),
      is_archived: Boolean(t.isArchived),
      notes: t.notes || null,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    })),
    table_verifications: snapshot.verifications.map((v) => ({
      id: v.id,
      table_id: v.tableId,
      table_number: v.tableNumber,
      qr_token: v.qrToken,
      status: v.status,
      presence_confirmed: Boolean(v.presenceConfirmed),
      otp_verified: Boolean(v.otpVerified),
      waiter_id: v.waiterId || null,
      waiter_name: v.waiterName || null,
      session_id: v.sessionId || null,
      guest_label: v.guestLabel || null,
      guest_count: v.guestCount,
      reason: v.reason || null,
      expires_at: v.expiresAt,
      created_at: v.createdAt,
      updated_at: v.updatedAt,
    })),
    table_sessions: snapshot.sessions.map((ses) => ({
      id: ses.id,
      table_id: ses.tableId,
      table_number: ses.tableNumber,
      verification_request_id: ses.verificationRequestId || null,
      waiter_id: ses.waiterId || null,
      status: ses.status,
      guest_count: ses.guestCount,
      started_at: ses.startedAt,
      closed_at: ses.closedAt || null,
      notes: ses.notes || null,
    })),
    menu_categories: snapshot.categories.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon || 'Utensils',
      sort_order: c.sortOrder,
      is_active: Boolean(c.isActive),
    })),
    kitchen_stations: snapshot.stations.map((st) => ({
      id: st.id,
      name: st.name,
      code: st.code,
      is_active: Boolean(st.isActive),
      color: st.color || '#EA580C',
    })),
    menu_items: snapshot.menuItems.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      description: m.description || '',
      category_id: m.categoryId,
      price: Number(m.price),
      variants_json: m.variants ? JSON.stringify(m.variants) : null,
      veg_type: m.vegType,
      is_available: Boolean(m.isAvailable),
      is_temporarily_sold_out: Boolean(m.isTemporarilySoldOut),
      is_featured: Boolean(m.isFeatured),
      prep_time_minutes: Number(m.prepTimeMinutes || 15),
      portion_size: m.portionSize || 'Regular',
      spice_level: m.spiceLevel || 'Medium',
      allergens_json: JSON.stringify(m.allergens || []),
      station_id: m.stationId || 'st_main',
      photo_url: m.photoUrl || '',
      modifiers_json: JSON.stringify(m.modifiers || []),
      tax_category: m.taxCategory || 'standard',
      platform_availability_json: JSON.stringify(m.platformAvailability || {}),
      schedule_note: m.scheduleNote || null,
    })),
    orders: snapshot.orders.map((o) => ({
      id: o.id,
      order_number: o.orderNumber,
      channel: o.channel,
      table_id: o.tableId || null,
      table_number: o.tableNumber || null,
      session_id: o.sessionId || null,
      external_order_id: o.externalOrderId || null,
      platform_fee: o.platformFee ?? null,
      packaging_notes: o.packagingNotes || null,
      expected_pickup_at: o.expectedPickupAt || null,
      waiter_id: o.waiterId || null,
      waiter_name: o.waiterName || null,
      status: o.status,
      priority: o.priority,
      items_json: JSON.stringify(o.items || []),
      subtotal: Number(o.subtotal),
      tax_amount: Number(o.taxAmount),
      service_charge_amount: Number(o.serviceChargeAmount),
      discount_amount: Number(o.discountAmount),
      total_amount: Number(o.totalAmount),
      payment_status: o.paymentStatus,
      cancellation_reason: o.cancellationReason || null,
      remake_count: Number(o.remakeCount || 0),
      timeline_json: JSON.stringify(o.timeline || []),
      created_at: o.createdAt,
      updated_at: o.updatedAt,
    })),
    kitchen_tickets: snapshot.tickets.map((t) => ({
      id: t.id,
      order_id: t.orderId,
      order_number: t.orderNumber,
      channel: t.channel,
      table_number: t.tableNumber || null,
      external_order_id: t.externalOrderId || null,
      station_id: t.stationId,
      station_name: t.stationName,
      waiter_name: t.waiterName || null,
      priority: t.priority,
      status: t.status,
      items_json: JSON.stringify(t.items || []),
      delay_reason: t.delayReason || null,
      clarification_note: t.clarificationNote || null,
      remake_reason: t.remakeReason || null,
      estimated_minutes: Number(t.estimatedMinutes || 15),
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    })),
    service_requests: snapshot.serviceRequests.map((sr) => ({
      id: sr.id,
      table_id: sr.tableId,
      table_number: sr.tableNumber,
      session_id: sr.sessionId || null,
      waiter_id: sr.waiterId || null,
      request_type: sr.requestType,
      status: sr.status,
      notes: sr.notes || null,
      created_at: sr.createdAt,
      updated_at: sr.updatedAt,
    })),
    bills: snapshot.bills.map((b) => ({
      id: b.id,
      bill_number: b.billNumber,
      session_id: b.sessionId,
      table_id: b.tableId,
      table_number: b.tableNumber,
      order_ids_json: JSON.stringify(b.orderIds || []),
      items_json: JSON.stringify(b.items || []),
      subtotal: Number(b.subtotal),
      tax_amount: Number(b.taxAmount),
      service_charge_amount: Number(b.serviceChargeAmount),
      discount_amount: Number(b.discountAmount),
      total_amount: Number(b.totalAmount),
      paid_amount: Number(b.paidAmount),
      balance_amount: Number(b.balanceAmount),
      status: b.status,
      split_count: Number(b.splitCount || 1),
      adjustments_json: JSON.stringify(b.adjustments || []),
      created_at: b.createdAt,
      updated_at: b.updatedAt,
    })),
    payments: snapshot.payments.map((p) => ({
      id: p.id,
      bill_id: p.billId,
      bill_number: p.billNumber,
      session_id: p.sessionId,
      table_number: p.tableNumber,
      amount: Number(p.amount),
      method: p.method,
      reference: p.reference || null,
      recorded_by_id: p.recordedById,
      recorded_by_name: p.recordedByName,
      created_at: p.createdAt,
    })),
    inventory_items: snapshot.inventory.map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      category: i.category,
      unit: i.unit,
      current_stock: Number(i.currentStock),
      min_stock: Number(i.minStock),
      cost_per_unit: Number(i.costPerUnit),
      supplier_id: i.supplierId || null,
      supplier_name: i.supplierName || null,
      expiry_date: i.expiryDate || null,
      updated_at: i.updatedAt,
    })),
    inventory_movements: snapshot.inventoryMovements.map((m) => ({
      id: m.id,
      item_id: m.itemId,
      item_name: m.itemName,
      type: m.type,
      quantity: Number(m.quantity),
      unit: m.unit,
      reason: m.reason || '',
      actor_name: m.actorName,
      created_at: m.createdAt,
    })),
    suppliers: snapshot.suppliers.map((sup) => ({
      id: sup.id,
      name: sup.name,
      contact_name: sup.contactName,
      phone: sup.phone || '',
      email: sup.email || '',
      category: sup.category || '',
    })),
    purchase_orders: snapshot.purchaseOrders.map((po) => ({
      id: po.id,
      po_number: po.poNumber,
      supplier_id: po.supplierId,
      supplier_name: po.supplierName,
      status: po.status,
      items_json: JSON.stringify(po.items || []),
      total_cost: Number(po.totalCost),
      created_at: po.createdAt,
    })),
    recipes: snapshot.recipes.map((r) => ({
      id: r.id,
      menu_item_id: r.menuItemId,
      menu_item_name: r.menuItemName,
      ingredients_json: JSON.stringify(r.ingredients || []),
    })),
    online_platforms: snapshot.platforms.map((pl) => ({
      id: pl.id,
      platform: pl.platform,
      display_name: pl.displayName,
      connection_status: pl.connectionStatus,
      outlet_id: pl.outletId || '',
      webhook_endpoint: pl.webhookEndpoint || '',
      auto_accept_orders: Boolean(pl.autoAcceptOrders),
      menu_sync_enabled: Boolean(pl.menuSyncEnabled),
      last_sync_at: pl.lastSyncAt || null,
      last_error: pl.lastError || null,
      commission_percent: Number(pl.commissionPercent ?? 20),
      requirements_note: pl.requirementsNote || '',
    })),
    integration_events: snapshot.integrationEvents.map((ev) => ({
      id: ev.id,
      platform: ev.platform,
      event_type: ev.eventType,
      status: ev.status,
      message: ev.message,
      created_at: ev.createdAt,
    })),
    app_notifications: snapshot.notifications.map((n) => ({
      id: n.id,
      target_roles_json: JSON.stringify(n.targetRoles || []),
      target_user_id: n.targetUserId || null,
      severity: n.severity,
      title: n.title,
      message: n.message,
      link_portal: n.linkPortal || null,
      link_tab: n.linkTab || null,
      is_read: Boolean(n.isRead),
      created_at: n.createdAt,
    })),
    audit_logs: snapshot.auditLogs.map((a) => ({
      id: a.id,
      actor_id: a.actorId,
      actor_name: a.actorName,
      actor_role: a.actorRole,
      action: a.action,
      entity_type: a.entityType,
      record_id: a.recordId,
      reason: a.reason || null,
      metadata_json: a.metadata ? JSON.stringify(a.metadata) : null,
      created_at: a.createdAt,
    })),
    restaurant_reviews: (snapshot.reviews || []).map((rv) => ({
      id: rv.id,
      session_id: rv.sessionId || null,
      table_id: rv.tableId || null,
      table_number: rv.tableNumber,
      customer_name: rv.customerName || null,
      overall_rating: Number(rv.overallRating),
      food_rating: Number(rv.foodRating),
      service_rating: Number(rv.serviceRating),
      comment: rv.comment || null,
      manager_reply: rv.managerReply || null,
      replied_by: rv.repliedBy || null,
      replied_at: rv.repliedAt || null,
      created_at: rv.createdAt,
    })),
  };
}

function diffTableRows(nextRows: SqlRow[], prevRows?: SqlRow[]): { upserts: SqlRow[]; deleteIds: string[] } {
  if (!prevRows) {
    return { upserts: nextRows, deleteIds: [] };
  }
  const prevById = new Map<string, string>();
  for (const r of prevRows) {
    prevById.set(String(r.id), JSON.stringify(r));
  }
  const nextIds = new Set<string>();
  const upserts: SqlRow[] = [];
  for (const r of nextRows) {
    const id = String(r.id);
    nextIds.add(id);
    const serialized = JSON.stringify(r);
    if (prevById.get(id) !== serialized) {
      upserts.push(r);
    }
  }
  const deleteIds: string[] = [];
  for (const id of prevById.keys()) {
    if (!nextIds.has(id)) deleteIds.push(id);
  }
  return { upserts, deleteIds };
}

export async function syncSnapshotToNormalizedTables(params: {
  backend: 'postgres' | 'supabase' | 'sqlite';
  pgPool?: Pool;
  supabase?: SupabaseClient;
  sqlite?: import('node:sqlite').DatabaseSync;
  next: RestaurantSnapshot;
  prev?: RestaurantSnapshot | null;
}): Promise<void> {
  const nextMap = buildNormalizedRows(params.next);
  const prevMap = params.prev ? buildNormalizedRows(params.prev) : null;
  const tableNames = Object.keys(nextMap);

  if (params.backend === 'supabase' && params.supabase) {
    const sb = params.supabase;
    const ops = tableNames.map(async (table) => {
      const { upserts, deleteIds } = diffTableRows(nextMap[table], prevMap?.[table]);
      if (upserts.length === 0 && deleteIds.length === 0) return;

      if (deleteIds.length > 0) {
        const del = await sb.from(table).delete().in('id', deleteIds);
        if (del.error && !isSchemaMissingError(del.error)) {
          console.warn(`Normalized delete (${table}) skipped:`, del.error.message);
        }
      }
      if (upserts.length > 0) {
        const up = await sb.from(table).upsert(upserts, { onConflict: 'id' });
        if (up.error && table === 'restaurant_reviews') {
          const legacyRows = upserts.map((r) => ({
            id: r.id,
            session_id: r.session_id || r.table_id || `table_${r.table_number}`,
            table_number: r.table_number,
            overall_rating: r.overall_rating,
            food_rating: r.food_rating,
            service_rating: r.service_rating,
            comment: r.comment,
            created_at: r.created_at,
          }));
          const retry = await sb.from(table).upsert(legacyRows, { onConflict: 'id' });
          if (retry.error && !isSchemaMissingError(retry.error)) {
            console.warn(`Normalized upsert (${table}) skipped:`, retry.error.message);
          }
        } else if (up.error && !isSchemaMissingError(up.error)) {
          console.warn(`Normalized upsert (${table}) skipped:`, up.error.message);
        }
      }
    });
    await Promise.all(ops);
    return;
  }

  if (params.backend === 'postgres' && params.pgPool) {
    const pool = params.pgPool;
    for (const table of tableNames) {
      const { upserts, deleteIds } = diffTableRows(nextMap[table], prevMap?.[table]);
      if (deleteIds.length > 0) {
        await pool.query(`DELETE FROM ${table} WHERE id = ANY($1::text[])`, [deleteIds]);
      }
      for (const row of upserts) {
        const cols = Object.keys(row);
        const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(',');
        const updates = cols
          .filter((c) => c !== 'id')
          .map((c) => `${c} = EXCLUDED.${c}`)
          .join(', ');
        await pool.query(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})
           ON CONFLICT(id) DO UPDATE SET ${updates}`,
          cols.map((c) => row[c])
        );
      }
    }
    return;
  }

  if (params.sqlite) {
    const sqlite = params.sqlite;
    for (const table of tableNames) {
      const { upserts, deleteIds } = diffTableRows(nextMap[table], prevMap?.[table]);
      for (const id of deleteIds) {
        sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      }
      for (const row of upserts) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(',');
        const updates = cols
          .filter((c) => c !== 'id')
          .map((c) => `${c} = excluded.${c}`)
          .join(', ');
        const values = cols.map((c) => {
          const val = row[c];
          if (typeof val === 'boolean') return val ? 1 : 0;
          if (val === undefined) return null;
          return val as string | number | null;
        });
        sqlite
          .prepare(
            `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})
             ON CONFLICT(id) DO UPDATE SET ${updates}`
          )
          .run(...values);
      }
    }
  }
}
