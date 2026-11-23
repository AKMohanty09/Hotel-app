import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Edit3,
  PackagePlus,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { api } from '../../services/api';
import type {
  InventoryMovement,
  MenuItem,
  MenuItemModifier,
  MenuItemVariant,
  RestaurantSnapshot,
} from '../../types/domain';
import { uploadImageFileToDatabase } from '../../lib/imageUtils';

interface ManagerMenuAndInventoryProps {
  snapshot: RestaurantSnapshot;
  mode: 'menu' | 'inventory';
  onRefresh: () => Promise<void>;
}

const IMAGE_PRESETS = [
  { label: 'Artisan Pizza', url: '/src/assets/images/dish_truffle_pizza_1795406026216.jpg' },
  { label: 'Butter Chicken', url: '/src/assets/images/dish_butter_chicken_1795406026082.jpg' },
  { label: 'Salmon Bowl', url: '/src/assets/images/dish_salmon_bowl_1795406026358.jpg' },
  { label: 'Molten Lava Cake', url: '/src/assets/images/dish_lava_cake_1795406025821.jpg' },
  { label: 'Craft Mocktail', url: '/src/assets/images/dish_craft_mocktail_1795406026324.jpg' },
];

export const ManagerMenuAndInventory: React.FC<ManagerMenuAndInventoryProps> = ({
  snapshot,
  mode,
  onRefresh,
}) => {
  const [feedback, setFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Menu category creation
  const [newCatName, setNewCatName] = useState('');

  // Menu item modal
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [dishName, setDishName] = useState('');
  const [dishCode, setDishCode] = useState('');
  const [dishDesc, setDishDesc] = useState('');
  const [dishCat, setDishCat] = useState(snapshot.categories[0]?.id || '');
  const [dishPrice, setDishPrice] = useState(295);
  const [dishVeg, setDishVeg] = useState<MenuItem['vegType']>('veg');
  const [dishStation, setDishStation] = useState(snapshot.stations[0]?.id || 'st_main');
  const [dishPrep, setDishPrep] = useState(15);
  const [dishSpice, setDishSpice] = useState<MenuItem['spiceLevel']>('Medium');
  const [dishPhoto, setDishPhoto] = useState(IMAGE_PRESETS[0].url);
  const [dishAllergens, setDishAllergens] = useState('');
  const [dishVariants, setDishVariants] = useState<MenuItemVariant[]>([]);
  const [dishModifiers, setDishModifiers] = useState<MenuItemModifier[]>([]);
  const [dishFeatured, setDishFeatured] = useState(false);
  const [savingDish, setSavingDish] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const dishPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Inventory tab
  const [invSubTab, setInvSubTab] = useState<'stock' | 'suppliers' | 'pos' | 'recipes'>('stock');
  const [adjustQty, setAdjustQty] = useState<Record<string, string>>({});
  const [adjustType, setAdjustType] = useState<Record<string, InventoryMovement['type']>>({});
  const [newInvOpen, setNewInvOpen] = useState(false);
  const [invName, setInvName] = useState('');
  const [invUnit, setInvUnit] = useState('kg');
  const [invCategory, setInvCategory] = useState('Produce');
  const [invCurrent, setInvCurrent] = useState(10);
  const [invMin, setInvMin] = useState(4);
  const [invCost, setInvCost] = useState(120);

  // PO modal
  const [poSupplierId, setPoSupplierId] = useState(snapshot.suppliers[0]?.id || '');
  const [poItemId, setPoItemId] = useState(snapshot.inventory[0]?.id || '');
  const [poQty, setPoQty] = useState(15);

  const cur = snapshot.settings.currencySymbol || '₹';

  const notify = (msg: string) => {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(''), 4500);
  };

  const filteredItems = useMemo(() => {
    return snapshot.menuItems.filter((item) => {
      if (selectedCategory !== 'all' && item.categoryId !== selectedCategory) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!`${item.name} ${item.code} ${item.description}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [snapshot.menuItems, selectedCategory, search]);

  const openCreateItem = () => {
    setEditingItem(null);
    setDishName('');
    setDishCode(`DSH-${100 + snapshot.menuItems.length}`);
    setDishDesc('');
    setDishCat(snapshot.categories[0]?.id || '');
    setDishPrice(320);
    setDishVeg('veg');
    setDishStation(snapshot.stations[0]?.id || 'st_main');
    setDishPrep(15);
    setDishSpice('Medium');
    setDishPhoto(IMAGE_PRESETS[0].url);
    setDishAllergens('');
    setDishVariants([]);
    setDishModifiers([]);
    setDishFeatured(false);
    setItemModalOpen(true);
  };

  const openEditItem = (item: MenuItem) => {
    setEditingItem(item);
    setDishName(item.name);
    setDishCode(item.code);
    setDishDesc(item.description);
    setDishCat(item.categoryId);
    setDishPrice(item.price);
    setDishVeg(item.vegType);
    setDishStation(item.stationId);
    setDishPrep(item.prepTimeMinutes);
    setDishSpice(item.spiceLevel);
    setDishPhoto(item.photoUrl);
    setDishAllergens(item.allergens.join(', '));
    setDishVariants(item.variants ? item.variants.map((v) => ({ ...v })) : []);
    setDishModifiers(item.modifiers.map((m) => ({ ...m })));
    setDishFeatured(item.isFeatured);
    setItemModalOpen(true);
  };

  const handleDishPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const uploadedUrl = await uploadImageFileToDatabase(file, 'menu_item', {
        maxDimension: 800,
        preferPng: false,
        quality: 0.84,
        entityId: editingItem?.id,
      });
      setDishPhoto(uploadedUrl);
      notify('Dish image uploaded to database storage.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to upload dish photo.');
    } finally {
      setUploadingPhoto(false);
      if (dishPhotoInputRef.current) dishPhotoInputRef.current.value = '';
    }
  };

  const applySmallMediumLargePreset = () => {
    const base = Math.max(150, Number(dishPrice) || 350);
    setDishVariants([
      { id: `var_${Date.now()}_sm`, name: 'Small', price: Math.round(base * 0.8) },
      { id: `var_${Date.now()}_md`, name: 'Medium', price: base },
      { id: `var_${Date.now()}_lg`, name: 'Large', price: Math.round(base * 1.35) },
    ]);
  };

  const handleSaveDish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dishName.trim()) return;
    if (!dishCat) {
      notify('Please create a Menu Category first before adding a dish.');
      return;
    }
    setSavingDish(true);
    try {
      const cleanVariants = dishVariants
        .filter((v) => v.name.trim() && Number(v.price) >= 0)
        .map((v) => ({ id: v.id, name: v.name.trim(), price: Number(v.price) }));
      const effectiveBasePrice =
        cleanVariants.length > 0
          ? Math.min(...cleanVariants.map((v) => v.price))
          : Number(dishPrice);

      const payload: Partial<MenuItem> = {
        name: dishName.trim(),
        code: dishCode.trim(),
        description: dishDesc.trim(),
        categoryId: dishCat,
        price: effectiveBasePrice,
        variants: cleanVariants,
        vegType: dishVeg,
        stationId: dishStation,
        prepTimeMinutes: Number(dishPrep),
        spiceLevel: dishSpice,
        photoUrl: dishPhoto,
        allergens: dishAllergens
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        modifiers: dishModifiers,
        isFeatured: dishFeatured,
      };
      if (editingItem) {
        await api.updateMenuItem(editingItem.id, payload);
        notify(`Updated "${dishName.trim()}" across all customer & waiter menus.`);
      } else {
        await api.createMenuItem(payload);
        notify(`Created dish "${dishName.trim()}".`);
      }
      setItemModalOpen(false);
      await onRefresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to save dish.');
    } finally {
      setSavingDish(false);
    }
  };

  if (mode === 'menu') {
    return (
      <div className="space-y-5">
        {feedback && (
          <div role="status" className="rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">
            {feedback}
          </div>
        )}

        {/* Categories Bar */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Menu Categories ({snapshot.categories.length})
            </h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newCatName.trim()) return;
                await api.createCategory({ name: newCatName.trim() });
                setNewCatName('');
                notify('Category added.');
                await onRefresh();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="New category name..."
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                className="rounded-xl bg-slate-900 dark:bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:hover:bg-orange-700 whitespace-nowrap"
              >
                Add Category
              </button>
            </form>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                selectedCategory === 'all'
                  ? 'bg-orange-600 text-white'
                  : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              All ({snapshot.menuItems.length})
            </button>
            {snapshot.categories
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((cat) => (
                <div key={cat.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                      selectedCategory === cat.id
                        ? 'bg-orange-600 text-white'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {cat.name}
                  </button>
                  <button
                    type="button"
                    title={cat.isActive ? 'Hide category' : 'Activate category'}
                    onClick={async () => {
                      await api.updateCategory(cat.id, { isActive: !cat.isActive });
                      await onRefresh();
                    }}
                    className={`px-1.5 text-[10px] font-mono ${
                      cat.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                    }`}
                  >
                    {cat.isActive ? 'ON' : 'OFF'}
                  </button>
                </div>
              ))}
          </div>
        </div>

        {/* Search & Add Dish */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dish name, SKU code..."
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <button
            type="button"
            onClick={openCreateItem}
            className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            Add Menu Dish
          </button>
        </div>

        {/* Menu Items Grid */}
        {filteredItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center space-y-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {snapshot.menuItems.length === 0 ? 'No menu dishes added yet' : 'No matching dishes found'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {snapshot.categories.length === 0
                ? 'Start by adding your first Menu Category above, then create dishes with sizes, modifiers, and kitchen routing.'
                : 'Click Add Menu Dish above to publish items to Waiter POS and Customer QR menus.'}
            </p>
          </div>
        ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const station = snapshot.stations.find((s) => s.id === item.stationId);
            const cat = snapshot.categories.find((c) => c.id === item.categoryId);
            const hasVariants = Boolean(item.variants && item.variants.length > 0);
            return (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-3"
              >
                <div className="flex gap-3.5">
                  <img
                    src={item.photoUrl}
                    alt={item.name}
                    referrerPolicy="no-referrer"
                    className="h-20 w-20 rounded-xl object-cover shrink-0 border border-slate-100 dark:border-slate-800"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{item.name}</h4>
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 shrink-0">
                        {hasVariants ? `From ${cur}${item.price}` : `${cur}${item.price}`}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {item.code} · {cat?.name || 'Menu'} · {station?.name || 'Main Kitchen'}
                    </p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{item.description}</p>
                    {hasVariants && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-mono text-orange-700 dark:text-orange-300">
                        {item.variants!.map((v) => (
                          <span key={v.id} className="rounded bg-orange-50 dark:bg-orange-950/50 px-1.5 py-0.5 border border-orange-200 dark:border-orange-900/50">
                            {v.name}: {cur}{v.price}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="uppercase font-medium text-slate-700 dark:text-slate-300">{item.vegType}</span>
                      <span>·</span>
                      <span>{item.prepTimeMinutes}m prep</span>
                      <span>·</span>
                      <span>{item.modifiers.length} add-ons</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-3 text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.updateMenuItem(item.id, {
                          isTemporarilySoldOut: !item.isTemporarilySoldOut,
                        });
                        notify(
                          `${item.name} marked ${!item.isTemporarilySoldOut ? 'Sold Out' : 'In Stock'}.`
                        );
                        await onRefresh();
                      }}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        item.isTemporarilySoldOut
                          ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900'
                          : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                      }`}
                    >
                      {item.isTemporarilySoldOut ? 'Sold Out' : 'Available'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.updateMenuItem(item.id, { isAvailable: !item.isAvailable });
                        await onRefresh();
                      }}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      {item.isAvailable ? 'Visible' : 'Hidden'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => openEditItem(item)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Edit3 className="h-3 w-3" />
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        )}

        {/* Create/Edit Menu Item Modal */}
        {itemModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto" role="dialog" aria-modal="true">
            <form
              onSubmit={handleSaveDish}
              className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-xl space-y-4 max-h-[92vh] overflow-y-auto text-slate-900 dark:text-slate-100"
            >
              <h3 className="text-base font-semibold">
                {editingItem ? `Edit Dish · ${editingItem.name}` : 'Create Menu Dish'}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Dish Name</label>
                  <input
                    type="text"
                    required
                    value={dishName}
                    onChange={(e) => setDishName(e.target.value)}
                    placeholder="e.g. Classic Margherita Pizza"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Item Code</label>
                  <input
                    type="text"
                    required
                    value={dishCode}
                    onChange={(e) => setDishCode(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
                  <select
                    value={dishCat}
                    onChange={(e) => setDishCat(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  >
                    {snapshot.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Base Price ({cur}) {dishVariants.length > 0 && '· overridden by sizes'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={dishPrice}
                    onChange={(e) => setDishPrice(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Kitchen Station</label>
                  <select
                    value={dishStation}
                    onChange={(e) => setDishStation(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  >
                    {snapshot.stations.map((st) => (
                      <option key={st.id} value={st.id}>{st.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Dietary Type</label>
                  <select
                    value={dishVeg}
                    onChange={(e) => setDishVeg(e.target.value as MenuItem['vegType'])}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  >
                    <option value="veg">Veg</option>
                    <option value="non_veg">Non-Veg</option>
                    <option value="vegan">Vegan</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Prep Time (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={dishPrep}
                    onChange={(e) => setDishPrep(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Spice Level</label>
                  <select
                    value={dishSpice}
                    onChange={(e) => setDishSpice(e.target.value as MenuItem['spiceLevel'])}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                  >
                    <option value="None">None</option>
                    <option value="Mild">Mild</option>
                    <option value="Medium">Medium</option>
                    <option value="Spicy">Spicy</option>
                    <option value="Extra Hot">Extra Hot</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={dishDesc}
                  onChange={(e) => setDishDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3.5 text-xs space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="block font-semibold text-slate-800 dark:text-slate-100">
                      Food Item Image
                    </label>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Upload a photo of this dish (PNG, JPG, WEBP) or choose a preset.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={dishPhotoInputRef}
                      type="file"
                      aria-label="Upload food item photo"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={(e) => void handleDishPhotoUpload(e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => dishPhotoInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {uploadingPhoto ? 'Processing...' : 'Upload Food Photo'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <img
                    src={dishPhoto}
                    alt="Dish preview"
                    referrerPolicy="no-referrer"
                    className="h-16 w-24 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-white shrink-0"
                  />
                  <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Or Pick Stock Preset
                      </label>
                      <select
                        value={IMAGE_PRESETS.some((p) => p.url === dishPhoto) ? dishPhoto : ''}
                        onChange={(e) => {
                          if (e.target.value) setDishPhoto(e.target.value);
                        }}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-xs"
                      >
                        <option value="">Custom Uploaded Dish Photo</option>
                        {IMAGE_PRESETS.map((p) => (
                          <option key={p.url} value={p.url}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Allergens (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={dishAllergens}
                        onChange={(e) => setDishAllergens(e.target.value)}
                        placeholder="Dairy, Gluten, Nuts"
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={dishFeatured}
                  onChange={(e) => setDishFeatured(e.target.checked)}
                />
                Mark as Featured / Chef Recommended
              </label>

              {/* Sizes / Variants Builder (e.g. Small / Medium / Large Pizza) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      Sizes / Portions (Small, Medium, Large...)
                    </span>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Guests pick their exact size and see live pricing on the menu card.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={applySmallMediumLargePreset}
                      className="inline-flex items-center gap-1 rounded-lg border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/60 px-2.5 py-1 text-[11px] font-semibold text-orange-700 dark:text-orange-300 hover:bg-orange-100"
                    >
                      <Sparkles className="h-3 w-3" />
                      Small / Medium / Large
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDishVariants((prev) => [
                          ...prev,
                          { id: `var_${Date.now()}_${prev.length}`, name: 'Regular', price: Number(dishPrice) || 299 },
                        ])
                      }
                      className="text-xs font-medium text-orange-600 hover:underline"
                    >
                      + Add Size
                    </button>
                  </div>
                </div>
                {dishVariants.map((v, idx) => (
                  <div key={v.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Size label (e.g. Large 14&quot;)"
                      value={v.name}
                      onChange={(e) =>
                        setDishVariants((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x))
                        )
                      }
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="number"
                      min={0}
                      placeholder="Price"
                      value={v.price}
                      onChange={(e) =>
                        setDishVariants((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, price: Number(e.target.value) } : x))
                        )
                      }
                      className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDishVariants((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Modifiers Builder */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">Add-ons, Crusts &amp; Modifiers</span>
                  <button
                    type="button"
                    onClick={() =>
                      setDishModifiers((prev) => [
                        ...prev,
                        { id: `mod_${Date.now()}`, name: 'Extra Cheese', priceDelta: 65, groupName: 'Toppings' },
                      ])
                    }
                    className="text-xs font-medium text-orange-600 hover:underline"
                  >
                    + Add Modifier
                  </button>
                </div>
                {dishModifiers.map((m, idx) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Group (e.g. Crust)"
                      value={m.groupName || ''}
                      onChange={(e) =>
                        setDishModifiers((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, groupName: e.target.value } : x))
                        )
                      }
                      className="w-28 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
                    />
                    <input
                      type="text"
                      placeholder="Modifier name"
                      value={m.name}
                      onChange={(e) =>
                        setDishModifiers((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x))
                        )
                      }
                      className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="number"
                      placeholder="+Price"
                      value={m.priceDelta}
                      onChange={(e) =>
                        setDishModifiers((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, priceDelta: Number(e.target.value) } : x))
                        )
                      }
                      className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDishModifiers((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setItemModalOpen(false)}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDish}
                  className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {savingDish ? 'Saving...' : 'Save Dish'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // INVENTORY MODE
  return (
    <div className="space-y-5">
      {feedback && (
        <div role="status" className="rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">
          {feedback}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['stock', 'suppliers', 'pos', 'recipes'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setInvSubTab(t)}
              className={`rounded-xl px-3.5 py-2 text-xs font-semibold capitalize whitespace-nowrap ${
                invSubTab === t
                  ? 'bg-slate-900 dark:bg-orange-600 text-white'
                  : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {t === 'pos' ? 'Purchase Orders' : t}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setNewInvOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-orange-700 whitespace-nowrap"
        >
          <PackagePlus className="h-4 w-4" />
          Add Ingredient
        </button>
      </div>

      {invSubTab === 'stock' && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Ingredient / SKU</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Stock Level</th>
                  <th className="px-4 py-3 font-medium">Min Par</th>
                  <th className="px-4 py-3 font-medium">Unit Cost</th>
                  <th className="px-4 py-3 font-medium text-right">Stock Movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {snapshot.inventory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                      No inventory ingredients added yet. Click &ldquo;Add Ingredient&rdquo; to track stock levels.
                    </td>
                  </tr>
                ) : (
                  snapshot.inventory.map((inv) => {
                    const low = inv.currentStock <= inv.minStock;
                    const qty = adjustQty[inv.id] ?? '5';
                    const mType = adjustType[inv.id] ?? 'in';
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            {inv.name}
                            {low && <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {inv.sku} {inv.expiryDate ? `· Exp: ${inv.expiryDate}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{inv.category}</td>
                        <td className={`px-4 py-3 font-mono font-bold ${low ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
                          {inv.currentStock} {inv.unit}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">
                          {inv.minStock} {inv.unit}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700 dark:text-slate-300">
                          {cur}{inv.costPerUnit}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <select
                              value={mType}
                              onChange={(e) =>
                                setAdjustType((prev) => ({
                                  ...prev,
                                  [inv.id]: e.target.value as InventoryMovement['type'],
                                }))
                              }
                              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 text-[11px]"
                            >
                              <option value="in">Stock In (+)</option>
                              <option value="out">Usage (-)</option>
                              <option value="wastage">Wastage (-)</option>
                              <option value="expiry">Expiry (-)</option>
                            </select>
                            <input
                              type="number"
                              min={0.5}
                              step="0.5"
                              value={qty}
                              onChange={(e) =>
                                setAdjustQty((prev) => ({ ...prev, [inv.id]: e.target.value }))
                              }
                              className="w-16 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-2 py-1 text-[11px] font-mono"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                await api.adjustInventory(inv.id, mType, Number(qty), `${mType} entry`);
                                notify(`Recorded ${mType} of ${qty} ${inv.unit} for ${inv.name}.`);
                                await onRefresh();
                              }}
                              className="rounded-lg bg-slate-900 dark:bg-orange-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-800"
                            >
                              Apply
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent Stock Movements</h3>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-56 overflow-y-auto">
              {snapshot.inventoryMovements.map((mov) => (
                <div key={mov.id} className="py-2 flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{mov.itemName}</span>
                    <span className="mx-2 text-slate-300 dark:text-slate-700">·</span>
                    <span className="uppercase font-mono text-[11px] text-orange-700 dark:text-orange-400">{mov.type}</span>
                    <span className="ml-2 text-slate-600 dark:text-slate-400">{mov.reason}</span>
                  </div>
                  <div className="font-mono text-slate-800 dark:text-slate-200">
                    {mov.type === 'in' ? '+' : '-'}{mov.quantity} {mov.unit} · {mov.actorName}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {invSubTab === 'suppliers' && (
        <div className="grid gap-4 md:grid-cols-2">
          {snapshot.suppliers.length === 0 ? (
            <div className="md:col-span-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No suppliers configured yet.
            </div>
          ) : (
            snapshot.suppliers.map((sup) => (
              <div key={sup.id} className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 text-xs space-y-1.5">
                <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{sup.name}</div>
                <div className="text-slate-600 dark:text-slate-300">Contact: {sup.contactName} · {sup.phone}</div>
                <div className="text-slate-500 dark:text-slate-400">{sup.email} · Specialty: {sup.category}</div>
              </div>
            ))
          )}
        </div>
      )}

      {invSubTab === 'pos' && (
        <div className="space-y-4">
          {snapshot.suppliers.length === 0 || snapshot.inventory.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Add at least one inventory ingredient and supplier before issuing a purchase order.
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!poSupplierId || !poItemId) {
                  notify('Please select both a supplier and an ingredient.');
                  return;
                }
                await api.createPurchaseOrder(poSupplierId, poItemId, Number(poQty));
                notify('Purchase Order created.');
                await onRefresh();
              }}
              className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-4 flex flex-wrap items-end gap-3 text-xs"
            >
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Supplier</label>
                <select
                  value={poSupplierId}
                  onChange={(e) => setPoSupplierId(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                >
                  {snapshot.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Ingredient</label>
                <select
                  value={poItemId}
                  onChange={(e) => setPoItemId(e.target.value)}
                  className="rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                >
                  {snapshot.inventory.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={poQty}
                  onChange={(e) => setPoQty(Number(e.target.value))}
                  className="w-24 rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-orange-700"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                Issue PO
              </button>
            </form>
          )}

          <div className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {snapshot.purchaseOrders.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No purchase orders issued yet.
              </div>
            ) : (
              snapshot.purchaseOrders.map((po) => (
                <div key={po.id} className="p-4 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{po.poNumber}</div>
                    <div className="text-slate-600 dark:text-slate-400 mt-0.5">
                      {po.supplierName} · {po.items.map((i) => `${i.quantity} ${i.itemName}`).join(', ')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold text-slate-900 dark:text-slate-100">{cur}{po.totalCost.toFixed(2)}</div>
                    <div className="uppercase text-[11px] text-orange-700 dark:text-amethyst">{po.status}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {invSubTab === 'recipes' && (
        <div className="grid gap-4 md:grid-cols-2">
          {snapshot.recipes.length === 0 ? (
            <div className="md:col-span-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No dish recipes mapped yet.
            </div>
          ) : (
            snapshot.recipes.map((rec) => (
              <div key={rec.id} className="rounded-xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-5 space-y-2.5 text-xs">
                <div className="flex items-center gap-2 font-semibold text-sm text-slate-900 dark:text-slate-100">
                  <BookOpen className="h-4 w-4 text-orange-600 dark:text-amethyst" />
                  {rec.menuItemName}
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rec.ingredients.map((ing) => (
                    <div key={ing.inventoryItemId} className="py-1.5 flex justify-between">
                      <span className="text-slate-700 dark:text-slate-300">{ing.ingredientName}</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">{ing.quantity} {ing.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Add Inventory Modal */}
      {newInvOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await api.createInventoryItem({
                name: invName,
                unit: invUnit,
                category: invCategory,
                currentStock: Number(invCurrent),
                minStock: Number(invMin),
                costPerUnit: Number(invCost),
              });
              setNewInvOpen(false);
              setInvName('');
              notify('Ingredient added to inventory.');
              await onRefresh();
            }}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-dusk bg-white dark:bg-slate-900 p-6 shadow-xl space-y-3 text-xs"
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Add Inventory Ingredient</h3>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Ingredient Name</label>
              <input
                type="text"
                required
                value={invName}
                onChange={(e) => setInvName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Unit</label>
                <input
                  type="text"
                  required
                  value={invUnit}
                  onChange={(e) => setInvUnit(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Category</label>
                <input
                  type="text"
                  value={invCategory}
                  onChange={(e) => setInvCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Opening Stock</label>
                <input
                  type="number"
                  value={invCurrent}
                  onChange={(e) => setInvCurrent(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Min Par</label>
                <input
                  type="number"
                  value={invMin}
                  onChange={(e) => setInvMin(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Cost Per Unit ({cur})</label>
              <input
                type="number"
                value={invCost}
                onChange={(e) => setInvCost(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 dark:border-dusk bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setNewInvOpen(false)}
                className="rounded-xl border border-slate-200 dark:border-dusk px-4 py-2 text-sm text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
              >
                Save Item
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
