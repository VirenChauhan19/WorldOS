import { describe, expect, it } from 'vitest';
import { AR_CATALOG, AR_CATEGORIES, createCatalogItem } from './catalog';
import { furnitureMeshes } from '../room/furnitureGeometry';
import { FURNITURE_KINDS, orientedSize } from '../room/layout';

describe('placeable object collection', () => {
  it('offers independent instances so adding two of the same object never edits both', () => {
    const first = createCatalogItem('sofa', 'sofa-one');
    const second = createCatalogItem('sofa', 'sofa-two');
    const original = { ...AR_CATALOG.find(entry => entry.id === 'sofa')!.item };
    first.width = 3;
    first.color = '#123456';
    expect(second).toEqual({ ...original, id: 'sofa-two' });
    expect(AR_CATALOG.find(entry => entry.id === 'sofa')!.item).toEqual(original);
    expect(() => createCatalogItem('missing', 'id')).toThrow('Choose an object');
    expect(() => createCatalogItem('sofa', '')).toThrow('Object ID');
  });

  it('keeps every concept inside its editable outer dimensions through four rotations', () => {
    expect(new Set(AR_CATALOG.map(entry => entry.id)).size).toBe(AR_CATALOG.length);
    for (const entry of AR_CATALOG) {
      expect(AR_CATEGORIES.some(category => category.id === entry.category)).toBe(true);
      expect(FURNITURE_KINDS).toContain(entry.item.kind);
      for (const rotation of [0, 90, 180, 270] as const) {
        const item = createCatalogItem(entry.id, 'placed');
        const placement = { itemId: item.id, x: -.7, z: 2.1, rotation };
        const bounds = orientedSize(item, rotation);
        const meshes = furnitureMeshes(item, placement);
        expect(meshes.length).toBeGreaterThan(0);
        for (const mesh of meshes) {
          expect(mesh.vertices.length % 9).toBe(0);
          expect(mesh.color.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
          const limits = [[placement.x, placement.x + bounds.width], [0, item.height], [placement.z, placement.z + bounds.depth]];
          expect(mesh.vertices.every((value, index) => Number.isFinite(value) && value >= limits[index % 3][0] - 1e-9 && value <= limits[index % 3][1] + 1e-9), `${entry.id} at ${rotation} degrees`).toBe(true);
        }
      }
    }
  });
});
