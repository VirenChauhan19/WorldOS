import type { XRPoint } from '../live/xr-types';
import { orientedSize } from '../room/layout';
import { parseScene } from './scene';
import type { DesignScene } from './scene';

const finitePoint = (point: XRPoint) => !!point && [point.x, point.y, point.z].every(Number.isFinite);

/** Convert a session hit to the saved plan without moving other placed objects.
 * The returned origin is session-only; the scene contains ordinary plan data. */
export function placeSceneObject(scene: DesignScene, id: string, position: XRPoint, origin: XRPoint | null): { scene: DesignScene; origin: XRPoint } {
  const valid = parseScene(scene);
  if (!valid) throw new Error('Fix the design dimensions before placing an object.');
  if (!finitePoint(position) || origin !== null && !finitePoint(origin)) throw new Error('Wait for a tracked surface before placing this object.');
  const selected = valid.objects.find(object => object.item.id === id);
  if (!selected) throw new Error('Select an object in this design to place.');
  const size = orientedSize(selected.item, selected.placement.rotation);
  const base = origin ?? {
    x: position.x - selected.placement.x - size.width / 2,
    y: position.y - (selected.placement.elevation ?? 0),
    z: position.z - selected.placement.z - size.depth / 2,
  };
  const target = {
    x: position.x - base.x - size.width / 2,
    z: position.z - base.z - size.depth / 2,
    elevation: position.y - base.y,
  };
  const shift = { x: Math.max(0, -target.x), y: Math.max(0, -target.elevation), z: Math.max(0, -target.z) };
  const nextOrigin = { x: base.x - shift.x, y: base.y - shift.y, z: base.z - shift.z };
  let width = valid.room.width, depth = valid.room.depth, height = valid.room.height ?? 2.7;
  const objects = valid.objects.map(object => {
    const source = object.item.id === id ? { ...object.placement, ...target } : object.placement;
    const elevation = (source.elevation ?? 0) + shift.y;
    if (!Number.isFinite(elevation) || elevation > 10) throw new Error('Choose a closer floor level. Every object must stay within 10 m above the design floor.');
    const placement = {
      ...source,
      x: source.x + shift.x,
      z: source.z + shift.z,
      ...(source.elevation !== undefined || shift.y !== 0 ? { elevation } : {}),
    };
    const bounds = orientedSize(object.item, placement.rotation);
    width = Math.max(width, placement.x + bounds.width);
    depth = Math.max(depth, placement.z + bounds.depth);
    height = Math.max(height, elevation + object.item.height);
    return { item: object.item, placement };
  });
  if (![width, depth, height].every(value => Number.isFinite(value) && value <= 30) || !finitePoint(nextOrigin)) {
    throw new Error('Place this object closer to your design. The plan can be at most 30 m wide, long, and high.');
  }
  const next = parseScene({ ...valid, room: { width, depth, height }, objects });
  if (!next) throw new Error('This surface cannot be saved as a valid design position. Choose another spot.');
  return { scene: next, origin: nextOrigin };
}
