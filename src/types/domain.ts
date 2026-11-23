export type StaffRole =
  | 'owner'
  | 'manager'
  | 'shift_supervisor'
  | 'waiter'
  | 'kitchen_supervisor'
  | 'kitchen_staff'
  | 'cashier';

export type PortalKey = 'manager' | 'waiter' | 'kitchen' | 'customer';

export type TableType = 'regular' | 'couple' | 'family' | 'outdoor' | 'vip';

export type TableStatus =
  | 'Available'
  | 'Reserved'
  | 'Verification Pending'
  | 'Occupied'
  | 'Ordering'
  | 'Order Active'
  | 'Preparing'
  | 'Food Ready'
  | 'Bill Requested'
  | 'Payment Pending'
  | 'Cleaning'
  | 'Blocked';

export type OrderChannel =
  | 'dine_in_qr'
  | 'waiter'
  | 'swiggy'
  | 'zomato'
  | 'takeaway'
  | 'direct_online';

export type OrderStatus =
  | 'Draft'
  | 'Submitted'
  | 'Confirmed'
  | 'Preparing'
  | 'Partially Ready'
  | 'Ready'
  | 'Served'
  | 'Packed'
  | 'Picked Up'
  | 'Completed'
  | 'Cancelled';

export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded';
export type PaymentMethod = 'cash' | 'upi' | 'card';
export type OrderPriority = 'normal' | 'rush' | 'vip';

export type TicketStatus =
  | 'new'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'delayed'
  | 'served'
  | 'packed'
  | 'picked_up'
  | 'cancelled';

export type ServiceRequestType =
  | 'Call Waiter'
  | 'Water'
  | 'Extra Plates'
  | 'Cutlery'
  | 'Napkins'
  | 'Sauce'
  | 'Bill'
  | 'Help'
  | 'Other';

export type ServiceRequestStatus = 'New' | 'Accepted' | 'Completed' | 'Unavailable';

export interface RestaurantSettings {
  id: string;
  name: string;
  tagline: string;
  logoUrl: string;
  address: string;
  phone: string;
  email: string;
  gstNumber: string;
  openingHours: string;
  currencySymbol: string;
  taxRatePercent: number;
  serviceChargePercent: number;
  defaultDiscountLimitPercent: number;
  otpExpirySeconds: number;
  otpResendCooldownSeconds: number;
  otpMaxAttempts: number;
  serviceRequestCooldownSeconds: number;
  allowSplitPayment: boolean;
  allowSplitBill: boolean;
  enableSoundAlerts: boolean;
  defaultTheme?: 'system' | 'light' | 'dark';
  floors: string[];
  sections: string[];
  updatedAt: string;
}

