import { describe, expect, it } from 'vitest';
import { assessRoomLayout, FURNITURE_PRESETS, orientedSize, planRoom } from './layout';
import type { FurnitureItem, FurniturePlacement, RoomSize } from './layout';

const box = (id: string, width: number, depth: number, height = 1): FurnitureItem => ({ id, kind: 'table', label: id, width, depth, height, color: '#999999' });
const at = (itemId: string, x: number, z: number, rotation: 0 | 90 = 0): FurniturePlacement => ({ itemId, x, z, rotation });
const four = FURNITURE_PRESETS.filter(item => ['bed', 'desk', 'table', 'wardrobe'].includes(item.kind));

describe('simultaneous furniture planning', () => {
  it('places the queen frame, desk, table and wardrobe together in a 4 by 4.5 m room', () => {
    const room = { width: 4, depth: 4.5, height: 2.5 };
    const original = structuredClone(four);
    const result = planRoom(room, four, .3);
    expect(result.status).toBe('fits');
    expect(result.placements).toHaveLength(4);
    expect(result.unplacedIds).toEqual([]);
    expect(assessRoomLayout(room, four, result.placements, .3).issues).toEqual([]);
    expect(result.occupiedArea).toBeCloseTo(1.65 * 2.15 + 1.2 * .6 + .9 * .9 + 1.2 * .6);
    expect(result.occupiedArea + result.freeArea).toBeCloseTo(18);
    expect(four).toEqual(original);
    expect(planRoom(room, four, .3)).toEqual(result);
  });

  it('uses the actual entered dimensions and rotates an item when necessary', () => {
    const item = box('long', 2.4, .8);
    const result = planRoom({ width: 1, depth: 3 }, [item]);
    expect(result.status).toBe('fits');
    expect(result.placements[0].rotation).toBe(90);
    expect(orientedSize(item, 90)).toEqual({ width: .8, depth: 2.4 });
    expect(planRoom({ width: .7, depth: 3 }, [item]).status).toBe('conflict');
  });

  it.each([{ width: 4, depth: 4.5 }, { width: 5.5, depth: 5 }])('reserves walls for the bed and tall storage in an ample $width by $depth m room', room => {
    // Small pieces occur first in the input to ensure they cannot consume the useful walls first.
    const items = [...four].reverse();
    const result = planRoom(room, items, .3);
    expect(result.status).toBe('fits');
    const footprint = (kind: FurnitureItem['kind']) => {
      const item = items.find(value => value.kind === kind)!;
      const placement = result.placements.find(value => value.itemId === item.id)!;
      return { ...placement, ...orientedSize(item, placement.rotation) };
    };
    const bed = footprint('bed'), wardrobe = footprint('wardrobe'), desk = footprint('desk'), table = footprint('table');
    const backDistance = (value: typeof bed) => value.rotation === 0 ? value.z : room.width - value.x - value.width;
    expect(backDistance(bed)).toBeCloseTo(0);
    expect(backDistance(wardrobe)).toBeCloseTo(0);
    expect(wardrobe.x + wardrobe.width / 2).toBeGreaterThan(bed.x + bed.width / 2);
    expect(Math.min(desk.x, desk.z, room.width - desk.x - desk.width, room.depth - desk.z - desk.depth)).toBeCloseTo(0);
    expect(table.z + table.depth / 2).toBeGreaterThan(room.depth / 2);
    expect(Math.abs(table.x + table.width / 2 - room.width / 2)).toBeLessThan(room.width / 3);
    expect(result.freeArea).toBeGreaterThan(result.occupiedArea);
    expect(assessRoomLayout(room, items, result.placements, .3).issues).toEqual([]);
  });

  it('proves an area shortfall without treating a heuristic failure as proof', () => {
    const oversized = planRoom({ width: 2, depth: 2 }, [box('a', 2, 1.2), box('b', 2, 1.2)], 0);
    expect(oversized.status).toBe('conflict');
    expect(oversized.issues.some(value => value.type === 'insufficient-area')).toBe(true);
    expect(oversized.unplacedIds.length).toBeGreaterThan(0);
    const constrained = planRoom({ width: 2, depth: 2 }, [box('a', 1, 1), box('b', 1, 1)], 2);
    expect(constrained.status).toBe('partial');
    expect(constrained.reason).toContain('does not prove');
    expect(constrained.issues.some(value => value.type === 'search-incomplete')).toBe(true);
  });

  it('keeps other items placeable when one item exceeds the room or its height', () => {
    const items = [box('wide', 5, 5), box('small', .5, .5), box('tall', .5, .5, 3)];
    const result = planRoom({ width: 3, depth: 3, height: 2.4 }, items);
    expect(result.status).toBe('conflict');
    expect(result.placements.map(value => value.itemId)).toEqual(['small']);
    expect(result.unplacedIds).toEqual(['wide', 'tall']);
    expect(result.issues.some(value => value.type === 'height')).toBe(true);
    expect(result.issues.some(value => value.type === 'oversized-item')).toBe(true);
  });

  it('handles twelve items and does not mutate presets or placement state', () => {
    const items = Array.from({ length: 12 }, (_, index) => box(String(index), .5, .5));
    const result = planRoom({ width: 4, depth: 4.5 }, items, .3);
    expect(result.status).toBe('fits');
    expect(result.placements).toHaveLength(12);
    expect(assessRoomLayout({ width: 4, depth: 4.5 }, items, result.placements, .3).status).toBe('fits');
  });
});

