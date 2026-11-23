import type { MenuItem } from '../types/domain';

export type DietaryFilter = 'all' | 'veg' | 'non_veg' | 'vegan';
export type MenuSortOption = 'default' | 'price_asc' | 'price_desc' | 'prep_asc';
export type SpiceFilter = 'all' | 'None' | 'Mild' | 'Medium' | 'Spicy' | 'Extra Hot';

export interface MenuFilterState {
  categoryId: string;
  dietary: DietaryFilter;
  search: string;
  sortBy: MenuSortOption;
  spiceLevel: SpiceFilter;
  availableOnly: boolean;
  featuredOnly: boolean;
}

export const DEFAULT_MENU_FILTERS: MenuFilterState = {
  categoryId: 'all',
  dietary: 'all',
  search: '',
  sortBy: 'default',
  spiceLevel: 'all',
  availableOnly: false,
  featuredOnly: false,
};

export function getMenuItemPriceRange(item: MenuItem): {
  min: number;
  max: number;
  hasMultiplePrices: boolean;
} {
  const variants = item.variants || [];
  if (variants.length === 0) {
    return { min: item.price, max: item.price, hasMultiplePrices: false };
  }
  const prices = variants.map((v) => v.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return {
    min,
    max,
    hasMultiplePrices: variants.length > 1 && max > min,
  };
}

export function getMenuItemBasePrice(item: MenuItem): number {
  return getMenuItemPriceRange(item).min;
}

/**
 * Determines whether clicking "+ Add" on a catalogue card must open the customization popup.
 * If the item has 1+ varieties OR 1+ add-on modifiers, the popup opens so the guest can
 * choose their variety and/or add-ons before adding to cart.
 * If it has neither varieties nor add-ons, "+ Add" inserts directly into the cart.
 */
export function itemNeedsCustomizationPopup(item: MenuItem): boolean {
  const hasVarieties = Array.isArray(item.variants) && item.variants.length > 0;
  const hasAddOns = Array.isArray(item.modifiers) && item.modifiers.length > 0;
  return hasVarieties || hasAddOns;
}

export function filterAndSortMenuItems(items: MenuItem[], filters: MenuFilterState): MenuItem[] {
  const query = filters.search.trim().toLowerCase();

  const filtered = items.filter((item) => {
    if (filters.categoryId !== 'all' && item.categoryId !== filters.categoryId) {
      return false;
    }

    if (filters.dietary !== 'all' && item.vegType !== filters.dietary) {
      return false;
    }

    if (filters.spiceLevel !== 'all' && item.spiceLevel !== filters.spiceLevel) {
      return false;
    }

    if (filters.availableOnly && (!item.isAvailable || item.isTemporarilySoldOut)) {
      return false;
    }

    if (filters.featuredOnly && !item.isFeatured) {
      return false;
    }

    if (query) {
      const variantNames = (item.variants || []).map((v) => v.name).join(' ');
      const modifierNames = (item.modifiers || []).map((m) => `${m.groupName || ''} ${m.name}`).join(' ');
      const haystack = [
        item.name,
        item.description,
        item.code,
        item.portionSize,
        item.spiceLevel,
        item.allergens.join(' '),
        variantNames,
        modifierNames,
      ]
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(query)) {
        return false;
      }
    }

    return true;
  });

  if (filters.sortBy === 'default') {
    return filtered;
  }

  return [...filtered].sort((a, b) => {
    if (filters.sortBy === 'price_asc') {
      return getMenuItemBasePrice(a) - getMenuItemBasePrice(b);
    }
    if (filters.sortBy === 'price_desc') {
      return getMenuItemBasePrice(b) - getMenuItemBasePrice(a);
    }
    if (filters.sortBy === 'prep_asc') {
      const prepDiff = a.prepTimeMinutes - b.prepTimeMinutes;
      return prepDiff !== 0 ? prepDiff : getMenuItemBasePrice(a) - getMenuItemBasePrice(b);
    }
    return 0;
  });
}

export function countActiveMenuFilters(filters: MenuFilterState): number {
  let count = 0;
  if (filters.categoryId !== 'all') count += 1;
  if (filters.dietary !== 'all') count += 1;
  if (filters.search.trim()) count += 1;
  if (filters.sortBy !== 'default') count += 1;
  if (filters.spiceLevel !== 'all') count += 1;
  if (filters.availableOnly) count += 1;
  if (filters.featuredOnly) count += 1;
  return count;
}
