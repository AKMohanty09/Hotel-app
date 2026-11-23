export const CORE_TABLES_PG_DDL = `
CREATE TABLE IF NOT EXISTS restaurant_state (
  id TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_credentials (
  staff_id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  employee_id TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_flags (
  flag_key TEXT PRIMARY KEY,
  flag_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  request_id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  otp_plain_for_waiter_reveal_only TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  last_sent_at_ms BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  presence_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  waiter_id TEXT
);

CREATE TABLE IF NOT EXISTS otp_rate_limits (
  table_id TEXT PRIMARY KEY,
  timestamps_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  entity_id TEXT,
  file_name TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  storage_path TEXT,
  public_url TEXT,
  uploaded_by_staff_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_settings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  gst_number TEXT NOT NULL DEFAULT '',
  opening_hours TEXT NOT NULL DEFAULT '',
  currency_symbol TEXT NOT NULL DEFAULT '₹',
  tax_rate_percent DOUBLE PRECISION NOT NULL DEFAULT 5,
  service_charge_percent DOUBLE PRECISION NOT NULL DEFAULT 5,
  default_discount_limit_percent DOUBLE PRECISION NOT NULL DEFAULT 20,
  otp_expiry_seconds INTEGER NOT NULL DEFAULT 180,
  otp_resend_cooldown_seconds INTEGER NOT NULL DEFAULT 30,
  otp_max_attempts INTEGER NOT NULL DEFAULT 5,
  service_request_cooldown_seconds INTEGER NOT NULL DEFAULT 20,
  allow_split_payment BOOLEAN NOT NULL DEFAULT TRUE,
  allow_split_bill BOOLEAN NOT NULL DEFAULT TRUE,
  enable_sound_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  default_theme TEXT NOT NULL DEFAULT 'system',
  floors_json TEXT NOT NULL DEFAULT '[]',
  sections_json TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_profiles (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  employee_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  mobile TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  role TEXT NOT NULL,
  section TEXT,
  assigned_table_ids_json TEXT NOT NULL DEFAULT '[]',
  kitchen_station_id TEXT,
  shift TEXT NOT NULL DEFAULT 'Full Day',
  join_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  on_duty BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_shifts (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  table_number TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  floor TEXT NOT NULL,
  section TEXT NOT NULL,
  table_type TEXT NOT NULL DEFAULT 'regular',
  assigned_waiter_id TEXT,
  status TEXT NOT NULL DEFAULT 'Available',
  qr_token TEXT UNIQUE NOT NULL,
  qr_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS table_verifications (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  table_number TEXT NOT NULL,
  qr_token TEXT NOT NULL,
  status TEXT NOT NULL,
  presence_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  otp_verified BOOLEAN NOT NULL DEFAULT FALSE,
  waiter_id TEXT,
  waiter_name TEXT,
  session_id TEXT,
  guest_label TEXT,
  guest_count INTEGER NOT NULL DEFAULT 2,
  reason TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS table_sessions (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  table_number TEXT NOT NULL,
  verification_request_id TEXT,
  waiter_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  guest_count INTEGER NOT NULL DEFAULT 2,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'Utensils',
  sort_order INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS kitchen_stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  color TEXT NOT NULL DEFAULT '#EA580C'
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  variants_json TEXT,
  veg_type TEXT NOT NULL DEFAULT 'veg',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  is_temporarily_sold_out BOOLEAN NOT NULL DEFAULT FALSE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  prep_time_minutes INTEGER NOT NULL DEFAULT 15,
  portion_size TEXT NOT NULL DEFAULT 'Regular',
  spice_level TEXT NOT NULL DEFAULT 'Medium',
  allergens_json TEXT NOT NULL DEFAULT '[]',
  station_id TEXT NOT NULL DEFAULT 'st_main',
  photo_url TEXT NOT NULL DEFAULT '',
  modifiers_json TEXT NOT NULL DEFAULT '[]',
  tax_category TEXT NOT NULL DEFAULT 'standard',
  platform_availability_json TEXT NOT NULL DEFAULT '{}',
  schedule_note TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  channel TEXT NOT NULL,
  table_id TEXT,
  table_number TEXT,
  session_id TEXT,
  external_order_id TEXT,
  platform_fee DOUBLE PRECISION,
  packaging_notes TEXT,
  expected_pickup_at TIMESTAMPTZ,
  waiter_id TEXT,
  waiter_name TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  items_json TEXT NOT NULL DEFAULT '[]',
  subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  service_charge_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  cancellation_reason TEXT,
  remake_count INTEGER NOT NULL DEFAULT 0,
  timeline_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  channel TEXT NOT NULL,
  table_number TEXT,
  external_order_id TEXT,
  station_id TEXT NOT NULL,
  station_name TEXT NOT NULL,
  waiter_name TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'new',
  items_json TEXT NOT NULL DEFAULT '[]',
  delay_reason TEXT,
  clarification_note TEXT,
  remake_reason TEXT,
  estimated_minutes INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_requests (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  table_number TEXT NOT NULL,
  session_id TEXT,
  waiter_id TEXT,
  request_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'New',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  bill_number TEXT NOT NULL,
  session_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  table_number TEXT NOT NULL,
  order_ids_json TEXT NOT NULL DEFAULT '[]',
  items_json TEXT NOT NULL DEFAULT '[]',
  subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  service_charge_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  paid_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  balance_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  split_count INTEGER NOT NULL DEFAULT 1,
  adjustments_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  bill_number TEXT NOT NULL,
  session_id TEXT NOT NULL,
  table_number TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  recorded_by_id TEXT NOT NULL,
  recorded_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  current_stock DOUBLE PRECISION NOT NULL DEFAULT 0,
  min_stock DOUBLE PRECISION NOT NULL DEFAULT 5,
  cost_per_unit DOUBLE PRECISION NOT NULL DEFAULT 0,
  supplier_id TEXT,
  supplier_name TEXT,
  expiry_date TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  type TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ordered',
  items_json TEXT NOT NULL DEFAULT '[]',
  total_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  menu_item_id TEXT NOT NULL,
  menu_item_name TEXT NOT NULL,
  ingredients_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS online_platforms (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  display_name TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'sandbox_bridge',
  outlet_id TEXT NOT NULL DEFAULT '',
  webhook_endpoint TEXT NOT NULL DEFAULT '',
  auto_accept_orders BOOLEAN NOT NULL DEFAULT FALSE,
  menu_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  commission_percent DOUBLE PRECISION NOT NULL DEFAULT 20,
  requirements_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS integration_events (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_notifications (
  id TEXT PRIMARY KEY,
  target_roles_json TEXT NOT NULL DEFAULT '[]',
  target_user_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link_portal TEXT,
  link_tab TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS restaurant_reviews (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  table_number TEXT NOT NULL,
  overall_rating INTEGER NOT NULL,
  food_rating INTEGER NOT NULL,
  service_rating INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_category_entity ON media_assets (category, entity_id);
CREATE INDEX IF NOT EXISTS idx_orders_session_id ON orders (session_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_order_id ON kitchen_tickets (order_id);
CREATE INDEX IF NOT EXISTS idx_bills_session_id ON bills (session_id);
CREATE INDEX IF NOT EXISTS idx_payments_bill_id ON payments (bill_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
`;

export const CORE_TABLES_SQLITE_DDL = CORE_TABLES_PG_DDL
  .replace(/TIMESTAMPTZ/g, 'TEXT')
  .replace(/DOUBLE PRECISION/g, 'REAL')
  .replace(/BOOLEAN/g, 'INTEGER')
  .replace(/BIGINT/g, 'INTEGER')
  .replace(/DEFAULT TRUE/g, 'DEFAULT 1')
  .replace(/DEFAULT FALSE/g, 'DEFAULT 0')
  .replace(/DEFAULT NOW\(\)/g, "DEFAULT (datetime('now'))");

export const SUPABASE_EXTRAS_SQL = `
ALTER TABLE public.restaurant_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_reviews ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'restaurant-media',
  'restaurant-media',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

DROP POLICY IF EXISTS "Public Read Restaurant Media" ON storage.objects;
CREATE POLICY "Public Read Restaurant Media"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'restaurant-media');
`;

export function getFullSupabaseSchemaSql(): string {
  return `-- Saffron & Hearth OS — Full Supabase Database & Media Storage Schema\n${CORE_TABLES_PG_DDL.trim()}\n\n${SUPABASE_EXTRAS_SQL.trim()}\n`;
}
