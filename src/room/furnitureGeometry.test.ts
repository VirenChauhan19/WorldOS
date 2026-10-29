import { describe, expect, it } from 'vitest';
import { furnitureMeshes, material } from './furnitureGeometry';
import type { SceneMesh } from './furnitureGeometry';
import { FURNITURE_PRESETS, orientedSize } from './layout';
import type { FurnitureItem, FurniturePlacement } from './layout';

const placement = (item: FurnitureItem, rotation: 0 | 90 = 0): FurniturePlacement => ({ itemId: item.id, x: 3.2, z: -1.7, rotation });
const points = (meshes: SceneMesh[]) => meshes.flatMap(mesh => {
  const result: number[][] = [];
  for (let i = 0; i < mesh.vertices.length; i += 3) result.push(mesh.vertices.slice(i, i + 3));
  return result;
});

describe('shared furniture geometry', () => {
  it.each(FURNITURE_PRESETS.map(item => [item.kind, item] as const))('keeps %s at the exact measured bounds in both orientations', (_, preset) => {
    // Include extreme aspect ratios so leg thickness cannot escape a shallow footprint.
    for (const [width, depth, height] of [[preset.width, preset.depth, preset.height], [3, .05, .4], [.05, 3, 2.5]]) {
      const item = { ...preset, width, depth, height };
      for (const rotation of [0, 90] as const) {
        const at = placement(item, rotation), size = orientedSize(item, rotation);
        const vertices = points(furnitureMeshes(item, at));
        expect(vertices.length).toBeGreaterThan(0);
        for (const [axis, min, max] of [[0, at.x, at.x + size.width], [1, 0, height], [2, at.z, at.z + size.depth]]) {
          const values = vertices.map(point => point[axis]);
          expect(Math.min(...values)).toBeCloseTo(min, 9);
          expect(Math.max(...values)).toBeCloseTo(max, 9);
        }
      }
    }
  });

  it('emits finite, nondegenerate triangles and normalized colors suitable for WebGL and WebXR', () => {
    for (const item of FURNITURE_PRESETS) {
      for (const mesh of furnitureMeshes(item, placement(item, 90))) {
        expect(mesh.vertices.length % 9).toBe(0);
        expect(mesh.vertices.every(Number.isFinite)).toBe(true);
        expect(mesh.color).toHaveLength(4);
        expect(mesh.color.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
        for (let i = 0; i < mesh.vertices.length; i += 9) {
          const [a, b, c] = [0, 3, 6].map(offset => mesh.vertices.slice(i + offset, i + offset + 3));
          const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
          const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
          expect(area).toBeGreaterThan(1e-12);
        }
      }
    }
  });

  it('rotates an asymmetric bed around its new minimum footprint corner without changing its dimensions', () => {
    const bed = FURNITURE_PRESETS.find(item => item.kind === 'bed')!;
    const at = placement(bed, 90);
    const headboard = points(furnitureMeshes(bed, at)).filter(point => point[1] > bed.height * .8);
    expect(headboard.length).toBeGreaterThan(0);
    expect(Math.min(...headboard.map(point => point[0]))).toBeCloseTo(at.x + bed.depth * .955);
    expect(Math.max(...headboard.map(point => point[0]))).toBeCloseTo(at.x + bed.depth);
    expect(Math.min(...headboard.map(point => point[2]))).toBeCloseTo(at.z);
    expect(Math.max(...headboard.map(point => point[2]))).toBeCloseTo(at.z + bed.width);
  });

  it.each(['desk', 'table'] as const)('applies the selected %s finish to its visible top', kind => {
    const item = { ...FURNITURE_PRESETS.find(value => value.kind === kind)!, color: '#234567' };
    const meshes = furnitureMeshes(item, placement(item));
    const tops = meshes.filter(mesh => mesh.vertices.every((value, index) => index % 3 !== 1 || Math.abs(value - item.height) < 1e-9));
    expect(tops.some(mesh => mesh.color.every((value, index) => value === material(item.color)[index]))).toBe(true);
  });

  it('places wardrobe doors in front of the carcass and handles in front of the doors', () => {
    const item = FURNITURE_PRESETS.find(value => value.kind === 'wardrobe')!;
    const meshes = furnitureMeshes(item, { ...placement(item), x: 0, z: 0 });
    const front = (color: SceneMesh['color']) => Math.max(...points(meshes.filter(mesh => mesh.color.every((value, index) => Math.abs(value - color[index]) < 1e-9))).map(point => point[2]));
    // Every box uses the same directional shading on its forward face.
    const body = front(material('#b69a77', .83));
    const door = front(material(item.color, .83));
    const handle = front(material('#505343', .83));
    expect(door).toBeGreaterThan(body);
    expect(handle).toBeGreaterThan(door);
    expect(handle).toBeCloseTo(item.depth);
  });

  it('rejects invalid dimensions and placements instead of uploading corrupt geometry', () => {
    const item = FURNITURE_PRESETS[0], at = placement(item);
    for (const invalid of [NaN, Infinity, -1, 0]) {
      expect(furnitureMeshes({ ...item, width: invalid }, at)).toEqual([]);
      expect(furnitureMeshes({ ...item, depth: invalid }, at)).toEqual([]);
      expect(furnitureMeshes({ ...item, height: invalid }, at)).toEqual([]);
    }
    expect(furnitureMeshes(item, { ...at, x: NaN })).toEqual([]);
    expect(furnitureMeshes(item, { ...at, z: Infinity })).toEqual([]);
    expect(furnitureMeshes(item, { ...at, rotation: 45 as 0 })).toEqual([]);
  });

  it('preserves caller data and returns independent mesh arrays', () => {
    const item = { ...FURNITURE_PRESETS[0] }, at = placement(item), before = structuredClone({ item, at });
    const first = furnitureMeshes(item, at), second = furnitureMeshes(item, at);
    first[0].vertices[0] = 999;
    expect(second[0].vertices[0]).not.toBe(999);
    expect({ item, at }).toEqual(before);
  });

  it('keeps highlighted white upholstery within the color range accepted by WebXR', () => {
    const bed = { ...FURNITURE_PRESETS[0], color: '#ffffff' };
    const meshes = furnitureMeshes(bed, placement(bed));
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every(mesh => mesh.color.every(value => value >= 0 && value <= 1))).toBe(true);
  });
});
