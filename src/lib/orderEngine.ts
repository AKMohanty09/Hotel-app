import type {
  KitchenStation,
  KitchenTicket,
  KitchenTicketItem,
  MenuItem,
  Order,
  OrderChannel,
  OrderItem,
  OrderItemModifierSelection,
  OrderPriority,
  OrderStatus,
  RestaurantSettings,
} from '../types/domain';

export interface RequestedOrderItemInput {
  menuItemId: string;
  variantId?: string;
  quantity: number;
  modifierIds?: string[];
  instructions?: string;
}

export interface ValidatedOrderPricing {
  items: OrderItem[];
  subtotal: number;
  taxAmount: number;
  serviceChargeAmount: number;
  discountAmount: number;
  totalAmount: number;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function validateAndPriceOrderItems(
  requestedItems: RequestedOrderItemInput[],
  catalogItems: MenuItem[],
  settings: Pick<RestaurantSettings, 'taxRatePercent' | 'serviceChargePercent'>,
  channel: OrderChannel,
  discountAmount = 0
): ValidatedOrderPricing {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new Error('Order must contain at least one item.');
  }

  const catalogMap = new Map(catalogItems.map((item) => [item.id, item]));
  const builtItems: OrderItem[] = [];

  for (const req of requestedItems) {
    const qty = Math.floor(Number(req.quantity));
    if (!Number.isFinite(qty) || qty < 1 || qty > 50) {
      throw new Error('Item quantity must be between 1 and 50.');
    }
    const catalogItem = catalogMap.get(req.menuItemId);
    if (!catalogItem) {
      throw new Error(`Menu item "${req.menuItemId}" no longer exists.`);
    }
    if (!catalogItem.isAvailable || catalogItem.isTemporarilySoldOut) {
      throw new Error(`"${catalogItem.name}" is currently sold out or unavailable.`);
    }
    if (channel === 'swiggy' && !catalogItem.platformAvailability.swiggy) {
      throw new Error(`"${catalogItem.name}" is disabled for Swiggy.`);
    }
    if (channel === 'zomato' && !catalogItem.platformAvailability.zomato) {
      throw new Error(`"${catalogItem.name}" is disabled for Zomato.`);
    }

    const variants = Array.isArray(catalogItem.variants) ? catalogItem.variants : [];
    let selectedVariant = undefined as { id: string; name: string; price: number } | undefined;
    if (variants.length > 0) {
      if (req.variantId) {
        selectedVariant = variants.find((v) => v.id === req.variantId);
        if (!selectedVariant) {
          throw new Error(`Invalid size/variant "${req.variantId}" for "${catalogItem.name}".`);
        }
      } else {
        selectedVariant = variants[0];
      }
    }

    const selectedModifiers: OrderItemModifierSelection[] = [];
    const requestedModIds = req.modifierIds || [];
    for (const modId of requestedModIds) {
      const mod = catalogItem.modifiers.find((m) => m.id === modId);
      if (!mod) {
        throw new Error(`Invalid modifier "${modId}" for "${catalogItem.name}".`);
      }
      selectedModifiers.push({
        modifierId: mod.id,
        name: mod.name,
        priceDelta: mod.priceDelta,
      });
    }

    const basePrice = selectedVariant ? selectedVariant.price : catalogItem.price;
    const modifierTotal = selectedModifiers.reduce((sum, m) => sum + m.priceDelta, 0);
    const unitPrice = roundMoney(basePrice + modifierTotal);
    const lineTotal = roundMoney(unitPrice * qty);
    const itemDisplayName = selectedVariant
      ? `${catalogItem.name} (${selectedVariant.name})`
      : catalogItem.name;

    builtItems.push({
      id: `oi_${crypto.randomUUID().slice(0, 12)}`,
      menuItemId: catalogItem.id,
      code: catalogItem.code,
      name: itemDisplayName,
      variantId: selectedVariant?.id,
      variantName: selectedVariant?.name,
      quantity: qty,
      unitPrice,
      modifiers: selectedModifiers,
      lineTotal,
      instructions: req.instructions?.trim().slice(0, 200) || undefined,
      stationId: catalogItem.stationId,
      allergens: catalogItem.allergens,
      prepTimeMinutes: catalogItem.prepTimeMinutes,
      status: 'queued',
    });
  }

