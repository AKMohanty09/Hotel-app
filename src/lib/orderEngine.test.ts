import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveOrderStatusFromTickets,
  splitOrderIntoKitchenTickets,
  validateAndPriceOrderItems,
} from './orderEngine';
import type { KitchenStation, KitchenTicket, MenuItem } from '../types/domain';

const sampleMenu: MenuItem[] = [
  {
    id: 'item_pizza',
    code: 'PZ01',
    name: 'Truffle Burrata Pizza',
    description: 'Wood fired sourdough',
    categoryId: 'cat_mains',
    price: 520,
    vegType: 'veg',
    isAvailable: true,
    isTemporarilySoldOut: false,
    isFeatured: true,
    prepTimeMinutes: 18,
    portionSize: '12 inch',
    spiceLevel: 'Mild',
    allergens: ['Dairy', 'Gluten'],
    stationId: 'st_pizza',
    photoUrl: '',
    modifiers: [
      { id: 'mod_truffle', name: 'Extra Black Truffle', priceDelta: 120 },
      { id: 'mod_gf', name: 'Gluten-Free Crust', priceDelta: 80 },
    ],
    taxCategory: 'standard',
    platformAvailability: { dineIn: true, swiggy: true, zomato: true, takeaway: true },
  },
  {
    id: 'item_mocktail',
    code: 'BV01',
    name: 'Blood Orange Cooler',
    description: 'Sparkling rosemary citrus',
    categoryId: 'cat_bev',
    price: 220,
    vegType: 'vegan',
    isAvailable: true,
    isTemporarilySoldOut: false,
    isFeatured: false,
    prepTimeMinutes: 5,
    portionSize: '300 ml',
    spiceLevel: 'None',
    allergens: [],
    stationId: 'st_bev',
    photoUrl: '',
    modifiers: [],
    taxCategory: 'beverage',
    platformAvailability: { dineIn: true, swiggy: false, zomato: true, takeaway: true },
  },
];

const stations: KitchenStation[] = [
  { id: 'st_pizza', name: 'Wood-Fired Pizza', code: 'PIZ', isActive: true, color: '#EA580C' },
  { id: 'st_bev', name: 'Beverage Bar', code: 'BEV', isActive: true, color: '#0284C7' },
];

test('validateAndPriceOrderItems computes server-authoritative totals with modifiers, tax, and dine-in service charge', () => {
  const result = validateAndPriceOrderItems(
    [
      { menuItemId: 'item_pizza', quantity: 2, modifierIds: ['mod_truffle'] },
      { menuItemId: 'item_mocktail', quantity: 1 },
    ],
    sampleMenu,
    { taxRatePercent: 5, serviceChargePercent: 10 },
    'dine_in_qr'
  );

  // Pizza: (520 + 120) * 2 = 1280; Mocktail: 220 -> subtotal 1500
  assert.equal(result.subtotal, 1500);
  assert.equal(result.taxAmount, 75);
  assert.equal(result.serviceChargeAmount, 150);
  assert.equal(result.totalAmount, 1725);
});

test('validateAndPriceOrderItems rejects unavailable or platform-disabled items', () => {
  assert.throws(() => {
    validateAndPriceOrderItems(
      [{ menuItemId: 'item_mocktail', quantity: 1 }],
      sampleMenu,
      { taxRatePercent: 5, serviceChargePercent: 10 },
      'swiggy'
    );
  }, /disabled for Swiggy/);
});

test('splitOrderIntoKitchenTickets creates separate station tickets sharing parent orderId', () => {
  const priced = validateAndPriceOrderItems(
    [
      { menuItemId: 'item_pizza', quantity: 1 },
      { menuItemId: 'item_mocktail', quantity: 2 },
    ],
    sampleMenu,
    { taxRatePercent: 5, serviceChargePercent: 5 },
    'dine_in_qr'
  );

  const tickets = splitOrderIntoKitchenTickets(
    {
      id: 'ord_101',
      orderNumber: 'ORD-101',
      channel: 'dine_in_qr',
      tableNumber: 'T-01',
      priority: 'normal',
      items: priced.items,
      createdAt: new Date().toISOString(),
    },
    stations
  );

  assert.equal(tickets.length, 2);
  assert.ok(tickets.every((t) => t.orderId === 'ord_101'));
  assert.deepEqual(
    tickets.map((t) => t.stationId).sort(),
    ['st_bev', 'st_pizza']
  );
});

test('deriveOrderStatusFromTickets aggregates partial and full readiness accurately', () => {
  const base: KitchenTicket[] = [
    {
      id: 't1',
      orderId: 'o1',
      orderNumber: 'ORD-1',
      channel: 'dine_in_qr',
      stationId: 'st_pizza',
      stationName: 'Pizza',
      priority: 'normal',
      status: 'ready',
      items: [],
      estimatedMinutes: 15,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 't2',
      orderId: 'o1',
      orderNumber: 'ORD-1',
      channel: 'dine_in_qr',
      stationId: 'st_bev',
      stationName: 'Bar',
      priority: 'normal',
      status: 'preparing',
      items: [],
      estimatedMinutes: 5,
      createdAt: '',
      updatedAt: '',
    },
  ];

  assert.equal(deriveOrderStatusFromTickets(base, 'dine_in_qr', 'Preparing'), 'Partially Ready');
  base[1].status = 'ready';
  assert.equal(deriveOrderStatusFromTickets(base, 'dine_in_qr', 'Partially Ready'), 'Ready');
  base[0].status = 'packed';
  base[1].status = 'packed';
  assert.equal(deriveOrderStatusFromTickets(base, 'swiggy', 'Ready'), 'Packed');
});

test('validateAndPriceOrderItems prices Small / Medium / Large size variants and labels kitchen tickets', () => {
  const sizedPizza: MenuItem = {
    ...sampleMenu[0],
    variants: [
      { id: 'v_sm', name: 'Small (8")', price: 380 },
      { id: 'v_md', name: 'Medium (11")', price: 520 },
      { id: 'v_lg', name: 'Large (14")', price: 740 },
    ],
  };

  const priced = validateAndPriceOrderItems(
    [{ menuItemId: sizedPizza.id, variantId: 'v_lg', quantity: 2, modifierIds: ['mod_truffle'] }],
    [sizedPizza],
    { taxRatePercent: 5, serviceChargePercent: 5 },
    'dine_in_qr'
  );

  assert.equal(priced.items[0].variantId, 'v_lg');
  assert.equal(priced.items[0].variantName, 'Large (14")');
  assert.equal(priced.items[0].name, 'Truffle Burrata Pizza (Large (14"))');
  // (740 + 120) * 2 = 1720
  assert.equal(priced.subtotal, 1720);
  assert.equal(priced.taxAmount, 86);
  assert.equal(priced.serviceChargeAmount, 86);
  assert.equal(priced.totalAmount, 1892);

  assert.throws(() => {
    validateAndPriceOrderItems(
      [{ menuItemId: sizedPizza.id, variantId: 'v_nonexistent', quantity: 1 }],
      [sizedPizza],
      { taxRatePercent: 5, serviceChargePercent: 5 },
      'dine_in_qr'
    );
  }, /Invalid size\/variant/);
});

