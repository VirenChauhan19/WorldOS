import { createCatalogItem } from './catalog';
import { FURNITURE_KINDS, INTERIOR_MODELS, orientedSize } from '../room/layout';
import type { FurnitureItem, FurniturePlacement, FurnitureRotation, RoomSize } from '../room/layout';

export const MOUNT_SURFACES = ['free', 'back-wall', 'front-wall', 'left-wall', 'right-wall', 'ceiling'] as const;
export type MountSurface = typeof MOUNT_SURFACES[number];
export interface DesignPlacement extends FurniturePlacement { mount?: MountSurface }
export interface DesignObject { item: FurnitureItem; placement: DesignPlacement }
export interface DesignScene { version: 1; name: string; room: RoomSize; objects: DesignObject[]; finishes?: { wallColor: string; floorColor: string } }
export type ObjectUpdate = { item?: Partial<FurnitureItem>; placement?: Partial<DesignPlacement> };
export const MAX_SCENE_OBJECTS = 24;
export const SCENE_STORAGE_KEY = 'worldos.design-scene.v1';
const EPS = 1e-9;
const rotations: readonly number[] = [0, 90, 180, 270];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const dimension = (value: unknown): value is number => finite(value) && value >= .01 && value <= 30;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const wallRotations = { 'back-wall': 0, 'front-wall': 180, 'left-wall': 270, 'right-wall': 90 } as const;
const ceilingHeight = (room: RoomSize) => room.height ?? 2.7;
const copyItem = (item: FurnitureItem): FurnitureItem => ({ ...item, ...(item.light ? { light: { ...item.light } } : {}) });

function validRoom(value: unknown): value is RoomSize {
  const room = value as RoomSize | null;
  return !!room && dimension(room.width) && dimension(room.depth) && (room.height === undefined || dimension(room.height));
}
function validItem(value: unknown): value is FurnitureItem {
  const item = value as FurnitureItem | null;
  return !!item && text(item.id, 100) && text(item.label, 120) && FURNITURE_KINDS.includes(item.kind)
    && [item.width, item.depth, item.height].every(dimension) && validColor(item.color)
    && (item.model === undefined || INTERIOR_MODELS.includes(item.model))
    && (item.light === undefined || !!item.light && typeof item.light === 'object' && typeof item.light.enabled === 'boolean'
      && [2700,4000,6500].includes(item.light.temperature) && finite(item.light.brightness) && item.light.brightness >= 0 && item.light.brightness <= 100);
}
function validPlacement(value: unknown, item: FurnitureItem, room: RoomSize): value is DesignPlacement {
  const placement = value as DesignPlacement | null;
  if (!placement || placement.itemId !== item.id || !rotations.includes(placement.rotation)
    || !finite(placement.x) || !finite(placement.z) || placement.x < 0 || placement.z < 0
    || placement.elevation !== undefined && (!finite(placement.elevation) || placement.elevation < 0 || placement.elevation > 10)
    || placement.mount !== undefined && !MOUNT_SURFACES.includes(placement.mount)) return false;
  const size = orientedSize(item, placement.rotation);
  if (placement.x + size.width > room.width + EPS || placement.z + size.depth > room.depth + EPS) return false;
  const mount = placement.mount;
  if (!mount || mount === 'free') return true;
  if ((placement.elevation ?? 0) + item.height > ceilingHeight(room) + EPS) return false;
  if (mount === 'ceiling') return Math.abs((placement.elevation ?? 0) + item.height - ceilingHeight(room)) <= EPS;
  if (placement.rotation !== wallRotations[mount]) return false;
  return mount === 'back-wall' ? Math.abs(placement.z) <= EPS
    : mount === 'front-wall' ? Math.abs(placement.z + size.depth - room.depth) <= EPS
    : mount === 'left-wall' ? Math.abs(placement.x) <= EPS
    : Math.abs(placement.x + size.width - room.width) <= EPS;
}

