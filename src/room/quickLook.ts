import { furnitureMeshes } from './furnitureGeometry';
import { orientedSize } from './layout';
import type { FurnitureItem, FurniturePlacement, RoomSize } from './layout';

const MAX_ITEMS = 12;
const MAX_DIMENSION = 30;
const MAX_POSITION = MAX_ITEMS * MAX_DIMENSION * 2;
const KINDS = new Set(['bed', 'desk', 'table', 'wardrobe', 'chair']);
const EPS = 1e-9;
const encoder = new TextEncoder();

function validateItems(items: readonly FurnitureItem[]): void {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new Error('Choose at most 12 furniture items.');
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) throw new Error('Furniture items must have unique, non-empty IDs.');
    ids.add(item.id);
    if (!KINDS.has(item.kind) || ![item.width, item.depth, item.height].every(value => Number.isFinite(value) && value >= .01 && value <= MAX_DIMENSION)) {
      throw new Error('Furniture dimensions must be between 0.01 and 30 metres, with a supported furniture kind.');
    }
    if (typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error('Furniture colors must use six-digit hex values.');
  }
}

/** Detect Safari's AR link capability, including iPad, without relying on user-agent strings. */
export function supportsQuickLook(): boolean {
  if (typeof document === 'undefined') return false;
  try { return document.createElement('a').relList.supports('ar'); } catch { return false; }
}

export interface PreviewArrangement {
  /** Suggested furniture footprint, never a measurement or a room-fit assessment. */
  room: RoomSize;
  placements: FurniturePlacement[];
}
interface Rect { x: number; z: number; width: number; depth: number }
function separated(a: Rect, b: Rect, gap: number): boolean {
  const dx = Math.max(a.x - b.x - b.width, b.x - a.x - a.width);
  const dz = Math.max(a.z - b.z - b.depth, b.z - a.z - a.depth);
  return (dx >= -EPS || dz >= -EPS) && Math.hypot(Math.max(0, dx), Math.max(0, dz)) + EPS >= gap;
}
const compactness = (width: number, depth: number) => width * depth + .2 * (width - depth) ** 2;

/**
 * A bounded, deterministic starting arrangement for AR when no room is measured.
 * Three greedy orders try five width limits, examining only rectangle edges.
 * Depth grows as needed, so every item is included without backtracking.
 * No claim about walls, doorways, circulation, or fit in the real room is made.
 */
export function buildPreviewArrangement(items: readonly FurnitureItem[], gap = .3): PreviewArrangement {
  validateItems(items);
  if (!Number.isFinite(gap) || gap < 0 || gap > MAX_DIMENSION) throw new Error('Furniture gap must be between 0 and 30 metres.');
  if (!items.length) return { room: { width: 0, depth: 0 }, placements: [] };
  const orders = [
    [...items].sort((a, b) => b.width * b.depth - a.width * a.depth),
    [...items].sort((a, b) => Math.max(b.width, b.depth) - Math.max(a.width, a.depth)),
    [...items],
  ];
  const minimumWidth = Math.max(...items.map(item => Math.min(item.width, item.depth)));
  const squareWidth = Math.sqrt(items.reduce((area, item) => area + (item.width + gap) * (item.depth + gap), 0));
  const widthLimits = [...new Set([minimumWidth, Math.max(...items.map(item => Math.max(item.width, item.depth))), ...[.75, 1, 1.25].map(factor => Math.max(minimumWidth, squareWidth * factor))])];
  let best: PreviewArrangement | undefined;
  for (const order of orders) for (const limit of widthLimits) {
    const rectangles: Rect[] = [], placements: FurniturePlacement[] = [];
    let width = 0, depth = 0;
    for (const item of order) {
      let choice: { rect: Rect; placement: FurniturePlacement; width: number; depth: number; score: number } | undefined;
      const xs = [...new Set([0, ...rectangles.map(rect => rect.x + rect.width + gap)])];
      const zs = [...new Set([0, ...rectangles.map(rect => rect.z + rect.depth + gap)])];
      for (const rotation of [0, 90] as const) {
        const size = orientedSize(item, rotation);
        for (const z of zs) for (const x of xs) {
          if (x + size.width > limit + EPS) continue;
          const rect = { x, z, ...size };
          if (!rectangles.every(other => separated(rect, other, gap))) continue;
          const nextWidth = Math.max(width, x + size.width), nextDepth = Math.max(depth, z + size.depth);
          const score = compactness(nextWidth, nextDepth);
          if (!choice || score < choice.score - EPS) choice = { rect, placement: { itemId: item.id, x, z, rotation }, width: nextWidth, depth: nextDepth, score };
        }
      }
      // An edge beyond all prior rectangles is always available in this unbounded footprint.
      if (!choice) throw new Error('Could not generate the furniture preview.');
      rectangles.push(choice.rect); placements.push(choice.placement);
      width = choice.width; depth = choice.depth;
    }
    if (!best || compactness(width, depth) < compactness(best.room.width, best.room.depth) - EPS) best = { room: { width, depth }, placements };
  }
  return best!;
}

