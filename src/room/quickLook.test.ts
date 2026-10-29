import { afterEach, describe, expect, it, vi } from 'vitest';
import { FURNITURE_PRESETS, orientedSize } from './layout';
import type { FurnitureItem, FurniturePlacement } from './layout';
import { buildFurnitureUSDZ, buildPreviewArrangement, supportsQuickLook } from './quickLook';

const at = (item: FurnitureItem, rotation: 0 | 90 = 0): FurniturePlacement => ({ itemId: item.id, x: 0, z: 0, rotation });
const decode = new TextDecoder();
async function unpack(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  const nameLength = view.getUint16(26, true), extraLength = view.getUint16(28, true);
  const offset = 30 + nameLength + extraLength, size = view.getUint32(18, true);
  return { bytes, view, offset, size, payload: bytes.slice(offset, offset + size), source: decode.decode(bytes.slice(offset, offset + size)) };
}
function crc32(bytes: Uint8Array): number {
  // Independent bitwise reference, intentionally not the exporter's lookup-table path.
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let i = 0; i < 8; i++) result = result & 1 ? (result >>> 1) ^ 0xedb88320 : result >>> 1;
  }
  return (result ^ 0xffffffff) >>> 0;
}
const tuples = (text: string): number[][] => [...text.matchAll(/\(([^()]*)\)/g)].map(match => match[1].split(',').map(Number));
function geometry(source: string) {
  return [...source.matchAll(/point3f\[\] points = \[([^\]]+)\][\s\S]*?int\[\] faceVertexCounts = \[([^\]]+)\][\s\S]*?int\[\] faceVertexIndices = \[([^\]]+)\][\s\S]*?normal3f\[\] normals = \[([^\]]+)\]/g)].map(match => ({
    points: tuples(match[1]), counts: match[2].split(',').map(Number), indices: match[3].split(',').map(Number), normals: tuples(match[4]),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('AR Quick Look USDZ export', () => {
  it('writes a stored ZIP with a 64-byte-aligned USDA root, valid CRC, directory and end record', async () => {
    const blob = buildFurnitureUSDZ([FURNITURE_PRESETS[0]], [at(FURNITURE_PRESETS[0])]);
    expect(blob.type).toBe('model/vnd.usdz+zip');
    const { bytes, view, offset, size, payload, source } = await unpack(blob);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0); // No encryption or deferred descriptor.
    expect(view.getUint16(8, true)).toBe(0); // No compression.
    expect(decode.decode(bytes.slice(30, 30 + view.getUint16(26, true)))).toBe('scene.usda');
    expect(offset % 64).toBe(0);
    expect(view.getUint32(22, true)).toBe(size);
    expect(view.getUint32(14, true)).toBe(crc32(payload));
    expect(source.startsWith('#usda 1.0\n')).toBe(true);
    const directory = offset + size, end = bytes.length - 22;
    expect(view.getUint32(directory, true)).toBe(0x02014b50);
    expect(view.getUint16(directory + 10, true)).toBe(0);
    expect(view.getUint32(directory + 16, true)).toBe(crc32(payload));
    expect(view.getUint32(directory + 20, true)).toBe(size);
    expect(view.getUint32(directory + 24, true)).toBe(size);
    expect(view.getUint32(directory + 42, true)).toBe(0);
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 8, true)).toBe(1);
    expect(view.getUint16(end + 10, true)).toBe(1);
    expect(view.getUint32(end + 16, true)).toBe(directory);
    expect(view.getUint32(end + 12, true) + directory).toBe(end);
  });

  it('exports every item as one floor-anchored scene, with metres, centered bounds and bound Preview Surface materials', async () => {
    const items = FURNITURE_PRESETS, { placements, room } = buildPreviewArrangement(items);
    const { source } = await unpack(buildFurnitureUSDZ(items, placements));
    expect(source).toContain('defaultPrim = "Furniture"');
    expect(source).toContain('metersPerUnit = 1');
    expect(source).toContain('upAxis = "Y"');
    expect(source.match(/def Xform "Item_\d+"/g)).toHaveLength(items.length);
    expect(source).not.toMatch(/def (?:Plane|Cube)|"(?:Floor|Wall|Room)"/);
    const meshes = geometry(source), allPoints = meshes.flatMap(mesh => mesh.points);
    expect(Math.min(...allPoints.map(p => p[0]))).toBeCloseTo(-room.width / 2, 8);
    expect(Math.max(...allPoints.map(p => p[0]))).toBeCloseTo(room.width / 2, 8);
    expect(Math.min(...allPoints.map(p => p[1]))).toBe(0);
    expect(Math.max(...allPoints.map(p => p[1]))).toBeCloseTo(2.1, 8);
    expect(Math.min(...allPoints.map(p => p[2]))).toBeCloseTo(-room.depth / 2, 8);
    expect(Math.max(...allPoints.map(p => p[2]))).toBeCloseTo(room.depth / 2, 8);
    expect(source.match(/prepend apiSchemas = \["MaterialBindingAPI"\]/g)).toHaveLength(meshes.length);
    expect(source.match(/subdivisionScheme = "none"/g)).toHaveLength(meshes.length);
    expect(source.match(/doubleSided = true/g)).toHaveLength(meshes.length);
    const materials = new Set([...source.matchAll(/def Material "(Material_\d+)"/g)].map(match => match[1]));
    for (const match of source.matchAll(/rel material:binding = <\/Furniture\/Materials\/(Material_\d+)>/g)) expect(materials.has(match[1])).toBe(true);
    expect(source.match(/info:id = "UsdPreviewSurface"/g)).toHaveLength(materials.size);
    for (const match of source.matchAll(/inputs:diffuseColor = \(([^)]+)\)/g)) {
      for (const color of match[1].split(',').map(Number)) expect(color).toBeGreaterThanOrEqual(0), expect(color).toBeLessThanOrEqual(1);
    }
  });

  it.each([0, 90] as const)('preserves dimensions at rotation %i and uses unit normals consistent with triangle winding', async rotation => {
    const item = FURNITURE_PRESETS[0], size = orientedSize(item, rotation);
    const { source } = await unpack(buildFurnitureUSDZ([item], [{ ...at(item, rotation), x: 17.3, z: -4.8 }]));
    const meshes = geometry(source), points = meshes.flatMap(mesh => mesh.points);
    expect(Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0]))).toBeCloseTo(size.width, 8);
    expect(Math.max(...points.map(p => p[2])) - Math.min(...points.map(p => p[2]))).toBeCloseTo(size.depth, 8);
    for (const mesh of meshes) {
      expect(mesh.counts.every(count => count === 3)).toBe(true);
      expect(mesh.indices).toHaveLength(mesh.counts.length * 3);
      expect(mesh.normals).toHaveLength(mesh.counts.length);
      mesh.normals.forEach((normal, face) => {
        expect(Math.hypot(...normal)).toBeCloseTo(1, 7);
        const [a, b, c] = mesh.indices.slice(face * 3, face * 3 + 3).map(index => mesh.points[index]);
        const u = b.map((v, axis) => v - a[axis]), v = c.map((v, axis) => v - a[axis]);
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        expect(cross.reduce((sum, value, axis) => sum + value * normal[axis], 0)).toBeGreaterThan(0);
        if ([a, b, c].every(p => p[1] === item.height)) expect(normal[1]).toBeCloseTo(1);
        if ([a, b, c].every(p => p[1] === 0)) expect(normal[1]).toBeCloseTo(-1);
      });
    }
  });

  it('keeps the rotated headboard at the correct side and ignores user text in USD identifiers', async () => {
    const item = { ...FURNITURE_PRESETS[0], id: '">\n def Xform "Injected', label: '"Bad"\nLabel' };
    const { source } = await unpack(buildFurnitureUSDZ([item], [at(item, 90)]));
    const highPoints = geometry(source).flatMap(mesh => mesh.points).filter(p => p[1] > item.height * .8);
    expect(Math.min(...highPoints.map(p => p[0]))).toBeCloseTo(item.depth * .955 - item.depth / 2, 8);
    expect(Math.max(...highPoints.map(p => p[0]))).toBeCloseTo(item.depth / 2, 8);
    expect(source).not.toContain('Injected');
    expect(source).not.toContain('Bad');
  });

  it('rejects invalid values, incomplete arrangements, duplicate and unknown placements', () => {
    const item = FURNITURE_PRESETS[0];
    for (const dimension of [0, -.1, .001, NaN, Infinity, 30.1]) {
      for (const axis of ['width', 'depth', 'height']) expect(() => buildFurnitureUSDZ([{ ...item, [axis]: dimension }], [at(item)])).toThrow(/dimensions/);
    }
    expect(() => buildFurnitureUSDZ([{ ...item, color: 'red' }], [at(item)])).toThrow(/colors/);
    expect(() => buildFurnitureUSDZ([], [])).toThrow(/Choose furniture/);
    expect(() => buildFurnitureUSDZ([item], [])).toThrow(/every item/);
    expect(() => buildFurnitureUSDZ([item, item], [at(item), at(item)])).toThrow(/unique/);
    expect(() => buildFurnitureUSDZ([item], [{ ...at(item), itemId: 'missing' }])).toThrow(/placements/);
    expect(() => buildFurnitureUSDZ(FURNITURE_PRESETS.slice(0, 2), [at(item), at(item)])).toThrow(/placements/);
    for (const invalid of [NaN, Infinity, 1e10]) expect(() => buildFurnitureUSDZ([item], [{ ...at(item), x: invalid }])).toThrow(/placements/);
    expect(() => buildFurnitureUSDZ([item], [{ ...at(item), rotation: 45 as 0 }])).toThrow(/rotations/);
  });

  it('detects the AR link capability and safely handles unsupported or server environments', () => {
    expect(supportsQuickLook()).toBe(false);
    const supports = vi.fn((value: string) => value === 'ar');
    vi.stubGlobal('document', { createElement: () => ({ relList: { supports } }) });
    expect(supportsQuickLook()).toBe(true);
    expect(supports).toHaveBeenCalledWith('ar');
    vi.stubGlobal('document', { createElement: () => ({ relList: { supports: () => false } }) });
    expect(supportsQuickLook()).toBe(false);
    vi.stubGlobal('document', { createElement: () => ({ relList: {} }) });
    expect(supportsQuickLook()).toBe(false);
  });
});

