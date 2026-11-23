import React, { useState } from 'react';
import {
  BarChart3,
  ChefHat,
  ClipboardList,
  Globe,
  LayoutDashboard,
  Package,
  QrCode,
  Receipt,
  Settings,
  Shield,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import type { RestaurantSnapshot, StaffProfile } from '../../types/domain';
import { hasPermission } from '../../lib/permissions';
import { ManagerDashboard } from './ManagerDashboard';
import { ManagerTables } from './ManagerTables';
import { ManagerOrdersAndOnline } from './ManagerOrdersAndOnline';
import { ManagerMenuAndInventory } from './ManagerMenuAndInventory';
import { ManagerBillingReportsStaff } from './ManagerBillingReportsStaff';
import { StaffAvatar } from '../common/StaffAvatar';
import { KitchenPortal } from '../kitchen/KitchenPortal';

interface ManagerPortalProps {
  snapshot: RestaurantSnapshot;
  currentStaff: StaffProfile;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  onRefresh: () => Promise<void>;
  onOpenCustomerPreview: (qrToken: string) => void;
}

export type ManagerTabId =
  | 'dashboard'
  | 'tables'
  | 'orders'
  | 'online'
  | 'menu'
  | 'kitchen'
  | 'billing'
  | 'inventory'
  | 'reports'
  | 'staff'
  | 'audit'
  | 'settings';

export const ManagerPortal: React.FC<ManagerPortalProps> = ({
  snapshot,
  currentStaff,
  sidebarOpen,
  onCloseSidebar,
  onRefresh,
  onOpenCustomerPreview,
}) => {
  const [activeTab, setActiveTab] = useState<ManagerTabId>('dashboard');

  const navItems: {
    id: ManagerTabId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    allowed: boolean;
  }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, allowed: true },
    {
      id: 'tables',
      label: 'Tables & QR',
      icon: QrCode,
      allowed: hasPermission(currentStaff.role, 'manage_tables') || hasPermission(currentStaff.role, 'view_all_tables'),
    },
    { id: 'orders', label: 'Orders', icon: ClipboardList, allowed: true },
    {
      id: 'online',
      label: 'Online & Swiggy/Zomato',
      icon: Globe,
      allowed: hasPermission(currentStaff.role, 'manage_integrations') || hasPermission(currentStaff.role, 'view_all_tables'),
    },
    {
      id: 'menu',
      label: 'Menu Catalog',
      icon: Utensils,
      allowed: hasPermission(currentStaff.role, 'manage_menu'),
    },
    {
      id: 'kitchen',
      label: 'Kitchen Monitor',
      icon: ChefHat,
      allowed: hasPermission(currentStaff.role, 'access_kitchen_kds'),
    },
    {
      id: 'billing',
      label: 'Billing & Payments',
      icon: Receipt,
      allowed: hasPermission(currentStaff.role, 'generate_bill'),
    },
    {
      id: 'inventory',
      label: 'Inventory & POs',
      icon: Package,
      allowed: hasPermission(currentStaff.role, 'manage_inventory'),
    },
    {
      id: 'reports',
      label: 'Reports & Export',
      icon: BarChart3,
      allowed: hasPermission(currentStaff.role, 'view_reports'),
    },
    {
      id: 'staff',
      label: 'Staff & Shifts',
      icon: Users,
      allowed: hasPermission(currentStaff.role, 'manage_staff'),
    },
    {
      id: 'audit',
      label: 'Audit Logs',
      icon: Shield,
      allowed: hasPermission(currentStaff.role, 'view_audit_logs'),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      allowed: hasPermission(currentStaff.role, 'manage_settings'),
    },
  ];

  const visibleNav = navItems.filter((n) => n.allowed);
  const activeItem = visibleNav.find((n) => n.id === activeTab) || visibleNav[0];

  const selectTab = (id: ManagerTabId) => {
    setActiveTab(id);
    onCloseSidebar();
  };

  return (
    <div className="flex min-h-[calc(100vh-56px)] bg-slate-50 dark:bg-slate-950">
      {/* Mobile Sidebar Backdrop (anchored below top header) */}
      {sidebarOpen && (
        <div
          className="fixed inset-x-0 top-14 bottom-0 z-30 bg-slate-950/50 lg:hidden"
          onClick={onCloseSidebar}
        />
      )}

      {/* Left Navigation Sidebar — anchored cleanly beneath the h-14 header */}
      <aside
        className={`fixed top-14 bottom-0 left-0 z-30 w-[248px] shrink-0 bg-slate-900 dark:bg-slate-900 border-r border-slate-800 text-slate-100 flex flex-col transition-transform duration-200 lg:sticky lg:top-14 lg:h-[calc(100vh-56px)] lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 lg:hidden">
          <span className="font-display text-xs font-bold uppercase tracking-wider text-slate-300">
            Manager Sections
          </span>
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={onCloseSidebar}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Manager sections">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeItem?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4 flex items-center gap-3 text-[11px] text-slate-400">
          <StaffAvatar name={currentStaff.name} photoUrl={currentStaff.photoUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-slate-200 truncate">{currentStaff.name}</div>
            <div className="uppercase tracking-wider mt-0.5 truncate">{currentStaff.role.replace('_', ' ')}</div>
          </div>
        </div>
      </aside>

      {/* Main Content Canvas */}
      <main className="min-w-0 flex-1 p-4 sm:p-5 lg:p-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {activeItem?.label || 'Dashboard'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {snapshot.settings.name} · Live operational database
            </p>
          </div>
        </div>

        {activeItem?.id === 'dashboard' && (
          <ManagerDashboard
            snapshot={snapshot}
            onNavigateTab={(tab) => setActiveTab(tab as ManagerTabId)}
          />
        )}
        {activeItem?.id === 'tables' && (
          <ManagerTables
            snapshot={snapshot}
            onRefresh={onRefresh}
            onOpenCustomerPreview={onOpenCustomerPreview}
          />
        )}
        {activeItem?.id === 'orders' && (
          <ManagerOrdersAndOnline snapshot={snapshot} mode="orders" onRefresh={onRefresh} />
        )}
        {activeItem?.id === 'online' && (
          <ManagerOrdersAndOnline snapshot={snapshot} mode="online" onRefresh={onRefresh} />
        )}
        {activeItem?.id === 'menu' && (
          <ManagerMenuAndInventory snapshot={snapshot} mode="menu" onRefresh={onRefresh} />
        )}
        {activeItem?.id === 'kitchen' && (
          <div className="rounded-2xl overflow-hidden border border-slate-800">
            <KitchenPortal snapshot={snapshot} onRefresh={onRefresh} />
          </div>
        )}
        {activeItem?.id === 'billing' && (
          <ManagerBillingReportsStaff
            snapshot={snapshot}
            currentStaff={currentStaff}
            section="billing"
            onRefresh={onRefresh}
          />
        )}
        {activeItem?.id === 'inventory' && (
          <ManagerMenuAndInventory snapshot={snapshot} mode="inventory" onRefresh={onRefresh} />
        )}
        {activeItem?.id === 'reports' && (
          <ManagerBillingReportsStaff
            snapshot={snapshot}
            currentStaff={currentStaff}
            section="reports"
            onRefresh={onRefresh}
          />
        )}
        {activeItem?.id === 'staff' && (
          <ManagerBillingReportsStaff
            snapshot={snapshot}
            currentStaff={currentStaff}
            section="staff"
            onRefresh={onRefresh}
          />
        )}
        {activeItem?.id === 'audit' && (
          <ManagerBillingReportsStaff
            snapshot={snapshot}
            currentStaff={currentStaff}
            section="audit"
            onRefresh={onRefresh}
          />
        )}
        {activeItem?.id === 'settings' && (
          <ManagerBillingReportsStaff
            snapshot={snapshot}
            currentStaff={currentStaff}
            section="settings"
            onRefresh={onRefresh}
          />
        )}
      </main>
    </div>
  );
};