type Point = [number, number, number];
interface Triangle { points: [Point, Point, Point]; color: string; normal?: Point }
interface Mesh { points: Point[]; indices: number[]; normals: Point[]; material: string }
const number = (value: number) => String(Number(value.toFixed(9)));
const point = (value: Point) => `(${value.map(number).join(', ')})`;
const pointKey = (value: Point) => value.map(number).join(',');
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;

/**
 * The shared renderer colors both sides and does not require winding consistency.
 * Orient connected closed surfaces before writing USD, then use geometric normals.
 * Edge identities tolerate insignificant round-off at cylinder seam vertices.
 */
function orientTriangles(triangles: Triangle[]): void {
  const edges = new Map<string, { triangle: number; forward: boolean }[]>();
  const neighbors: { triangle: number; invert: boolean }[][] = triangles.map(() => []);
  triangles.forEach((triangle, index) => {
    const keys = triangle.points.map(pointKey);
    for (let i = 0; i < 3; i++) {
      const a = keys[i], b = keys[(i + 1) % 3], key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const edge = edges.get(key) ?? [];
      edge.push({ triangle: index, forward: a < b }); edges.set(key, edge);
    }
  });
  for (const edge of edges.values()) {
    if (edge.length !== 2) continue;
    const [a, b] = edge, invert = a.forward === b.forward;
    neighbors[a.triangle].push({ triangle: b.triangle, invert });
    neighbors[b.triangle].push({ triangle: a.triangle, invert });
  }
  const flipped = new Map<number, boolean>();
  for (let start = 0; start < triangles.length; start++) {
    if (flipped.has(start)) continue;
    const component = [start]; flipped.set(start, false);
    for (let next = 0; next < component.length; next++) {
      const index = component[next];
      for (const edge of neighbors[index]) if (!flipped.has(edge.triangle)) {
        flipped.set(edge.triangle, flipped.get(index)! !== edge.invert); component.push(edge.triangle);
      }
    }
    const origin = triangles[start].points[0];
    let volume = 0;
    for (const index of component) {
      const [a, b, c] = triangles[index].points.map(value => subtract(value, origin));
      volume += dot(a, cross(b, c)) * (flipped.get(index) ? -1 : 1);
    }
    for (const index of component) {
      const triangle = triangles[index];
      if (flipped.get(index)! !== (volume < 0)) [triangle.points[1], triangle.points[2]] = [triangle.points[2], triangle.points[1]];
      const [a, b, c] = triangle.points, normal = cross(subtract(b, a), subtract(c, a)), length = Math.hypot(...normal);
      if (!Number.isFinite(length) || length === 0) throw new Error('Furniture contains a degenerate triangle.');
      triangle.normal = normal.map(value => value / length) as Point;
    }
  }
}

function bounds(points: readonly Point[]): [Point, Point] {
  const min: Point = [Infinity, Infinity, Infinity], max: Point = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis]); }
  return [min, max];
}

