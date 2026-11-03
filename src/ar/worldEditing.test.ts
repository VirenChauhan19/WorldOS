import { describe, expect, it } from 'vitest';
import type { XRPoint } from '../live/xr-types';
import type { DesignObject } from './scene';
import { resizeMountedWorldPosition } from './worldEditing';

const original: DesignObject = {
  item: { id: 'art', kind: 'custom', model: 'wall-art', label: 'Artwork', width: .65, depth: .045, height: .85, color: '#aabbcc' },
  placement: { itemId: 'art', x: 1, z: 0, rotation: 0, elevation: 1.2, mount: 'free' },
};
const position = { x: 4, y: 1.3, z: -2.5 };
const resized = (patch: Partial<DesignObject['item']>): DesignObject => ({ ...original, item: { ...original.item, ...patch } });
const backContact = (point: XRPoint, depth: number, rotation: number) => {
  const angle = rotation * Math.PI / 180;
  return { x: point.x + Math.sin(angle) * depth / 2, y: point.y, z: point.z - Math.cos(angle) * depth / 2 };
};

describe('resizing a fixture on an observed surface', () => {
  it.each([37, 180])('keeps wall contact fixed when depth changes at %s degrees', rotation => {
    const after = resized({ depth: .22 }), snapshot = structuredClone({ original, after, position });
    const result = resizeMountedWorldPosition(original, after, position, rotation, 'vertical');
    const oldBack = backContact(position, original.item.depth, rotation), newBack = backContact(result, after.item.depth, rotation);
    expect(newBack.x).toBeCloseTo(oldBack.x, 12);
    expect(newBack.z).toBeCloseTo(oldBack.z, 12);
    expect(result.y).toBe(position.y);
    expect({ original, after, position }).toEqual(snapshot);
    expect(result).not.toBe(position);
  });

  it.each([37, 180])('does not drift along a wall when width or height changes at %s degrees', rotation => {
    const after = resized({ width: 1.2, height: 1.4 });
    expect(resizeMountedWorldPosition(original, after, position, rotation, 'vertical')).toEqual(position);
  });

  it('preserves ceiling top contact and base-center x/z as the fixture changes size', () => {
    const before = resized({ model: 'pendant-light', kind: 'lamp', height: .65, width: .46, depth: .46 });
    const after = { ...before, item: { ...before.item, height: .9, width: .7, depth: .55 } };
    const placed = { x: 1.5, y: 2.05, z: -1 };
    const result = resizeMountedWorldPosition(before, after, placed, 37, 'ceiling');
    expect(result.x).toBe(placed.x);expect(result.z).toBe(placed.z);
    expect(result.y).toBeCloseTo(1.8);
    expect(result.y + after.item.height).toBeCloseTo(placed.y + before.item.height, 12);
    expect(placed).toEqual({ x: 1.5, y: 2.05, z: -1 });
  });

  it('rejects nonfinite positions, rotations, and dimensions instead of producing corrupt poses', () => {
    expect(() => resizeMountedWorldPosition(original, original, { ...position, x: NaN }, 37, 'vertical')).toThrow('invalid position or rotation');
    expect(() => resizeMountedWorldPosition(original, original, position, Infinity, 'ceiling')).toThrow('invalid position or rotation');
    expect(() => resizeMountedWorldPosition(original, resized({ depth: Infinity }), position, 37, 'vertical')).toThrow('valid object dimensions');
    expect(() => resizeMountedWorldPosition(original, resized({ height: 0 }), position, 37, 'ceiling')).toThrow('valid object dimensions');
  });
});
