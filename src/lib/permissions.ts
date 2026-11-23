import type { PortalKey, RestaurantTable, StaffProfile, StaffRole } from '../types/domain';

export type Permission =
  | 'view_dashboard'
  | 'view_financials'
  | 'manage_tables'
  | 'revoke_qr'
  | 'manage_menu'
  | 'manage_staff'
  | 'view_staff_salaries'
  | 'manage_inventory'
  | 'view_reports'
  | 'manage_settings'
  | 'manage_integrations'
  | 'view_audit_logs'
  | 'view_all_tables'
  | 'verify_customer_presence'
  | 'place_waiter_order'
  | 'serve_food'
  | 'handle_service_requests'
  | 'generate_bill'
  | 'record_payment'
  | 'apply_discount'
  | 'issue_refund'
  | 'adjust_paid_bill'
  | 'access_kitchen_kds'
  | 'update_kitchen_ticket'
  | 'confirm_table_order'
  | 'cancel_order'
  | 'manage_reviews';

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  owner: [
    'view_dashboard',
    'view_financials',
    'manage_tables',
    'revoke_qr',
    'manage_menu',
    'manage_staff',
    'view_staff_salaries',
    'manage_inventory',
    'view_reports',
    'manage_settings',
    'manage_integrations',
    'view_audit_logs',
    'view_all_tables',
    'verify_customer_presence',
    'place_waiter_order',
    'serve_food',
    'handle_service_requests',
    'generate_bill',
    'record_payment',
    'apply_discount',
    'issue_refund',
    'adjust_paid_bill',
    'access_kitchen_kds',
    'update_kitchen_ticket',
    'confirm_table_order',
    'cancel_order',
    'manage_reviews',
  ],
  manager: [
    'view_dashboard',
    'view_financials',
    'manage_tables',
    'revoke_qr',
    'manage_menu',
    'manage_staff',
    'manage_inventory',
    'view_reports',
    'manage_settings',
    'manage_integrations',
    'view_audit_logs',
    'view_all_tables',
    'verify_customer_presence',
    'place_waiter_order',
    'serve_food',
    'handle_service_requests',
    'generate_bill',
    'record_payment',
    'apply_discount',
    'issue_refund',
    'adjust_paid_bill',
    'access_kitchen_kds',
    'update_kitchen_ticket',
    'confirm_table_order',
    'cancel_order',
    'manage_reviews',
  ],
  shift_supervisor: [
    'view_dashboard',
    'view_all_tables',
    'verify_customer_presence',
    'place_waiter_order',
    'serve_food',
    'handle_service_requests',
    'generate_bill',
    'record_payment',
    'apply_discount',
    'access_kitchen_kds',
    'confirm_table_order',
    'cancel_order',
  ],
  waiter: [
    'verify_customer_presence',
    'place_waiter_order',
    'serve_food',
    'handle_service_requests',
    'generate_bill',
    'record_payment',
    'confirm_table_order',
  ],
  cashier: [
    'view_all_tables',
    'generate_bill',
    'record_payment',
    'apply_discount',
    'view_reports',
  ],
  kitchen_supervisor: [
    'access_kitchen_kds',
    'update_kitchen_ticket',
    'manage_inventory',
  ],
  kitchen_staff: ['access_kitchen_kds', 'update_kitchen_ticket'],
};

export function hasPermission(role: StaffRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAccessPortal(role: StaffRole | null | undefined, portal: PortalKey): boolean {
  if (portal === 'customer') return true;
  if (!role) return false;
  if (role === 'owner' || role === 'manager') return true;
  if (portal === 'manager') return role === 'shift_supervisor' || role === 'cashier';
  if (portal === 'waiter') return role === 'waiter' || role === 'shift_supervisor' || role === 'cashier';
  if (portal === 'kitchen') return role === 'kitchen_staff' || role === 'kitchen_supervisor';
  return false;
}

export function getDefaultPortalForRole(role: StaffRole): PortalKey {
  if (role === 'kitchen_staff' || role === 'kitchen_supervisor') return 'kitchen';
  if (role === 'waiter') return 'waiter';
  return 'manager';
}

export function filterVisibleTablesForStaff(
  tables: RestaurantTable[],
  staff: StaffProfile | null | undefined
): RestaurantTable[] {
  const activeTables = tables.filter((t) => !t.isArchived);
  if (!staff) return [];
  if (hasPermission(staff.role, 'view_all_tables')) {
    return activeTables;
  }
  // Waiters see only their assigned tables (or tables matching their assigned section when explicitly bound)
  return activeTables.filter(
    (t) =>
      t.assignedWaiterId === staff.id ||
      t.assignedWaiterId === staff.uid ||
      staff.assignedTableIds.includes(t.id)
  );
}