  const subtotal = roundMoney(builtItems.reduce((sum, i) => sum + i.lineTotal, 0));
  const safeDiscount = Math.min(Math.max(0, roundMoney(discountAmount)), subtotal);
  const taxableBase = Math.max(0, subtotal - safeDiscount);
  const taxAmount = roundMoney((taxableBase * settings.taxRatePercent) / 100);
  const isDineIn = channel === 'dine_in_qr' || channel === 'waiter';
  const serviceChargeAmount = isDineIn
    ? roundMoney((taxableBase * settings.serviceChargePercent) / 100)
    : 0;
  const totalAmount = roundMoney(taxableBase + taxAmount + serviceChargeAmount);

  return {
    items: builtItems,
    subtotal,
    taxAmount,
    serviceChargeAmount,
    discountAmount: safeDiscount,
    totalAmount,
  };
}

export function splitOrderIntoKitchenTickets(
  order: Pick<
    Order,
    | 'id'
    | 'orderNumber'
    | 'channel'
    | 'tableNumber'
    | 'externalOrderId'
    | 'waiterName'
    | 'priority'
    | 'items'
    | 'createdAt'
  >,
  stations: KitchenStation[]
): KitchenTicket[] {
  const stationMap = new Map(stations.map((s) => [s.id, s]));
  const grouped = new Map<string, OrderItem[]>();

  for (const item of order.items) {
    if (item.status === 'cancelled') continue;
    const list = grouped.get(item.stationId) || [];
    list.push(item);
    grouped.set(item.stationId, list);
  }

  const tickets: KitchenTicket[] = [];
  for (const [stationId, items] of grouped.entries()) {
    const station = stationMap.get(stationId);
    const ticketItems: KitchenTicketItem[] = items.map((item) => ({
      orderItemId: item.id,
      name: item.name,
      quantity: item.quantity,
      modifiers: item.modifiers.map((m) => m.name),
      instructions: item.instructions,
      allergens: item.allergens,
      status: 'new',
    }));

    const maxPrep = items.reduce((max, item) => Math.max(max, item.prepTimeMinutes || 12), 10);

    tickets.push({
      id: `kt_${crypto.randomUUID().slice(0, 12)}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: order.channel,
      tableNumber: order.tableNumber,
      externalOrderId: order.externalOrderId,
      stationId,
      stationName: station?.name || stationId,
      waiterName: order.waiterName,
      priority: order.priority as OrderPriority,
      status: 'new',
      items: ticketItems,
      estimatedMinutes: maxPrep,
      createdAt: order.createdAt,
      updatedAt: order.createdAt,
    });
  }

  return tickets;
}

export function deriveOrderStatusFromTickets(
  tickets: KitchenTicket[],
  channel: OrderChannel,
  currentStatus: OrderStatus
): OrderStatus {
  if (currentStatus === 'Cancelled' || currentStatus === 'Completed') {
    return currentStatus;
  }
  const activeTickets = tickets.filter((t) => t.status !== 'cancelled');
  if (activeTickets.length === 0) return currentStatus;

  const statuses = activeTickets.map((t) => t.status);
  if (statuses.every((s) => s === 'picked_up')) {
    return channel === 'swiggy' || channel === 'zomato' || channel === 'takeaway' || channel === 'direct_online'
      ? 'Picked Up'
      : 'Completed';
  }
  if (statuses.every((s) => s === 'packed')) {
    return 'Packed';
  }
  if (statuses.every((s) => s === 'served')) {
    return 'Served';
  }
  if (statuses.every((s) => s === 'ready' || s === 'served' || s === 'packed' || s === 'picked_up')) {
    return 'Ready';
  }
  if (statuses.some((s) => s === 'ready' || s === 'served')) {
    return 'Partially Ready';
  }
  if (statuses.some((s) => s === 'preparing' || s === 'delayed')) {
    return 'Preparing';
  }
  if (statuses.some((s) => s === 'accepted')) {
    return 'Confirmed';
  }
  return 'Submitted';
}
