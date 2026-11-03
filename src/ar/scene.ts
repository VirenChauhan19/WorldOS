import { createCatalogItem } from './catalog';
import { FURNITURE_KINDS, orientedSize } from '../room/layout';
import type { FurnitureItem, FurniturePlacement, FurnitureRotation, RoomSize } from '../room/layout';

export interface DesignObject { item: FurnitureItem; placement: FurniturePlacement }
export interface DesignScene { version: 1; name: string; room: RoomSize; objects: DesignObject[] }
export type ObjectUpdate = { item?: Partial<FurnitureItem>; placement?: Partial<FurniturePlacement> };
export const MAX_SCENE_OBJECTS = 24;
export const SCENE_STORAGE_KEY = 'worldos.design-scene.v1';
const EPS = 1e-9;
const rotations: readonly number[] = [0, 90, 180, 270];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const dimension = (value: unknown): value is number => finite(value) && value >= .01 && value <= 30;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function validRoom(value: unknown): value is RoomSize {
  const room = value as RoomSize | null;
  return !!room && dimension(room.width) && dimension(room.depth) && (room.height === undefined || dimension(room.height));
}
function validItem(value: unknown): value is FurnitureItem {
  const item = value as FurnitureItem | null;
  return !!item && text(item.id, 100) && text(item.label, 120) && FURNITURE_KINDS.includes(item.kind)
    && [item.width, item.depth, item.height].every(dimension) && typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color);
}
function validPlacement(value: unknown, item: FurnitureItem, room: RoomSize): value is FurniturePlacement {
  const placement = value as FurniturePlacement | null;
  if (!placement || placement.itemId !== item.id || !rotations.includes(placement.rotation)
    || !finite(placement.x) || !finite(placement.z) || placement.x < 0 || placement.z < 0
    || placement.elevation !== undefined && (!finite(placement.elevation) || placement.elevation < 0 || placement.elevation > 10)) return false;
  const size = orientedSize(item, placement.rotation);
  return placement.x + size.width <= room.width + EPS && placement.z + size.depth <= room.depth + EPS;
}

/** Strict, bounded restoration. Unknown metadata and world-tracking transforms are discarded. */
export function parseScene(value: unknown): DesignScene | null {
  const scene = value as DesignScene | null;
  if (!scene || scene.version !== 1 || !text(scene.name, 80) || !validRoom(scene.room)
    || !Array.isArray(scene.objects) || scene.objects.length > MAX_SCENE_OBJECTS) return null;
  const ids = new Set<string>();
  const objects: DesignObject[] = [];
  for (const object of scene.objects) {
    if (!object || !validItem(object.item) || ids.has(object.item.id) || !validPlacement(object.placement, object.item, scene.room)) return null;
    ids.add(object.item.id);
    const { id, kind, label, width, depth, height, color } = object.item;
    const { x, z, rotation, elevation } = object.placement;
    objects.push({ item: { id, kind, label, width, depth, height, color }, placement: { itemId: id, x, z, rotation, ...(elevation === undefined ? {} : { elevation }) } });
  }
  return { version: 1, name: scene.name.trim(), room: { width: scene.room.width, depth: scene.room.depth, ...(scene.room.height === undefined ? {} : { height: scene.room.height }) }, objects };
}

export function createScene(name = 'My space', room: RoomSize = { width: 5, depth: 4, height: 2.7 }): DesignScene {
  if (!text(name, 80)) throw new Error('Give your space a name of up to 80 characters.');
  if (!validRoom(room)) throw new Error('Use space dimensions between 0.01 and 30 metres.');
  return { version: 1, name: name.trim(), room: { ...room }, objects: [] };
}

function checkedDimension(value: number): number {
  if (!finite(value)) throw new Error('Enter a finite object dimension.');
  return clamp(value, .01, 30);
}
function boundedPlacement(item: FurnitureItem, placement: FurniturePlacement, room: RoomSize): FurniturePlacement {
  if (!rotations.includes(placement.rotation)) throw new Error('Rotate objects in quarter turns.');
  if (![placement.x, placement.z, placement.elevation ?? 0].every(finite)) throw new Error('Enter a finite object position.');
  const size = orientedSize(item, placement.rotation);
  if (size.width > room.width + EPS || size.depth > room.depth + EPS) throw new Error(`${item.label} is larger than this plan. Resize the object or increase the space dimensions.`);
  return { itemId: item.id, x: clamp(placement.x, 0, Math.max(0, room.width - size.width)), z: clamp(placement.z, 0, Math.max(0, room.depth - size.depth)), rotation: placement.rotation, ...(placement.elevation === undefined ? {} : { elevation: clamp(placement.elevation, 0, 10) }) };
}
function nextPlacement(scene: DesignScene, item: FurnitureItem): FurniturePlacement {
  const rotation: FurnitureRotation = item.width <= scene.room.width && item.depth <= scene.room.depth ? 0 : 90;
  const size = orientedSize(item, rotation);
  // Prefer an open edge on the plan. This is only a starting position, not a clearance check.
  const xs = [0, ...scene.objects.map(object => object.placement.x + orientedSize(object.item, object.placement.rotation).width + .15)];
  const zs = [0, ...scene.objects.map(object => object.placement.z + orientedSize(object.item, object.placement.rotation).depth + .15)];
  for (const z of zs) for (const x of xs) {
    if (x + size.width > scene.room.width + EPS || z + size.depth > scene.room.depth + EPS) continue;
    const free = scene.objects.every(object => {
      const other = orientedSize(object.item, object.placement.rotation), at = object.placement;
      return x + size.width <= at.x || at.x + other.width <= x || z + size.depth <= at.z || at.z + other.depth <= z;
    });
    if (free) return boundedPlacement(item, { itemId: item.id, x, z, rotation }, scene.room);
  }
  return boundedPlacement(item, { itemId: item.id, x: Math.max(0, (scene.room.width - size.width) / 2), z: Math.max(0, (scene.room.depth - size.depth) / 2), rotation }, scene.room);
}
function assertCapacity(scene: DesignScene) {
  if (scene.objects.length >= MAX_SCENE_OBJECTS) throw new Error(`Keep up to ${MAX_SCENE_OBJECTS} objects in one scene. Remove an object before adding another.`);
}