export interface StaffProfile {
  id: string;
  uid: string;
  employeeId: string;
  name: string;
  email: string;
  mobile: string;
  photoUrl?: string;
  role: StaffRole;
  section?: string;
  assignedTableIds: string[];
  kitchenStationId?: string;
  shift: 'Morning' | 'Afternoon' | 'Evening' | 'Full Day';
  joinDate: string;
  status: 'active' | 'on_leave' | 'inactive';
  onDuty: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StaffShiftLog {
  id: string;
  staffId: string;
  staffName: string;
  role: StaffRole;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt?: string;
  notes?: string;
}

export interface RestaurantTable {
  id: string;
  tableNumber: string;
  capacity: number;
  floor: string;
  section: string;
  tableType: TableType;
  assignedWaiterId?: string;
  status: TableStatus;
  qrToken: string;
  qrRevoked: boolean;
  isArchived: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableVerificationRequest {
  id: string;
  tableId: string;
  tableNumber: string;
  qrToken: string;
  status: 'pending' | 'presence_confirmed' | 'verified' | 'rejected' | 'expired';
  presenceConfirmed: boolean;
  otpVerified: boolean;
  waiterId?: string;
  waiterName?: string;
  sessionId?: string;
  guestLabel?: string;
  guestCount: number;
  reason?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableSession {
  id: string;
  tableId: string;
  tableNumber: string;
  verificationRequestId?: string;
  waiterId?: string;
  status: 'active' | 'bill_requested' | 'payment_pending' | 'closed';
  guestCount: number;
  startedAt: string;
  closedAt?: string;
  notes?: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
}

export interface MenuItemModifier {
  id: string;
  name: string;
  priceDelta: number;
  groupName?: string;
}

export interface MenuItemVariant {
  id: string;
  name: string;
  price: number;
}

export interface MenuItem {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryId: string;
  price: number;
  variants?: MenuItemVariant[];
  vegType: 'veg' | 'non_veg' | 'vegan';
  isAvailable: boolean;
  isTemporarilySoldOut: boolean;
  isFeatured: boolean;
  prepTimeMinutes: number;
  portionSize: string;
  spiceLevel: 'Mild' | 'Medium' | 'Spicy' | 'Extra Hot' | 'None';
  allergens: string[];
  stationId: string;
  photoUrl: string;
  modifiers: MenuItemModifier[];
  taxCategory: 'standard' | 'zero' | 'beverage';
  platformAvailability: {
    dineIn: boolean;
    swiggy: boolean;
    zomato: boolean;
    takeaway: boolean;
  };
  scheduleNote?: string;
}

export interface KitchenStation {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  color: string;
}

export interface OrderItemModifierSelection {
  modifierId: string;
  name: string;
  priceDelta: number;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  code: string;
  name: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  modifiers: OrderItemModifierSelection[];
  lineTotal: number;
  instructions?: string;
  stationId: string;
  allergens?: string[];
  prepTimeMinutes: number;
  status: 'queued' | 'preparing' | 'ready' | 'served' | 'cancelled';
}

export interface OrderStatusEvent {
  status: OrderStatus;
  actorId: string;
  actorName: string;
  note?: string;
  timestamp: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  channel: OrderChannel;
  tableId?: string;
  tableNumber?: string;
  sessionId?: string;
  externalOrderId?: string;
  platformFee?: number;
  packagingNotes?: string;
  expectedPickupAt?: string;
  waiterId?: string;
  waiterName?: string;
  status: OrderStatus;
  priority: OrderPriority;
  items: OrderItem[];
  subtotal: number;
  taxAmount: number;
  serviceChargeAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  cancellationReason?: string;
  remakeCount: number;
  timeline: OrderStatusEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface KitchenTicketItem {
  orderItemId: string;
  name: string;
  quantity: number;
  modifiers: string[];
  instructions?: string;
  allergens?: string[];
  status: 'new' | 'preparing' | 'ready' | 'cancelled';
}

export interface KitchenTicket {
  id: string;
  orderId: string;
  orderNumber: string;
  channel: OrderChannel;
  tableNumber?: string;
  externalOrderId?: string;
  stationId: string;
  stationName: string;
  waiterName?: string;
  priority: OrderPriority;
  status: TicketStatus;
  items: KitchenTicketItem[];
  delayReason?: string;
  clarificationNote?: string;
  remakeReason?: string;
  estimatedMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerServiceRequest {
  id: string;
  tableId: string;
  tableNumber: string;
  sessionId?: string;
  waiterId?: string;
  requestType: ServiceRequestType;
  status: ServiceRequestStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillItem {
  orderId: string;
  orderNumber: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PaymentAdjustment {
  id: string;
  type: 'discount' | 'correction' | 'refund';
  amount: number;
  reason: string;
  actorId: string;
  actorName: string;
  createdAt: string;
}

export interface Bill {
  id: string;
  billNumber: string;
  sessionId: string;
  tableId: string;
  tableNumber: string;
  orderIds: string[];
  items: BillItem[];
  subtotal: number;
  taxAmount: number;
  serviceChargeAmount: number;
  discountAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: 'open' | 'partial' | 'paid' | 'adjusted' | 'refunded';
  splitCount: number;
  adjustments: PaymentAdjustment[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  billId: string;
  billNumber: string;
  sessionId: string;
  tableNumber: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  recordedById: string;
  recordedByName: string;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  currentStock: number;
  minStock: number;
  costPerUnit: number;
  supplierId?: string;
  supplierName?: string;
  expiryDate?: string;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: 'in' | 'out' | 'wastage' | 'adjustment' | 'expiry';
  quantity: number;
  unit: string;
  reason: string;
  actorName: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  category: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  status: 'draft' | 'ordered' | 'received' | 'cancelled';
  items: { itemId: string; itemName: string; quantity: number; unitCost: number }[];
  totalCost: number;
  createdAt: string;
}

export interface Recipe {
  id: string;
  menuItemId: string;
  menuItemName: string;
  ingredients: { inventoryItemId: string; ingredientName: string; quantity: number; unit: string }[];
}

export interface OnlinePlatformConfig {
  id: string;
  platform: 'swiggy' | 'zomato' | 'direct_online';
  displayName: string;
  connectionStatus: 'not_configured' | 'sandbox_bridge' | 'connected' | 'error';
  outletId: string;
  webhookEndpoint: string;
  autoAcceptOrders: boolean;
  menuSyncEnabled: boolean;
  lastSyncAt?: string;
  lastError?: string;
  commissionPercent: number;
  requirementsNote: string;
}

export interface IntegrationEvent {
  id: string;
  platform: string;
  eventType: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  targetRoles: StaffRole[];
  targetUserId?: string;
  severity: 'info' | 'success' | 'warning' | 'urgent';
  title: string;
  message: string;
  linkPortal?: PortalKey;
  linkTab?: string;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  recordId: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface RestaurantReview {
  id: string;
  sessionId: string;
  tableNumber: string;
  overallRating: number;
  foodRating: number;
  serviceRating: number;
  comment?: string;
  createdAt: string;
}

export interface RestaurantSnapshot {
  settings: RestaurantSettings;
  staff: StaffProfile[];
  shifts: StaffShiftLog[];
  tables: RestaurantTable[];
  verifications: TableVerificationRequest[];
  sessions: TableSession[];
  categories: MenuCategory[];
  menuItems: MenuItem[];
  stations: KitchenStation[];
  orders: Order[];
  tickets: KitchenTicket[];
  serviceRequests: CustomerServiceRequest[];
  bills: Bill[];
  payments: PaymentRecord[];
  inventory: InventoryItem[];
  inventoryMovements: InventoryMovement[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  recipes: Recipe[];
  platforms: OnlinePlatformConfig[];
  integrationEvents: IntegrationEvent[];
  notifications: AppNotification[];
  auditLogs: AuditLog[];
  reviews: RestaurantReview[];
}