describe('independent assessment of edited placements', () => {
  const room: RoomSize = { width: 4, depth: 4, height: 2.5 };
  const items = [box('a', 1, 1), box('b', 1, 1)];

  it('detects overlaps and counts their occupied union only once', () => {
    const result = assessRoomLayout(room, items, [at('a', 0, 0), at('b', .5, 0)], 0);
    expect(result.status).toBe('conflict');
    expect(result.issues.some(value => value.type === 'overlap')).toBe(true);
    expect(result.occupiedArea).toBeCloseTo(1.5);
    expect(result.freeArea).toBeCloseTo(14.5);
  });

  it('checks gaps between items without inventing wall clearance', () => {
    expect(assessRoomLayout(room, items, [at('a', 0, 0), at('b', 1.3, 0)], .3).status).toBe('fits');
    const close = assessRoomLayout(room, items, [at('a', 0, 0), at('b', 1.29, 0)], .3);
    expect(close.status).toBe('conflict');
    expect(close.issues.map(value => value.type)).toContain('clearance');
    expect(assessRoomLayout(room, items, [at('a', 0, 0), at('b', 1, 0)], 0).status).toBe('fits');
  });

  it('uses shortest footprint distance for a diagonal gap', () => {
    expect(assessRoomLayout(room, items, [at('a', 0, 0), at('b', 1.25, 1.25)], .3).status).toBe('fits');
    expect(assessRoomLayout(room, items, [at('a', 0, 0), at('b', 1.2, 1.2)], .3).status).toBe('conflict');
  });

  it('rejects room-boundary crossings and clips area to the room', () => {
    const result = assessRoomLayout(room, [items[0]], [at('a', -.5, 0)], 0);
    expect(result.status).toBe('conflict');
    expect(result.issues.map(value => value.type)).toContain('bounds');
    expect(result.occupiedArea).toBeCloseTo(.5);
    expect(result.freeArea).toBeCloseTo(15.5);
  });

  it('requires every selected item and checks entered heights', () => {
    expect(assessRoomLayout(room, items, [at('a', 0, 0)]).status).toBe('partial');
    const tall = [{ ...items[0], height: 2.6 }];
    expect(assessRoomLayout(room, tall, [at('a', 0, 0)]).status).toBe('conflict');
    const noHeight = assessRoomLayout({ width: 4, depth: 4 }, tall, [at('a', 0, 0)]);
    expect(noHeight.status).toBe('fits');
    expect(noHeight.reason).toContain('Height is not checked');
  });

  it('validates edited rotations, coordinates, references and duplicate placements', () => {
    for (const placements of [
      [at('a', NaN, 0)], [at('a', 0, Infinity)], [at('missing', 0, 0)],
      [at('a', 0, 0), at('a', 2, 2)], [{ ...at('a', 0, 0), rotation: 45 } as unknown as FurniturePlacement],
    ]) expect(assessRoomLayout(room, items, placements).status).toBe('unknown');
  });
});

describe('input and numeric boundaries', () => {
  it.each([0, -1, NaN, Infinity, 30.001])('rejects invalid dimension %s', value => {
    const item = box('item', 1, 1);
    for (const key of ['width', 'depth', 'height'] as const) {
      expect(planRoom({ width: 4, depth: 4, [key]: value }, [item]).status).toBe('unknown');
      expect(planRoom({ width: 4, depth: 4 }, [{ ...item, [key]: value }]).status).toBe('unknown');
    }
  });

  it('rejects invalid gaps, duplicate item identities, absent room and excessive item count', () => {
    const item = box('item', 1, 1), room = { width: 4, depth: 4 };
    for (const gap of [-1, NaN, Infinity, 30.001]) expect(planRoom(room, [item], gap).status).toBe('unknown');
    expect(planRoom(null, [item]).status).toBe('unknown');
    expect(planRoom(room, [item, item]).status).toBe('unknown');
    expect(planRoom(room, Array.from({ length: 13 }, (_, i) => ({ ...item, id: String(i) }))).status).toBe('unknown');
  });

  it('permits the exact 30 m limit and reports an empty room without occupied area', () => {
    expect(planRoom({ width: 30, depth: 30 }, [box('whole', 30, 30, 30)], 0).status).toBe('fits');
    const empty = assessRoomLayout({ width: 3, depth: 4 }, [], []);
    expect(empty.occupiedArea).toBe(0);
    expect(empty.freeArea).toBe(12);
  });
});
