import { describe, expect, it } from 'vitest';
import type { XRPoint } from '../live/xr-types';
import { orientedSize } from '../room/layout';
import { placeSceneObject } from './placement';
import { parseScene } from './scene';
import type { DesignScene } from './scene';

function design(): DesignScene {
  return {
    version: 1, name: 'Placement example', room: { width: 5, depth: 4, height: 2.7 },
    objects: [
      { item: { id: 'desk', kind: 'desk', label: 'Desk', width: 2, depth: 1, height: .75, color: '#779977' }, placement: { itemId: 'desk', x: 1, z: 1, rotation: 0 } },
      { item: { id: 'monitor', kind: 'monitor', label: 'Monitor', width: .6, depth: .2, height: .4, color: '#333333' }, placement: { itemId: 'monitor', x: 1.4, z: 1.3, rotation: 90, elevation: .75 } },
    ],
  };
}

function world(scene: DesignScene, id: string, origin: XRPoint): XRPoint {
  const object = scene.objects.find(value => value.item.id === id)!;
  const size = orientedSize(object.item, object.placement.rotation);
  return { x: origin.x + object.placement.x + size.width / 2, y: origin.y + (object.placement.elevation ?? 0), z: origin.z + object.placement.z + size.depth / 2 };
}
function expectPoint(actual: XRPoint, expected: XRPoint) {
  expect(actual.x).toBeCloseTo(expected.x, 10);
  expect(actual.y).toBeCloseTo(expected.y, 10);
  expect(actual.z).toBeCloseTo(expected.z, 10);
}