function scene(items: readonly FurnitureItem[], placements: readonly FurniturePlacement[]): string {
  validateItems(items);
  if (!items.length) throw new Error('Choose furniture before opening the AR preview.');
  if (!Array.isArray(placements) || placements.length !== items.length) throw new Error('The AR preview needs one placement for every item.');
  const byId = new Map(items.map(item => [item.id, item])), placed = new Map<string, FurniturePlacement>();
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const placement of placements) {
    const item = placement && byId.get(placement.itemId);
    if (!item || placed.has(item.id) || ![placement.x, placement.z].every(value => Number.isFinite(value) && Math.abs(value) <= MAX_POSITION) || ![0, 90].includes(placement.rotation)) {
      throw new Error('AR placements need unique item IDs, bounded finite coordinates, and 0 or 90 degree rotations.');
    }
    placed.set(item.id, placement);
    const size = orientedSize(item, placement.rotation);
    minX = Math.min(minX, placement.x); minZ = Math.min(minZ, placement.z);
    maxX = Math.max(maxX, placement.x + size.width); maxZ = Math.max(maxZ, placement.z + size.depth);
  }
  const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
  const materials = new Map<string, string>();
  const furniture = items.map((item, index) => {
    const placement = placed.get(item.id)!, triangles: Triangle[] = [];
    for (const mesh of furnitureMeshes(item, { ...placement, x: 0, z: 0 })) {
      const color = mesh.color.slice(0, 3).map(linear).map(number).join(', ');
      for (let offset = 0; offset < mesh.vertices.length; offset += 9) {
        const points = [0, 3, 6].map(start => mesh.vertices.slice(offset + start, offset + start + 3) as Point) as Triangle['points'];
        triangles.push({ points, color });
      }
    }
    orientTriangles(triangles);
    const groups = new Map<string, { mesh: Mesh; vertices: Map<string, number> }>();
    for (const triangle of triangles) {
      if (!materials.has(triangle.color)) materials.set(triangle.color, `Material_${materials.size}`);
      let group = groups.get(triangle.color);
      if (!group) {
        group = { mesh: { points: [], indices: [], normals: [], material: materials.get(triangle.color)! }, vertices: new Map() };
        groups.set(triangle.color, group);
      }
      for (const p of triangle.points) {
        const translated: Point = [p[0] + placement.x - centerX, p[1], p[2] + placement.z - centerZ];
        const key = pointKey(translated);
        if (!group.vertices.has(key)) { group.vertices.set(key, group.mesh.points.length); group.mesh.points.push(translated); }
        group.mesh.indices.push(group.vertices.get(key)!);
      }
      group.mesh.normals.push(triangle.normal!);
    }
    return `    def Xform "Item_${index}"\n    {\n${[...groups.values()].map(({ mesh }, meshIndex) => `        def Mesh "Mesh_${meshIndex}" (\n            prepend apiSchemas = ["MaterialBindingAPI"]\n        )\n        {\n            uniform token subdivisionScheme = "none"\n            uniform token orientation = "rightHanded"\n            uniform bool doubleSided = true\n            point3f[] points = [${mesh.points.map(point).join(', ')}]\n            int[] faceVertexCounts = [${mesh.normals.map(() => 3).join(', ')}]\n            int[] faceVertexIndices = [${mesh.indices.join(', ')}]\n            normal3f[] normals = [${mesh.normals.map(point).join(', ')}] (\n                interpolation = "uniform"\n            )\n            float3[] extent = [${bounds(mesh.points).map(point).join(', ')}]\n            rel material:binding = </Furniture/Materials/${mesh.material}>\n        }`).join('\n')}\n    }`;
  });
  return `#usda 1.0\n(\n    defaultPrim = "Furniture"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n\ndef Xform "Furniture" (\n    kind = "component"\n)\n{\n    def Scope "Materials"\n    {\n${[...materials].map(([color, name]) => `        def Material "${name}"\n        {\n            token outputs:surface.connect = </Furniture/Materials/${name}/Surface.outputs:surface>\n            def Shader "Surface"\n            {\n                uniform token info:id = "UsdPreviewSurface"\n                color3f inputs:diffuseColor = (${color})\n                float inputs:metallic = 0\n                float inputs:roughness = 0.78\n                token outputs:surface\n            }\n        }`).join('\n')}\n    }\n${furniture.join('\n')}\n}\n`;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * One stored, unencrypted ZIP entry. USDZ requires payloads aligned to 64 bytes.
 * The extra field is a valid ZIP TLV, including its header in the alignment.
 * https://openusd.org/release/spec_usdz.html
 */
function packageUSDZ(source: string): Uint8Array<ArrayBuffer> {
  const name = encoder.encode('scene.usda'), data = encoder.encode(source), crc = crc32(data);
  const extraLength = (64 - (30 + name.length + 4) % 64) % 64 + 4;
  const dataOffset = 30 + name.length + extraLength, directoryOffset = dataOffset + data.length;
  const directoryLength = 46 + name.length, result = new Uint8Array(directoryOffset + directoryLength + 22), view = new DataView(result.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  u32(0, 0x04034b50); u16(4, 20); u16(12, 33); // Stored, DOS epoch 1980-01-01.
  u32(14, crc); u32(18, data.length); u32(22, data.length); u16(26, name.length); u16(28, extraLength);
  result.set(name, 30); u16(30 + name.length, 0x1986); u16(32 + name.length, extraLength - 4); result.set(data, dataOffset);
  const central = directoryOffset;
  u32(central, 0x02014b50); u16(central + 4, 20); u16(central + 6, 20); u16(central + 14, 33);
  u32(central + 16, crc); u32(central + 20, data.length); u32(central + 24, data.length); u16(central + 28, name.length);
  result.set(name, central + 46);
  const end = central + directoryLength;
  u32(end, 0x06054b50); u16(end + 8, 1); u16(end + 10, 1); u32(end + 12, directoryLength); u32(end + 16, directoryOffset);
  return result;
}

/**
 * Export the whole arrangement as one floor-anchored, metre-scale AR object.
 * Only furniture is included: the physical floor and walls remain visible.
 * Use a URL ending in #allowsContentScaling=0 in an <a rel="ar"><img ... /></a>.
 */
export function buildFurnitureUSDZ(items: readonly FurnitureItem[], placements: readonly FurniturePlacement[]): Blob {
  return new Blob([packageUSDZ(scene(items, placements))], { type: 'model/vnd.usdz+zip' });
}
