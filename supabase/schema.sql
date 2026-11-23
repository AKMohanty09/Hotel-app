-- ============================================================================
-- Saffron & Hearth OS — Full Supabase Database & Media Storage Schema
-- Safe & Idempotent: You can run this entire script even if you already ran
-- the initial 6-table script. Every app entity + uploaded photos live here.
-- ============================================================================

-- 1. Core Auth, Sessions, System Flags & Snapshot Cache
create table if not exists public.restaurant_state (
  id text primary key,
  snapshot_json text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_credentials (
  staff_id text primary key,
  email text unique not null,
  employee_id text unique not null,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_sessions (
  token_hash text primary key,
  staff_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.system_flags (
  flag_key text primary key,
  flag_value text not null
);

create table if not exists public.otp_challenges (
  request_id text primary key,
  table_id text not null,
  otp_hash text not null,
  otp_plain_for_waiter_reveal_only text not null,
  salt text not null,
  expires_at_ms bigint not null,
  last_sent_at_ms bigint not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  used boolean not null default false,
  presence_confirmed boolean not null default false,
  waiter_id text
);

create table if not exists public.otp_rate_limits (
  table_id text primary key,
  timestamps_json text not null default '[]'
);

-- 2. Uploaded Media Assets (Staff Profile Photos, Food Item Images, Restaurant Logo)
create table if not exists public.media_assets (
  id text primary key,
  category text not null,
  entity_id text,
  file_name text,
  mime_type text not null,
  byte_size integer not null,
  data_base64 text not null,
  storage_path text,
  public_url text,
  uploaded_by_staff_id text,
  created_at timestamptz not null default now()
);

-- 3. Restaurant Configuration & Staff
create table if not exists public.restaurant_settings (
  id text primary key,
  name text not null,
  tagline text not null default '',
  logo_url text not null default '',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  gst_number text not null default '',
  opening_hours text not null default '',
  currency_symbol text not null default '₹',
  tax_rate_percent double precision not null default 5,
  service_charge_percent double precision not null default 5,
  default_discount_limit_percent double precision not null default 20,
  otp_expiry_seconds integer not null default 180,
  otp_resend_cooldown_seconds integer not null default 30,
  otp_max_attempts integer not null default 5,
  service_request_cooldown_seconds integer not null default 20,
  allow_split_payment boolean not null default true,
  allow_split_bill boolean not null default true,
  enable_sound_alerts boolean not null default true,
  default_theme text not null default 'system',
  floors_json text not null default '[]',
  sections_json text not null default '[]',
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_profiles (
  id text primary key,
  uid text not null,
  employee_id text unique not null,
  name text not null,
  email text unique not null,
  mobile text not null default '',
  photo_url text,
  role text not null,
  section text,
  assigned_table_ids_json text not null default '[]',
  kitchen_station_id text,
  shift text not null default 'Full Day',
  join_date text not null,
  status text not null default 'active',
  on_duty boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_shifts (
  id text primary key,
  staff_id text not null,
  staff_name text not null,
  role text not null,
  status text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  notes text
);

-- 4. Tables, QR Verifications & Dining Sessions
create table if not exists public.restaurant_tables (
  id text primary key,
  table_number text not null,
  capacity integer not null default 4,
  floor text not null,
  section text not null,
  table_type text not null default 'regular',
  assigned_waiter_id text,
  status text not null default 'Available',
  qr_token text unique not null,
  qr_revoked boolean not null default false,
  is_archived boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.table_verifications (
  id text primary key,
  table_id text not null,
  table_number text not null,
  qr_token text not null,
  status text not null,
  presence_confirmed boolean not null default false,
  otp_verified boolean not null default false,
  waiter_id text,
  waiter_name text,
  session_id text,
  guest_label text,
  guest_count integer not null default 2,
  reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.table_sessions (
  id text primary key,
  table_id text not null,
  table_number text not null,
  verification_request_id text,
  waiter_id text,
  status text not null default 'active',
  guest_count integer not null default 2,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text
);

-- 5. Menu Categories, Kitchen Stations & Menu Items
create table if not exists public.menu_categories (
  id text primary key,
  name text not null,
  icon text not null default 'Utensils',
  sort_order integer not null default 1,
  is_active boolean not null default true
);

create table if not exists public.kitchen_stations (
  id text primary key,
  name text not null,
  code text not null,
  is_active boolean not null default true,
  color text not null default '#EA580C'
);

create table if not exists public.menu_items (
  id text primary key,
  code text not null,
  name text not null,
  description text not null default '',
  category_id text not null,
  price double precision not null default 0,
  variants_json text,
  veg_type text not null default 'veg',
  is_available boolean not null default true,
  is_temporarily_sold_out boolean not null default false,
  is_featured boolean not null default false,
  prep_time_minutes integer not null default 15,
  portion_size text not null default 'Regular',
  spice_level text not null default 'Medium',
  allergens_json text not null default '[]',
  station_id text not null default 'st_main',
  photo_url text not null default '',
  modifiers_json text not null default '[]',
  tax_category text not null default 'standard',
  platform_availability_json text not null default '{}',
  schedule_note text
);

-- 6. Orders, Kitchen Tickets, Service Requests, Bills & Payments
create table if not exists public.orders (
  id text primary key,
  order_number text not null,
  channel text not null,
  table_id text,
  table_number text,
  session_id text,
  external_order_id text,
  platform_fee double precision,
  packaging_notes text,
  expected_pickup_at timestamptz,
  waiter_id text,
  waiter_name text,
  status text not null,
  priority text not null default 'normal',
  items_json text not null default '[]',
  subtotal double precision not null default 0,
  tax_amount double precision not null default 0,
  service_charge_amount double precision not null default 0,
  discount_amount double precision not null default 0,
  total_amount double precision not null default 0,
  payment_status text not null default 'unpaid',
  cancellation_reason text,
  remake_count integer not null default 0,
  timeline_json text not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kitchen_tickets (
  id text primary key,
  order_id text not null,
  order_number text not null,
  channel text not null,
  table_number text,
  external_order_id text,
  station_id text not null,
  station_name text not null,
  waiter_name text,
  priority text not null default 'normal',
  status text not null default 'new',
  items_json text not null default '[]',
  delay_reason text,
  clarification_note text,
  remake_reason text,
  estimated_minutes integer not null default 15,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_requests (
  id text primary key,
  table_id text not null,
  table_number text not null,
  session_id text,
  waiter_id text,
  request_type text not null,
  status text not null default 'New',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bills (
  id text primary key,
  bill_number text not null,
  session_id text not null,
  table_id text not null,
  table_number text not null,
  order_ids_json text not null default '[]',
  items_json text not null default '[]',
  subtotal double precision not null default 0,
  tax_amount double precision not null default 0,
  service_charge_amount double precision not null default 0,
  discount_amount double precision not null default 0,
  total_amount double precision not null default 0,
  paid_amount double precision not null default 0,
  balance_amount double precision not null default 0,
  status text not null default 'open',
  split_count integer not null default 1,
  adjustments_json text not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id text primary key,
  bill_id text not null,
  bill_number text not null,
  session_id text not null,
  table_number text not null,
  amount double precision not null,
  method text not null,
  reference text,
  recorded_by_id text not null,
  recorded_by_name text not null,
  created_at timestamptz not null default now()
);

-- 7. Inventory, Suppliers, Purchase Orders & Recipes
create table if not exists public.inventory_items (
  id text primary key,
  name text not null,
  sku text not null,
  category text not null,
  unit text not null,
  current_stock double precision not null default 0,
  min_stock double precision not null default 5,
  cost_per_unit double precision not null default 0,
  supplier_id text,
  supplier_name text,
  expiry_date text,
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id text primary key,
  item_id text not null,
  item_name text not null,
  type text not null,
  quantity double precision not null,
  unit text not null,
  reason text not null default '',
  actor_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id text primary key,
  name text not null,
  contact_name text not null,
  phone text not null default '',
  email text not null default '',
  category text not null default ''
);

create table if not exists public.purchase_orders (
  id text primary key,
  po_number text not null,
  supplier_id text not null,
  supplier_name text not null,
  status text not null default 'ordered',
  items_json text not null default '[]',
  total_cost double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id text primary key,
  menu_item_id text not null,
  menu_item_name text not null,
  ingredients_json text not null default '[]'
);

-- 8. Integrations, Notifications, Audit Logs & Guest Reviews
create table if not exists public.online_platforms (
  id text primary key,
  platform text not null,
  display_name text not null,
  connection_status text not null default 'sandbox_bridge',
  outlet_id text not null default '',
  webhook_endpoint text not null default '',
  auto_accept_orders boolean not null default false,
  menu_sync_enabled boolean not null default false,
  last_sync_at timestamptz,
  last_error text,
  commission_percent double precision not null default 20,
  requirements_note text not null default ''
);

create table if not exists public.integration_events (
  id text primary key,
  platform text not null,
  event_type text not null,
  status text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_notifications (
  id text primary key,
  target_roles_json text not null default '[]',
  target_user_id text,
  severity text not null default 'info',
  title text not null,
  message text not null,
  link_portal text,
  link_tab text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id text primary key,
  actor_id text not null,
  actor_name text not null,
  actor_role text not null,
  action text not null,
  entity_type text not null,
  record_id text not null,
  reason text,
  metadata_json text,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_reviews (
  id text primary key,
  session_id text not null,
  table_number text not null,
  overall_rating integer not null,
  food_rating integer not null,
  service_rating integer not null,
  comment text,
  created_at timestamptz not null default now()
);

-- 9. Performance Indexes
create index if not exists idx_media_assets_category_entity on public.media_assets (category, entity_id);
create index if not exists idx_orders_session_id on public.orders (session_id);
create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_kitchen_tickets_order_id on public.kitchen_tickets (order_id);
create index if not exists idx_bills_session_id on public.bills (session_id);
create index if not exists idx_payments_bill_id on public.payments (bill_id);
create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at desc);

-- 10. Row Level Security (Backend uses service_role key; anon/public PostgREST blocked)
alter table public.restaurant_state enable row level security;
alter table public.staff_credentials enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.system_flags enable row level security;
alter table public.otp_challenges enable row level security;
alter table public.otp_rate_limits enable row level security;
alter table public.media_assets enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_shifts enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.table_verifications enable row level security;
alter table public.table_sessions enable row level security;
alter table public.menu_categories enable row level security;
alter table public.kitchen_stations enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.kitchen_tickets enable row level security;
alter table public.service_requests enable row level security;
alter table public.bills enable row level security;
alter table public.payments enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.recipes enable row level security;
alter table public.online_platforms enable row level security;
alter table public.integration_events enable row level security;
alter table public.app_notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.restaurant_reviews enable row level security;

-- 11. Supabase Storage Bucket for Uploaded Staff Profile Photos, Dish Photos & Logos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-media',
  'restaurant-media',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

drop policy if exists "Public Read Restaurant Media" on storage.objects;
create policy "Public Read Restaurant Media"
  on storage.objects
  for select
  using (bucket_id = 'restaurant-media');

-- 12. Supabase Realtime Publication (Idempotent across existing databases)
do $$
declare
  tbl text;
  rt_tables text[] := array[
    'restaurant_settings',
    'staff_profiles',
    'staff_shifts',
    'restaurant_tables',
    'table_verifications',
    'table_sessions',
    'menu_categories',
    'kitchen_stations',
    'menu_items',
    'orders',
    'kitchen_tickets',
    'service_requests',
    'bills',
    'payments',
    'inventory_items',
    'online_platforms',
    'integration_events',
    'app_notifications',
    'restaurant_reviews'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array rt_tables loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      exception
        when duplicate_object then null;
        when others then null;
      end;
    end loop;
  end if;
end $$;

-- 13. Scoped RLS SELECT Policies for Realtime Subscriptions
-- Note: staff_credentials, auth_sessions, system_flags, otp_challenges, and otp_rate_limits
-- intentionally have NO public/JWT policies and remain service_role only.

drop policy if exists "Public Read Active Menu Categories" on public.menu_categories;
create policy "Public Read Active Menu Categories"
  on public.menu_categories for select using (true);

drop policy if exists "Public Read Active Kitchen Stations" on public.kitchen_stations;
create policy "Public Read Active Kitchen Stations"
  on public.kitchen_stations for select using (true);

drop policy if exists "Public Read Menu Items" on public.menu_items;
create policy "Public Read Menu Items"
  on public.menu_items for select using (true);

drop policy if exists "Staff Scoped Read Settings" on public.restaurant_settings;
create policy "Staff Scoped Read Settings"
  on public.restaurant_settings for select
  using ((auth.jwt() ->> 'app_scope') = 'staff');

drop policy if exists "Manager Read Staff Profiles" on public.staff_profiles;
create policy "Manager Read Staff Profiles"
  on public.staff_profiles for select
  using (
    (auth.jwt() ->> 'app_scope') = 'staff'
    and (
      (auth.jwt() ->> 'staff_role') in ('owner', 'manager', 'shift_supervisor')
      or id = (auth.jwt() ->> 'staff_id')
    )
  );

drop policy if exists "Staff Scoped Read Shifts" on public.staff_shifts;
create policy "Staff Scoped Read Shifts"
  on public.staff_shifts for select
  using ((auth.jwt() ->> 'app_scope') = 'staff');

drop policy if exists "Scoped Read Restaurant Tables" on public.restaurant_tables;
create policy "Scoped Read Restaurant Tables"
  on public.restaurant_tables for select
  using (
    (auth.jwt() ->> 'app_scope') = 'staff'
    or (
      (auth.jwt() ->> 'app_scope') = 'customer'
      and id = (auth.jwt() ->> 'table_id')
    )
  );

drop policy if exists "Scoped Read Table Verifications" on public.table_verifications;
create policy "Scoped Read Table Verifications"
  on public.table_verifications for select
  using (
    (auth.jwt() ->> 'app_scope') = 'staff'
    or (
      (auth.jwt() ->> 'app_scope') = 'customer'
      and table_id = (auth.jwt() ->> 'table_id')
    )
  );

drop policy if exists "Scoped Read Table Sessions" on public.table_sessions;
create policy "Scoped Read Table Sessions"
  on public.table_sessions for select
  using (
    (auth.jwt() ->> 'app_scope') = 'staff'
    or (
      (auth.jwt() ->> 'app_scope') = 'customer'
      and table_id = (auth.jwt() ->> 'table_id')
    )
  );

drop policy if exists "Scoped Read Orders" on public.orders;
create policy "Scoped Read Orders"
  on public.orders for select
  using (
    (auth.jwt() ->> 'app_scope') = 'staff'
    or (
      (auth.jwt() ->> 'app_scope') = 'customer'
      and table_id = (auth.jwt() ->> 'table_id')
    )
  );

drop policy if exists "Staff Scoped Read Kitchen Tickets" on public.kitchen_tickets;
create policy "Staff Scoped Read Kitchen Tickets"
  on public.kitchen_tickets for select
  using ((auth.jwt() ->> 'app_scope') = 'staff');

drop policy if exists "Scoped Read Service Requests" on public.service_requests;
create policy "Scoped Read Service Requests"
  on public.service_requests for select
  using (
    (auth.jwt() ->> 'app_scope') = 'staff'
    or (
      (auth.jwt() ->> 'app_scope') = 'customer'
      and table_id = (auth.jwt() ->> 'table_id')
    )
  );

drop policy if exists "Scoped Read Bills" on public.bills;
create policy "Scoped Read Bills"
  on public.bills for select
  using (
    (auth.jwt() ->> 'app_scope') = 'staff'
    or (
      (auth.jwt() ->> 'app_scope') = 'customer'
      and table_id = (auth.jwt() ->> 'table_id')
    )
  );

drop policy if exists "Staff Scoped Read Payments" on public.payments;
create policy "Staff Scoped Read Payments"
  on public.payments for select
  using ((auth.jwt() ->> 'app_scope') = 'staff');

drop policy if exists "Staff Scoped Read Inventory" on public.inventory_items;
create policy "Staff Scoped Read Inventory"
  on public.inventory_items for select
  using ((auth.jwt() ->> 'app_scope') = 'staff');

drop policy if exists "Staff Scoped Read Online Platforms" on public.online_platforms;
create policy "Staff Scoped Read Online Platforms"
  on public.online_platforms for select
  using ((auth.jwt() ->> 'app_scope') = 'staff');

drop policy if exists "Staff Scoped Read Integration Events" on public.integration_events;
create policy "Staff Scoped Read Integration Events"
  on public.integration_events for select
  using ((auth.jwt() ->> 'app_scope') = 'staff');

drop policy if exists "Staff Scoped Read Notifications" on public.app_notifications;
create policy "Staff Scoped Read Notifications"
  on public.app_notifications for select
  using ((auth.jwt() ->> 'app_scope') = 'staff');

drop policy if exists "Manager Scoped Read Audit Logs" on public.audit_logs;
create policy "Manager Scoped Read Audit Logs"
  on public.audit_logs for select
  using (
    (auth.jwt() ->> 'app_scope') = 'staff'
    and (auth.jwt() ->> 'staff_role') in ('owner', 'manager')
  );

drop policy if exists "Staff Scoped Read Reviews" on public.restaurant_reviews;
create policy "Staff Scoped Read Reviews"
  on public.restaurant_reviews for select
  using ((auth.jwt() ->> 'app_scope') = 'staff');