describe('physical placement saved as a coherent plan', () => {
  it('infers the first origin from the rotated footprint and existing elevation', () => {
    const scene = design(), snapshot = structuredClone(scene), position = { x: 8, y: 1.2, z: -3 };
    const result = placeSceneObject(scene, 'monitor', position, null);
    expectPoint(result.origin, { x: 6.5, y: .45, z: -4.6 });
    expectPoint(world(result.scene, 'monitor', result.origin), position);
    expect(result.scene.objects[0]).toEqual(scene.objects[0]);
    expect(result.scene.objects[1].placement.x).toBeCloseTo(scene.objects[1].placement.x);
    expect(result.scene.objects[1].placement.z).toBeCloseTo(scene.objects[1].placement.z);
    expect(result.scene.objects[1].placement.elevation).toBeCloseTo(.75);
    expect(scene).toEqual(snapshot);
    expect(parseScene(result.scene)).toEqual(result.scene);
    expect(JSON.stringify(result.scene)).not.toContain('origin');
    expect(JSON.stringify(result.scene)).not.toContain('position');
  });

  it('keeps an in-plan placement exact and leaves the origin and other objects unchanged', () => {
    const scene = design(), origin = { x: 10, y: -.25, z: -4 }, position = { x: 13, y: .5, z: -2 };
    const result = placeSceneObject(scene, 'monitor', position, origin);
    expect(result.origin).toEqual(origin);
    expect(result.origin).not.toBe(origin);
    expectPoint(world(result.scene, 'monitor', result.origin), position);
    expect(result.scene.objects[0]).toEqual(scene.objects[0]);
    expect(result.scene.room).toEqual(scene.room);
  });

  it('expands positive plan bounds instead of clamping a physical hit', () => {
    const scene = design(), origin = { x: 0, y: 0, z: 0 }, position = { x: 8, y: 4, z: 6 };
    const result = placeSceneObject(scene, 'monitor', position, origin);
    expect(result.scene.room.width).toBeCloseTo(8.1);
    expect(result.scene.room.depth).toBeCloseTo(6.3);
    expect(result.scene.room.height).toBeCloseTo(4.4);
    expectPoint(world(result.scene, 'monitor', result.origin), position);
    expectPoint(world(result.scene, 'desk', result.origin), world(scene, 'desk', origin));
  });

  it('rebases both negative axes while preserving every other physical position', () => {
    const scene = design(), origin = { x: 4, y: .5, z: 8 }, position = { x: 1, y: .5, z: 6 };
    const result = placeSceneObject(scene, 'monitor', position, origin);
    expectPoint(result.origin, { x: .9, y: .5, z: 5.7 });
    expect(result.scene.objects[1].placement).toMatchObject({ x: 0, z: 0, elevation: 0 });
    expect(result.scene.room.width).toBeCloseTo(6.1);
    expect(result.scene.room.depth).toBeCloseTo(4.3);
    expectPoint(world(result.scene, 'monitor', result.origin), position);
    expectPoint(world(result.scene, 'desk', result.origin), world(scene, 'desk', origin));
  });

  it('lowers the floor after a tabletop placement without lowering previously placed objects', () => {
    const scene = design(), tableOrigin = { x: 0, y: .75, z: 0 }, position = { x: 3, y: 0, z: 2 };
    const result = placeSceneObject(scene, 'desk', position, tableOrigin);
    expect(result.origin.y).toBe(0);
    expect(result.scene.objects[0].placement.elevation).toBe(0);
    expect(result.scene.objects[1].placement.elevation).toBe(1.5);
    expectPoint(world(result.scene, 'desk', result.origin), position);
    expectPoint(world(result.scene, 'monitor', result.origin), world(scene, 'monitor', tableOrigin));
  });

  it('maintains the plan-to-world relationship over successive moves and rebases', () => {
    let scene = design(), origin: XRPoint | null = null;
    const expected = new Map<string, XRPoint>();
    for (const [id, position] of [
      ['desk', { x: 2, y: .8, z: -2 }],
      ['monitor', { x: -1, y: 1.55, z: -4 }],
      ['desk', { x: 3, y: 0, z: 2 }],
      ['monitor', { x: 8, y: .75, z: 4 }],
    ] as const) {
      const result = placeSceneObject(scene, id, position, origin);
      scene = result.scene; origin = result.origin; expected.set(id, position);
      for (const [otherId, otherPosition] of expected) expectPoint(world(scene, otherId, origin), otherPosition);
      expect(parseScene(scene)).toEqual(scene);
    }
  });

  it('accepts exact size and elevation limits without modifying the requested target', () => {
    const scene = design(), position = { x: 29, y: 10, z: 29.5 };
    const result = placeSceneObject(scene, 'desk', position, { x: 0, y: 0, z: 0 });
    expect(result.scene.room).toEqual({ width: 30, depth: 30, height: 10.75 });
    expectPoint(world(result.scene, 'desk', result.origin), position);
  });

  it.each([
    [{ x: 30, y: 0, z: 2 }, '30 m'],
    [{ x: 2, y: 0, z: 30 }, '30 m'],
    [{ x: -29, y: 0, z: 2 }, '30 m'],
    [{ x: 2, y: 10.1, z: 2 }, '10 m'],
    [{ x: 2, y: -10, z: 2 }, '10 m'],
  ] as const)('rejects an out-of-limit hit atomically: %j', (position, message) => {
    const scene = design(), before = structuredClone(scene), origin = { x: 0, y: 0, z: 0 };
    expect(() => placeSceneObject(scene, 'desk', position, origin)).toThrow(message);
    expect(scene).toEqual(before);
    expect(origin).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rejects object tops over the maximum plan height', () => {
    const scene = design(); scene.objects[0].item.height = 25;
    expect(() => placeSceneObject(scene, 'desk', { x: 2, y: 6, z: 2 }, { x: 0, y: 0, z: 0 })).toThrow('30 m');
  });

  it('rejects missing objects, invalid scenes, and non-finite session coordinates', () => {
    const scene = design(), position = { x: 1, y: 0, z: 1 };
    expect(() => placeSceneObject(scene, 'missing', position, null)).toThrow('Select an object');
    expect(() => placeSceneObject({ ...scene, room: { width: 1, depth: 1 } }, 'desk', position, null)).toThrow('dimensions');
    expect(() => placeSceneObject(scene, 'desk', { ...position, x: NaN }, null)).toThrow('tracked surface');
    expect(() => placeSceneObject(scene, 'desk', position, { x: 0, y: Infinity, z: 0 })).toThrow('tracked surface');
  });
});
