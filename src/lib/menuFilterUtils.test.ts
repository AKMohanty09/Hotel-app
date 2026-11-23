import assert from 'node:assert/strict';
import test from 'node:test';
import type { MenuItem } from '../types/domain';
import {
  countActiveMenuFilters,
  DEFAULT_MENU_FILTERS,
  filterAndSortMenuItems,
  getMenuItemBasePrice,
  getMenuItemPriceRange,
  itemNeedsCustomizationPopup,
} from './menuFilterUtils.ts';

function makeItem(overrides: Partial<MenuItem>): MenuItem {
  return {
    id: 'item_1',
    code: 'D101',
    name: 'Test Dish',
    description: 'Delicious dish',
    categoryId: 'cat_1',
    price: 250,
    variants: [],
    vegType: 'veg',
    isAvailable: true,
    isTemporarilySoldOut: false,
    isFeatured: false,
    prepTimeMinutes: 15,
    portionSize: 'Regular',
    spiceLevel: 'Mild',
    allergens: [],
    stationId: 'st_1',
    photoUrl: 'https://example.com/dish.jpg',
    modifiers: [],
    taxCategory: 'standard',
    platformAvailability: {
      dineIn: true,
      swiggy: true,
      zomato: true,
      takeaway: true,
    },
    ...overrides,
  };
}

test('itemNeedsCustomizationPopup returns false only when there are zero varieties and zero add-ons', () => {
  const plain = makeItem({ id: 'plain', variants: [], modifiers: [] });
  assert.equal(itemNeedsCustomizationPopup(plain), false);

  const singleVariety = makeItem({
    id: 'single_var',
    variants: [{ id: 'v1', name: 'Regular', price: 299 }],
    modifiers: [],
  });
  assert.equal(itemNeedsCustomizationPopup(singleVariety), true);

  const multiVariety = makeItem({
    id: 'multi_var',
    variants: [
      { id: 'v1', name: 'Small', price: 199 },
      { id: 'v2', name: 'Large', price: 399 },
    ],
    modifiers: [],
  });
  assert.equal(itemNeedsCustomizationPopup(multiVariety), true);

  const onlyAddons = makeItem({
    id: 'addons_only',
    variants: [],
    modifiers: [{ id: 'm1', name: 'Extra Cheese', priceDelta: 50 }],
  });
  assert.equal(itemNeedsCustomizationPopup(onlyAddons), true);
});

test('getMenuItemPriceRange computes min/max across variants cleanly', () => {
  const plain = makeItem({ price: 180, variants: [] });
  assert.deepEqual(getMenuItemPriceRange(plain), {
    min: 180,
    max: 180,
    hasMultiplePrices: false,
  });
  assert.equal(getMenuItemBasePrice(plain), 180);

  const pizza = makeItem({
    price: 399,
    variants: [
      { id: 'v1', name: 'Small', price: 249 },
      { id: 'v2', name: 'Medium', price: 399 },
      { id: 'v3', name: 'Large', price: 549 },
    ],
  });
  assert.deepEqual(getMenuItemPriceRange(pizza), {
    min: 249,
    max: 549,
    hasMultiplePrices: true,
  });
  assert.equal(getMenuItemBasePrice(pizza), 249);
});

test('filterAndSortMenuItems handles dietary, search, spice, availability, featured, and price sorting', () => {
  const items: MenuItem[] = [
    makeItem({
      id: 'i1',
      code: 'P01',
      name: 'Margherita Pizza',
      description: 'Wood fired classic basil pizza',
      vegType: 'veg',
      price: 399,
      variants: [
        { id: 'v1', name: 'Small', price: 249 },
        { id: 'v2', name: 'Large', price: 499 },
      ],
      spiceLevel: 'None',
      prepTimeMinutes: 18,
      isFeatured: true,
    }),
    makeItem({
      id: 'i2',
      code: 'C02',
      name: 'Spicy Chicken Wings',
      description: 'Smoky glazed wings',
      vegType: 'non_veg',
      price: 320,
      spiceLevel: 'Spicy',
      prepTimeMinutes: 12,
      isAvailable: true,
      isTemporarilySoldOut: false,
    }),
    makeItem({
      id: 'i3',
      code: 'V03',
      name: 'Vegan Buddha Bowl',
      description: 'Quinoa roasted greens',
      vegType: 'vegan',
      price: 450,
      spiceLevel: 'Mild',
      prepTimeMinutes: 10,
      isTemporarilySoldOut: true,
    }),
  ];

  // Veg only
  const veg = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, dietary: 'veg' });
  assert.deepEqual(veg.map((i) => i.id), ['i1']);

  // Non-veg only
  const nonVeg = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, dietary: 'non_veg' });
  assert.deepEqual(nonVeg.map((i) => i.id), ['i2']);

  // Vegan only
  const vegan = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, dietary: 'vegan' });
  assert.deepEqual(vegan.map((i) => i.id), ['i3']);

  // Search by variant name or code
  const byVariant = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, search: 'Small' });
  assert.deepEqual(byVariant.map((i) => i.id), ['i1']);

  const byCode = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, search: 'c02' });
  assert.deepEqual(byCode.map((i) => i.id), ['i2']);

  // Price low to high uses lowest variant price (249 < 320 < 450)
  const lowToHigh = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, sortBy: 'price_asc' });
  assert.deepEqual(lowToHigh.map((i) => i.id), ['i1', 'i2', 'i3']);

  // Price high to low (450 > 320 > 249)
  const highToLow = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, sortBy: 'price_desc' });
  assert.deepEqual(highToLow.map((i) => i.id), ['i3', 'i2', 'i1']);

  // Fastest prep (10 < 12 < 18)
  const prepAsc = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, sortBy: 'prep_asc' });
  assert.deepEqual(prepAsc.map((i) => i.id), ['i3', 'i2', 'i1']);

  // Available only filters out sold out
  const inStock = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, availableOnly: true });
  assert.deepEqual(inStock.map((i) => i.id), ['i1', 'i2']);

  // Featured + Spice filters
  const featured = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, featuredOnly: true });
  assert.deepEqual(featured.map((i) => i.id), ['i1']);

  const spicy = filterAndSortMenuItems(items, { ...DEFAULT_MENU_FILTERS, spiceLevel: 'Spicy' });
  assert.deepEqual(spicy.map((i) => i.id), ['i2']);

  assert.equal(countActiveMenuFilters(DEFAULT_MENU_FILTERS), 0);
  assert.equal(
    countActiveMenuFilters({
      ...DEFAULT_MENU_FILTERS,
      dietary: 'veg',
      sortBy: 'price_asc',
      availableOnly: true,
    }),
    3
  );
});
