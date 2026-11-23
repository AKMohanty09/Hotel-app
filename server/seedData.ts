import type { RestaurantSnapshot } from '../src/types/domain.ts';

export interface InitialWorkspaceOptions {
  restaurantName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
}

export function createInitialSnapshot(options?: InitialWorkspaceOptions): RestaurantSnapshot {
  const now = new Date().toISOString();
  const restaurantName = options?.restaurantName?.trim() || 'Saffron & Hearth OS';
  const ownerEmail = options?.ownerEmail?.trim().toLowerCase() || '';
  const ownerPhone = options?.ownerPhone?.trim() || '';

  return {
    settings: {
      id: 'rest_main',
      name: restaurantName,
      tagline: 'Restaurant Operations & Digital Dining',
      logoUrl: '/src/assets/images/restaurant_emblem_1795406025250.jpg',
      address: '',
      phone: ownerPhone,
      email: ownerEmail,
      gstNumber: '',
      openingHours: '09:00 AM – 11:00 PM Daily',
      currencySymbol: '₹',
      taxRatePercent: 5,
      serviceChargePercent: 5,
      defaultDiscountLimitPercent: 20,
      otpExpirySeconds: 180,
      otpResendCooldownSeconds: 30,
      otpMaxAttempts: 5,
      serviceRequestCooldownSeconds: 20,
      allowSplitPayment: true,
      allowSplitBill: true,
      enableSoundAlerts: true,
      defaultTheme: 'system',
      floors: ['Ground Floor', 'First Floor', 'Outdoor Terrace'],
      sections: ['Main Hall', 'Private Dining', 'Patio'],
      updatedAt: now,
    },
    staff: [],
    shifts: [],
    tables: [],
    verifications: [],
    sessions: [],
    categories: [],
    stations: [
      { id: 'st_main', name: 'Main Kitchen', code: 'MAIN', isActive: true, color: '#EA580C' },
      { id: 'st_tandoor', name: 'Grill & Tandoor', code: 'GRL', isActive: true, color: '#D97706' },
      { id: 'st_starters', name: 'Starters & Cold', code: 'STR', isActive: true, color: '#16A34A' },
      { id: 'st_bev', name: 'Beverages', code: 'BEV', isActive: true, color: '#0284C7' },
      { id: 'st_dessert', name: 'Desserts', code: 'DES', isActive: true, color: '#7C3AED' },
    ],
    menuItems: [],
    orders: [],
    tickets: [],
    serviceRequests: [],
    bills: [],
    payments: [],
    inventory: [],
    inventoryMovements: [],
    suppliers: [],
    purchaseOrders: [],
    recipes: [],
    platforms: [
      {
        id: 'plat_swiggy',
        platform: 'swiggy',
        displayName: 'Swiggy Partner Bridge',
        connectionStatus: 'sandbox_bridge',
        outletId: '',
        webhookEndpoint: '/api/integrations/swiggy/webhook',
        autoAcceptOrders: false,
        menuSyncEnabled: false,
        commissionPercent: 22,
        requirementsNote:
          'Configure your Swiggy Partner outlet ID and set SWIGGY_WEBHOOK_SECRET in your deployment environment variables.',
      },
      {
        id: 'plat_zomato',
        platform: 'zomato',
        displayName: 'Zomato Partner Bridge',
        connectionStatus: 'sandbox_bridge',
        outletId: '',
        webhookEndpoint: '/api/integrations/zomato/webhook',
        autoAcceptOrders: false,
        menuSyncEnabled: false,
        commissionPercent: 21,
        requirementsNote:
          'Configure your Zomato Partner outlet ID and set ZOMATO_WEBHOOK_SECRET in your deployment environment variables.',
      },
    ],
    integrationEvents: [],
    notifications: [],
    auditLogs: [],
    reviews: [],
  };
}
