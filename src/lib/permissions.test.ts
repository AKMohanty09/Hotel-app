import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessPortal,
  filterVisibleTablesForStaff,
  hasPermission,
} from './permissions';
import type { RestaurantTable, StaffProfile } from '../types/domain';

test('waiter and kitchen permissions are strictly restricted', () => {
  assert.equal(canAccessPortal('kitchen_staff', 'kitchen'), true);
  assert.equal(canAccessPortal('kitchen_staff', 'manager'), false);
  assert.equal(canAccessPortal('kitchen_staff', 'waiter'), false);
  assert.equal(hasPermission('kitchen_staff', 'view_financials'), false);
  assert.equal(hasPermission('kitchen_staff', 'manage_settings'), false);
  assert.equal(hasPermission('kitchen_staff', 'view_staff_salaries'), false);

  assert.equal(canAccessPortal('waiter', 'waiter'), true);
  assert.equal(canAccessPortal('waiter', 'manager'), false);
  assert.equal(hasPermission('waiter', 'issue_refund'), false);
  assert.equal(hasPermission('waiter', 'adjust_paid_bill'), false);
  assert.equal(hasPermission('waiter', 'confirm_table_order'), true);
  assert.equal(hasPermission('kitchen_staff', 'confirm_table_order'), false);
  assert.equal(hasPermission('cashier', 'confirm_table_order'), false);
  assert.equal(hasPermission('manager', 'manage_tables'), true);
  assert.equal(hasPermission('manager', 'confirm_table_order'), true);
});

test('waiter sees only assigned tables unless granted view_all_tables', () => {
  const tables: RestaurantTable[] = [
    {
      id: 't1',
      tableNumber: 'T-01',
      capacity: 4,
      floor: 'Ground',
      section: 'Main',
      tableType: 'regular',
      assignedWaiterId: 'stf_w1',
      status: 'Available',
      qrToken: 'tbl_abc123456789',
      qrRevoked: false,
      isArchived: false,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 't2',
      tableNumber: 'T-02',
      capacity: 4,
      floor: 'Ground',
      section: 'Patio',
      tableType: 'outdoor',
      assignedWaiterId: 'stf_w2',
      status: 'Available',
      qrToken: 'tbl_xyz123456789',
      qrRevoked: false,
      isArchived: false,
      createdAt: '',
      updatedAt: '',
    },
  ];

  const waiter1: StaffProfile = {
    id: 'stf_w1',
    uid: 'u_w1',
    employeeId: 'EMP02',
    name: 'Aarav',
    email: 'aarav@example.com',
    mobile: '9999999999',
    role: 'waiter',
    assignedTableIds: ['t1'],
    shift: 'Evening',
    joinDate: '2026-01-01',
    status: 'active',
    onDuty: true,
    createdAt: '',
    updatedAt: '',
  };

  const visible = filterVisibleTablesForStaff(tables, waiter1);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 't1');
});