describe('automatic preview arrangement', () => {
  function verify(items: FurnitureItem[], gap: number) {
    const original = structuredClone(items), result = buildPreviewArrangement(items, gap);
    expect(items).toEqual(original);
    expect(buildPreviewArrangement(items, gap)).toEqual(result);
    expect(new Set(result.placements.map(value => value.itemId))).toEqual(new Set(items.map(item => item.id)));
    const rectangles = result.placements.map(placement => ({ ...placement, ...orientedSize(items.find(item => item.id === placement.itemId)!, placement.rotation) }));
    for (const rect of rectangles) {
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.z).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(result.room.width + 1e-9);
      expect(rect.z + rect.depth).toBeLessThanOrEqual(result.room.depth + 1e-9);
    }
    for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j];
      const dx = Math.max(a.x - b.x - b.width, b.x - a.x - a.width), dz = Math.max(a.z - b.z - b.depth, b.z - a.z - a.depth);
      expect(dx >= -1e-9 || dz >= -1e-9).toBe(true);
      expect(Math.hypot(Math.max(0, dx), Math.max(0, dz)) + 1e-9).toBeGreaterThanOrEqual(gap);
    }
    return result;
  }

  it('includes all 12 mixed items with gaps, deterministically, without mutating inputs', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ ...FURNITURE_PRESETS[index % 5], id: `item-${index}` }));
    const result = verify(items, .3), blob = buildFurnitureUSDZ(items, result.placements), { source } = await unpack(blob);
    expect(source.match(/def Xform "Item_\d+"/g)).toHaveLength(12);
    expect(blob.size).toBeLessThan(4_000_000);
  });

  it.each([0, .3, 30])('packs extreme aspect ratios and maximum-sized items with gap %s', gap => {
    const items = Array.from({ length: 12 }, (_, index) => ({ ...FURNITURE_PRESETS[index % 5], id: `item-${index}`, width: index % 2 ? .01 : 30, depth: index % 2 ? 30 : .01 }));
    verify(items, gap);
    const square = verify(items.map(item => ({ ...item, width: 30, depth: 30 })), gap);
    expect(Math.max(square.room.width, square.room.depth) / Math.min(square.room.width, square.room.depth)).toBeLessThan(2);
  });

  it('handles an empty selection and rejects invalid gap or excessive selections', () => {
    expect(buildPreviewArrangement([])).toEqual({ room: { width: 0, depth: 0 }, placements: [] });
    for (const gap of [-1, NaN, Infinity, 31]) expect(() => buildPreviewArrangement(FURNITURE_PRESETS, gap)).toThrow(/gap/);
    const many = Array.from({ length: 13 }, (_, index) => ({ ...FURNITURE_PRESETS[0], id: String(index) }));
    expect(() => buildPreviewArrangement(many)).toThrow(/12/);
    expect(() => buildFurnitureUSDZ(many, many.map(item => at(item)))).toThrow(/12/);
  });
});