/** Strict, bounded restoration. Unknown metadata and world-tracking transforms are discarded. */
export function parseScene(value: unknown): DesignScene | null {
  const scene = value as DesignScene | null;
  if (!scene || scene.version !== 1 || !text(scene.name, 80) || !validRoom(scene.room)
    || !Array.isArray(scene.objects) || scene.objects.length > MAX_SCENE_OBJECTS
    || scene.finishes !== undefined && (!scene.finishes || !validColor(scene.finishes.wallColor) || !validColor(scene.finishes.floorColor))) return null;
  const ids = new Set<string>();
  const objects: DesignObject[] = [];
  for (const object of scene.objects) {
    if (!object || !validItem(object.item) || ids.has(object.item.id) || !validPlacement(object.placement, object.item, scene.room)) return null;
    ids.add(object.item.id);
    const { id, kind, label, width, depth, height, color, model, light } = object.item;
    const { x, z, rotation, elevation, mount } = object.placement;
    objects.push({ item: { id, kind, label, width, depth, height, color, ...(model === undefined ? {} : { model }), ...(light === undefined ? {} : { light: { enabled: light.enabled, temperature: light.temperature, brightness: light.brightness } }) }, placement: { itemId: id, x, z, rotation, ...(elevation === undefined ? {} : { elevation }), ...(mount === undefined ? {} : { mount }) } });
  }
  return { version: 1, name: scene.name.trim(), room: { width: scene.room.width, depth: scene.room.depth, ...(scene.room.height === undefined ? {} : { height: scene.room.height }) }, objects, ...(scene.finishes === undefined ? {} : { finishes: { wallColor: scene.finishes.wallColor, floorColor: scene.finishes.floorColor } }) };
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
export function defaultMount(item: FurnitureItem): MountSurface {
  if (item.model === 'pendant-light' || item.model === 'ceiling-light') return 'ceiling';
  return item.model ? 'back-wall' : 'free';
}
function mountingHeight(item: FurnitureItem): number {
  return item.model === 'wall-clock' ? 1.6 : item.model === 'wall-sconce' ? 1.5 : item.model === 'wall-shelf' ? 1.3 : item.model === 'wall-tv' ? 1.1 : item.model === 'curtains' ? .05 : 1.2;
}
function boundedPlacement(item: FurnitureItem, placement: DesignPlacement, room: RoomSize): DesignPlacement {
  if (!rotations.includes(placement.rotation)) throw new Error('Rotate objects in quarter turns.');
  if (![placement.x, placement.z, placement.elevation ?? 0].every(finite)) throw new Error('Enter a finite object position.');
  const mount = placement.mount;
  if (mount !== undefined && !MOUNT_SURFACES.includes(mount)) throw new Error('Choose a supported mounting surface.');
  const rotation = mount && mount !== 'free' && mount !== 'ceiling' ? wallRotations[mount] : placement.rotation;
  const size = orientedSize(item, rotation);
  if (size.width > room.width + EPS || size.depth > room.depth + EPS) throw new Error(`${item.label} is larger than this plan. Resize the object or increase the space dimensions.`);
  const next: DesignPlacement = { itemId: item.id, x: clamp(placement.x, 0, Math.max(0, room.width - size.width)), z: clamp(placement.z, 0, Math.max(0, room.depth - size.depth)), rotation, ...(placement.elevation === undefined ? {} : { elevation: clamp(placement.elevation, 0, 10) }), ...(mount === undefined ? {} : { mount }) };
  if (!mount || mount === 'free') return next;
  if (item.height > ceilingHeight(room) + EPS) throw new Error(`${item.label} is too tall for this room. Increase the ceiling height or reduce the object height.`);
  if (mount === 'ceiling') {
    const elevation = ceilingHeight(room) - item.height;
    if (elevation > 10) throw new Error('The ceiling mount is more than 10 m above the floor. Lower the plan ceiling.');
    return { ...next, elevation: Math.max(0, elevation) };
  }
  next.elevation = clamp(placement.elevation ?? mountingHeight(item), 0, Math.min(10, ceilingHeight(room) - item.height));
  if (mount === 'back-wall') next.z = 0;
  else if (mount === 'front-wall') next.z = room.depth - size.depth;
  else if (mount === 'left-wall') next.x = 0;
  else next.x = room.width - size.width;
  return next;
}
function nextPlacement(scene: DesignScene, item: FurnitureItem): DesignPlacement {
  const mount = defaultMount(item);
  if (mount !== 'free') return boundedPlacement(item, { itemId: item.id, x: (scene.room.width - item.width) / 2, z: (scene.room.depth - item.depth) / 2, rotation: 0, mount, elevation: mountingHeight(item) }, scene.room);
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
  const item = copyItem({ ...original.item, ...patch, id, width: checkedDimension(patch.width ?? original.item.width), depth: checkedDimension(patch.depth ?? original.item.depth), height: checkedDimension(patch.height ?? original.item.height) });
  if (!validItem(item)) throw new Error('Use a supported object, a label of up to 120 characters, and a six-digit hex color.');
  const placement = boundedPlacement(item, { ...original.placement, ...update.placement, itemId: id }, scene.room);
  return { ...scene, objects: scene.objects.map(object => object.item.id === id ? { item, placement } : object) };
}

/** Mount against the editable plan envelope, not an inferred physical wall. */
export function mountObject(scene: DesignScene, id: string, mount: MountSurface): DesignScene {
  const object = scene.objects.find(object => object.item.id === id);
  if (!object) throw new Error('Select an object in this scene.');
  if (!MOUNT_SURFACES.includes(mount)) throw new Error('Choose a supported mounting surface.');
  const elevation = mount === 'free' ? object.placement.elevation : object.placement.mount === 'ceiling' || !(object.placement.elevation ?? 0) ? mountingHeight(object.item) : object.placement.elevation;
  const entering = mount !== 'free' && mount !== object.placement.mount;
  const rotation = mount === 'free' || mount === 'ceiling' ? object.placement.rotation : wallRotations[mount];
  const size = orientedSize(object.item, rotation);
  const center = entering ? { x: (scene.room.width - size.width) / 2, z: (scene.room.depth - size.depth) / 2 } : {};
  return updateObject(scene, id, { placement: { mount, ...center, ...(elevation === undefined ? {} : { elevation }) } });
}

export function duplicateObject(scene: DesignScene, id: string): DesignScene {
  assertCapacity(scene);
  const original = scene.objects.find(object => object.item.id === id);
  if (!original) throw new Error('Select an object to duplicate.');
  const item = copyItem({ ...original.item, id: crypto.randomUUID(), label: `${original.item.label.slice(0, 115)} copy` });
  const mount = original.placement.mount;
  let placement: DesignPlacement;
  if (mount && mount !== 'free') {
    const alongX = mount === 'back-wall' || mount === 'front-wall' || mount === 'ceiling';
    const bounds = orientedSize(item, original.placement.rotation);
    placement = boundedPlacement(item, { ...original.placement, itemId: item.id, ...(alongX ? { x: original.placement.x + bounds.width + .15 } : { z: original.placement.z + bounds.depth + .15 }) }, scene.room);
  } else {
    // Explicitly detached wall/ceiling models must stay detached when copied.
    placement = nextPlacement(scene, { ...item, model: undefined });
    if (mount === 'free') placement.mount = 'free';
    if (original.placement.elevation !== undefined) placement.elevation = original.placement.elevation;
  }
  return { ...scene, objects: [...scene.objects, { item, placement }] };
}

export function removeObject(scene: DesignScene, id: string): DesignScene {
  return { ...scene, objects: scene.objects.filter(object => object.item.id !== id) };
}

export const SURFACE_KINDS: readonly FurnitureItem['kind'][] = ['table', 'desk', 'shelf', 'custom'];

/** Place one piece on a modeled top surface. This creates no attachment relation. */
export function surfacePlacement(scene: DesignScene, id: string, surfaceId: string): DesignPlacement {
  const object = scene.objects.find(object => object.item.id === id), surface = scene.objects.find(object => object.item.id === surfaceId);
  if (!object || !surface) throw new Error('Choose a piece and a surface in this design.');
  if (id === surfaceId) throw new Error('Choose another piece as the surface.');
  if (!SURFACE_KINDS.includes(surface.item.kind)) throw new Error('Choose a table, desk, shelf, or custom surface.');
  const size = orientedSize(object.item, object.placement.rotation), top = orientedSize(surface.item, surface.placement.rotation);
  if (size.width > top.width + EPS || size.depth > top.depth + EPS) throw new Error(`${object.item.label} is too large for ${surface.item.label}.`);
  // Recover existing support chains from footprint and height. Never move a
  // support underneath a piece already resting on it onto that same piece.
  const visited = new Set<string>();
  function supportedBy(current: DesignObject): boolean {
    if (visited.has(current.item.id)) return false;
    visited.add(current.item.id);
    const footprint = orientedSize(current.item, current.placement.rotation), bottom = current.placement.elevation ?? 0;
    return scene.objects.some(candidate => {
      if (candidate.item.id === current.item.id || !SURFACE_KINDS.includes(candidate.item.kind)) return false;
      const bounds = orientedSize(candidate.item, candidate.placement.rotation), at = candidate.placement;
      const rests = Math.abs(bottom - ((at.elevation ?? 0) + candidate.item.height)) < 1e-6
        && current.placement.x >= at.x - EPS && current.placement.z >= at.z - EPS
        && current.placement.x + footprint.width <= at.x + bounds.width + EPS
        && current.placement.z + footprint.depth <= at.z + bounds.depth + EPS;
      return rests && (candidate.item.id === id || supportedBy(candidate));
    });
  }
  if (supportedBy(surface)) throw new Error('This surface is resting on the selected piece. Choose another surface.');
  const elevation = (surface.placement.elevation ?? 0) + surface.item.height;
  if (elevation > 10 || scene.room.height !== undefined && elevation + object.item.height > scene.room.height + EPS) throw new Error('This piece would be above the plan ceiling. Choose a lower surface.');
  const placement = { ...object.placement, ...(object.placement.mount === undefined ? {} : { mount: 'free' as const }), x: surface.placement.x + (top.width - size.width) / 2, z: surface.placement.z + (top.depth - size.depth) / 2, elevation };
  if (!validPlacement(placement, object.item, scene.room)) throw new Error('This surface is outside your plan.');
  return placement;
}

export function resizeScene(scene: DesignScene, room: RoomSize): DesignScene {
  if (!validRoom(room)) throw new Error('Use space dimensions between 0.01 and 30 metres.');
  return { ...scene, room: { ...room }, objects: scene.objects.map(object => ({ item: copyItem(object.item), placement: boundedPlacement(object.item, object.placement, room) })) };
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
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('worldos:design-saved'));
}

export function deleteScene(): void {
  try { localStorage.removeItem(SCENE_STORAGE_KEY); }
  catch { throw new Error('This design could not be deleted from this browser. Try again.'); }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('worldos:design-deleted'));
}