export function addObject(scene: DesignScene, catalogId: string): DesignScene {
  assertCapacity(scene);
  const item = createCatalogItem(catalogId);
  return { ...scene, objects: [...scene.objects, { item, placement: nextPlacement(scene, item) }] };
}

export function updateObject(scene: DesignScene, id: string, update: ObjectUpdate): DesignScene {
  const original = scene.objects.find(object => object.item.id === id);
  if (!original) throw new Error('Select an object in this scene.');
  const patch = update.item ?? {};
  const item = { ...original.item, ...patch, id, width: checkedDimension(patch.width ?? original.item.width), depth: checkedDimension(patch.depth ?? original.item.depth), height: checkedDimension(patch.height ?? original.item.height) };
  if (!validItem(item)) throw new Error('Use a supported object, a label of up to 120 characters, and a six-digit hex color.');
  const placement = boundedPlacement(item, { ...original.placement, ...update.placement, itemId: id }, scene.room);
  return { ...scene, objects: scene.objects.map(object => object.item.id === id ? { item, placement } : object) };
}

export function duplicateObject(scene: DesignScene, id: string): DesignScene {
  assertCapacity(scene);
  const original = scene.objects.find(object => object.item.id === id);
  if (!original) throw new Error('Select an object to duplicate.');
  const item = { ...original.item, id: crypto.randomUUID(), label: `${original.item.label.slice(0, 115)} copy` };
  const placement = nextPlacement(scene, item);
  if (original.placement.elevation !== undefined) placement.elevation = original.placement.elevation;
  return { ...scene, objects: [...scene.objects, { item, placement }] };
}

export function removeObject(scene: DesignScene, id: string): DesignScene {
  return { ...scene, objects: scene.objects.filter(object => object.item.id !== id) };
}

export function resizeScene(scene: DesignScene, room: RoomSize): DesignScene {
  if (!validRoom(room)) throw new Error('Use space dimensions between 0.01 and 30 metres.');
  return { ...scene, room: { ...room }, objects: scene.objects.map(object => ({ item: { ...object.item }, placement: boundedPlacement(object.item, object.placement, room) })) };
}

export function createStarterScene(kind: 'living-room' | 'workspace'): DesignScene {
  let scene = createScene(kind === 'living-room' ? 'Living room concept' : 'Workspace concept', { width: 5, depth: 4, height: 2.7 });
  const starters = kind === 'living-room'
    ? [{ id: 'rug', x: .8, z: .7 }, { id: 'sofa', x: .65, z: .15 }, { id: 'coffee-table', x: 1.15, z: 1.4 }, { id: 'floor-plant', x: 3.4, z: .3 }, { id: 'floor-lamp', x: .1, z: .2 }]
    : [{ id: 'desk', x: 1.1, z: .2 }, { id: 'chair', x: 1.45, z: .9, rotation: 180 as const }, { id: 'monitor', x: 1.4, z: .27, elevation: .75 }, { id: 'laptop', x: 1.15, z: .47, elevation: .75 }, { id: 'bookcase', x: 3.3, z: .2 }, { id: 'desk-plant', x: 2, z: .4, elevation: .75 }];
  for (const entry of starters) {
    scene = addObject(scene, entry.id);
    const added = scene.objects[scene.objects.length - 1];
    scene = updateObject(scene, added.item.id, { placement: { x: entry.x, z: entry.z, rotation: 'rotation' in entry ? entry.rotation : 0, elevation: 'elevation' in entry ? entry.elevation : 0 } });
  }
  return scene;
}

export function loadScene(): DesignScene | null {
  try {
    const raw = localStorage.getItem(SCENE_STORAGE_KEY);
    return raw && raw.length < 128_000 ? parseScene(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function saveScene(scene: DesignScene): void {
  const valid = parseScene(scene);
  if (!valid) throw new Error('This scene has invalid dimensions or object data. Fix them before saving.');
  try { localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(valid)); }
  catch { throw new Error('This scene could not be saved in this browser. Export it before leaving.'); }
}
