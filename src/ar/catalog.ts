import type { FurnitureItem } from '../room/layout';

export const AR_CATEGORIES = [
  { id: 'seating', label: 'Seating & rest' },
  { id: 'tables', label: 'Tables & work' },
  { id: 'storage', label: 'Storage' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'walls', label: 'Wall & window' },
  { id: 'decor', label: 'Decor' },
  { id: 'everyday', label: 'Everyday' },
] as const;

export type ARCategory = typeof AR_CATEGORIES[number]['id'];
export interface ARCatalogEntry {
  id: string;
  category: ARCategory;
  item: Readonly<FurnitureItem>;
}

/** Editable concept models and example outer sizes, never scanned product dimensions. */
export const AR_CATALOG: readonly ARCatalogEntry[] = [
  { id: 'sofa', category: 'seating', item: { id: 'sofa', kind: 'sofa', label: 'Sofa', width: 2, depth: .85, height: .85, color: '#7d9580' } },
  { id: 'loveseat', category: 'seating', item: { id: 'loveseat', kind: 'sofa', label: 'Loveseat', width: 1.45, depth: .8, height: .82, color: '#b68a78' } },
  { id: 'chair', category: 'seating', item: { id: 'chair', kind: 'chair', label: 'Chair', width: .5, depth: .5, height: .85, color: '#94aaa6' } },
  { id: 'lounge-chair', category: 'seating', item: { id: 'lounge-chair', kind: 'chair', label: 'Lounge chair', width: .72, depth: .75, height: .85, color: '#c6ad8f' } },
  { id: 'ottoman', category: 'seating', item: { id: 'ottoman', kind: 'ottoman', label: 'Ottoman', width: .65, depth: .5, height: .42, color: '#b59c86' } },
  { id: 'bed', category: 'seating', item: { id: 'bed', kind: 'bed', label: 'Queen bed', width: 1.65, depth: 2.15, height: 1.05, color: '#d4c4ab' } },
  { id: 'desk', category: 'tables', item: { id: 'desk', kind: 'desk', label: 'Desk', width: 1.2, depth: .6, height: .75, color: '#b59a73' } },
  { id: 'compact-desk', category: 'tables', item: { id: 'compact-desk', kind: 'desk', label: 'Compact desk', width: .8, depth: .5, height: .75, color: '#c6b494' } },
  { id: 'dining-table', category: 'tables', item: { id: 'dining-table', kind: 'table', label: 'Dining table', width: 1.6, depth: .9, height: .75, color: '#bf9b73' } },
  { id: 'round-table', category: 'tables', item: { id: 'round-table', kind: 'table', label: 'Round table', width: .9, depth: .9, height: .75, color: '#d0ba96' } },
  { id: 'coffee-table', category: 'tables', item: { id: 'coffee-table', kind: 'table', label: 'Coffee table', width: 1, depth: .55, height: .4, color: '#b99370' } },
  { id: 'side-table', category: 'tables', item: { id: 'side-table', kind: 'table', label: 'Side table', width: .45, depth: .45, height: .5, color: '#aab69b' } },
  { id: 'wardrobe', category: 'storage', item: { id: 'wardrobe', kind: 'wardrobe', label: 'Wardrobe', width: 1.2, depth: .6, height: 2.1, color: '#b5bca6' } },
  { id: 'bookcase', category: 'storage', item: { id: 'bookcase', kind: 'shelf', label: 'Bookcase', width: .8, depth: .32, height: 1.7, color: '#b6a184' } },
  { id: 'low-shelf', category: 'storage', item: { id: 'low-shelf', kind: 'shelf', label: 'Low shelf', width: 1, depth: .35, height: .8, color: '#8faaa0' } },
  { id: 'storage-box', category: 'storage', item: { id: 'storage-box', kind: 'custom', label: 'Storage box', width: .4, depth: .3, height: .3, color: '#c8b591' } },
  { id: 'floor-plant', category: 'decor', item: { id: 'floor-plant', kind: 'plant', label: 'Floor plant', width: .55, depth: .55, height: 1.3, color: '#6f8d58' } },
  { id: 'desk-plant', category: 'decor', item: { id: 'desk-plant', kind: 'plant', label: 'Small plant', width: .22, depth: .22, height: .36, color: '#779c63' } },
  { id: 'floor-lamp', category: 'lighting', item: { id: 'floor-lamp', kind: 'lamp', label: 'Floor lamp', width: .42, depth: .42, height: 1.55, color: '#e0ceaa', light: { enabled: true, temperature: 2700, brightness: 70 } } },
  { id: 'table-lamp', category: 'lighting', item: { id: 'table-lamp', kind: 'lamp', label: 'Table lamp', width: .25, depth: .25, height: .45, color: '#d6b9a1', light: { enabled: true, temperature: 2700, brightness: 70 } } },
  { id: 'pendant-light', category: 'lighting', item: { id: 'pendant-light', kind: 'lamp', model: 'pendant-light', label: 'Pendant light', width: .46, depth: .46, height: .65, color: '#cbb592', light: { enabled: true, temperature: 2700, brightness: 70 } } },
  { id: 'ceiling-light', category: 'lighting', item: { id: 'ceiling-light', kind: 'lamp', model: 'ceiling-light', label: 'Ceiling light', width: .5, depth: .5, height: .12, color: '#e4e5df', light: { enabled: true, temperature: 4000, brightness: 80 } } },
  { id: 'wall-sconce', category: 'lighting', item: { id: 'wall-sconce', kind: 'lamp', model: 'wall-sconce', label: 'Wall sconce', width: .18, depth: .22, height: .32, color: '#b59a73', light: { enabled: true, temperature: 2700, brightness: 65 } } },
  { id: 'wall-art', category: 'walls', item: { id: 'wall-art', kind: 'custom', model: 'wall-art', label: 'Framed artwork', width: .65, depth: .045, height: .85, color: '#b59a73' } },
  { id: 'landscape-art', category: 'walls', item: { id: 'landscape-art', kind: 'custom', model: 'wall-art', label: 'Landscape artwork', width: 1.1, depth: .045, height: .7, color: '#535f64' } },
  { id: 'wall-mirror', category: 'walls', item: { id: 'wall-mirror', kind: 'custom', model: 'wall-mirror', label: 'Wall mirror', width: .7, depth: .035, height: 1.1, color: '#b59a73' } },
  { id: 'wall-clock', category: 'walls', item: { id: 'wall-clock', kind: 'custom', model: 'wall-clock', label: 'Wall clock', width: .34, depth: .045, height: .34, color: '#b6a184' } },
  { id: 'wall-shelf', category: 'walls', item: { id: 'wall-shelf', kind: 'shelf', model: 'wall-shelf', label: 'Floating shelf', width: .9, depth: .24, height: .07, color: '#bf9b73' } },
  { id: 'curtains', category: 'walls', item: { id: 'curtains', kind: 'custom', model: 'curtains', label: 'Curtains', width: 1.8, depth: .14, height: 2.2, color: '#d4c4ab' } },
  { id: 'wall-tv', category: 'walls', item: { id: 'wall-tv', kind: 'monitor', model: 'wall-tv', label: 'Wall TV', width: 1.25, depth: .065, height: .72, color: '#414a40' } },
  { id: 'rug', category: 'decor', item: { id: 'rug', kind: 'rug', label: 'Area rug', width: 1.6, depth: 2.3, height: .015, color: '#b8a594' } },
  { id: 'small-rug', category: 'decor', item: { id: 'small-rug', kind: 'rug', label: 'Small rug', width: .6, depth: .9, height: .012, color: '#a6b49a' } },
  { id: 'laptop', category: 'everyday', item: { id: 'laptop', kind: 'laptop', label: 'Laptop', width: .34, depth: .26, height: .24, color: '#a8b3ba' } },
  { id: 'monitor', category: 'everyday', item: { id: 'monitor', kind: 'monitor', label: 'Monitor', width: .58, depth: .2, height: .45, color: '#535f64' } },
  { id: 'speaker', category: 'everyday', item: { id: 'speaker', kind: 'speaker', label: 'Speaker', width: .18, depth: .18, height: .32, color: '#747d80' } },
  { id: 'custom-object', category: 'everyday', item: { id: 'custom-object', kind: 'custom', label: 'Custom object', width: .5, depth: .5, height: .5, color: '#9aafb2' } },
];

/** Every placement owns its dimensions, finish, and identity independently. */
export function createCatalogItem(catalogId: string, instanceId: string = crypto.randomUUID()): FurnitureItem {
  const entry = AR_CATALOG.find(value => value.id === catalogId);
  if (!entry) throw new Error('Choose an object from the collection.');
  if (!instanceId.trim() || instanceId.length > 100) throw new Error('Object ID must contain between 1 and 100 characters.');
  return { ...entry.item, id: instanceId, ...(entry.item.light ? { light: { ...entry.item.light } } : {}) };
}
