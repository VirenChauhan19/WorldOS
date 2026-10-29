import type { XRPoint, XRTransform } from './xr-types';
import type { WorldARMeasurement, WorldARObject } from './xr';

type Point = { x: number; z: number };
type Rect = { left: number; right: number; top: number; bottom: number };
const EPS = 1e-8;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

function contains(polygon: readonly Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (Math.abs(cross(a, b, point)) < EPS && point.x >= Math.min(a.x, b.x) - EPS && point.x <= Math.max(a.x, b.x) + EPS && point.z >= Math.min(a.z, b.z) - EPS && point.z <= Math.max(a.z, b.z) + EPS) return true;
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Does this edge enter the rectangle interior? Boundary contact is permitted. */
function enters(a: Point, b: Point, rect: Rect): boolean {
  let near = 0, far = 1;
  for (const [origin, delta, low, high] of [[a.x, b.x - a.x, rect.left + EPS, rect.right - EPS], [a.z, b.z - a.z, rect.top + EPS, rect.bottom - EPS]]) {
    if (Math.abs(delta) < EPS) { if (origin < low || origin > high) return false; }
    else {
      const first = (low - origin) / delta, last = (high - origin) / delta;
      near = Math.max(near, Math.min(first, last)); far = Math.min(far, Math.max(first, last));
      if (near > far) return false;
    }
  }
  return near <= far;
}

function insideRectangle(polygon: readonly Point[], rect: Rect): boolean {
  if (![{ x: rect.left, z: rect.top }, { x: rect.right, z: rect.top }, { x: rect.right, z: rect.bottom }, { x: rect.left, z: rect.bottom }].every(point => contains(polygon, point))) return false;
  // Testing corners alone would bridge a notch in an L/U-shaped polygon.
  return !polygon.some((point, index) => enters(point, polygon[(index + 1) % polygon.length], rect));
}

/** A conservative rectangle wholly inside the observed polygon, not its bounds.
 * Grid search may underestimate irregular surfaces. Native polygons contain no
 * holes; furniture/obstacle occupancy is not inferred from a detected plane. */
export function inscribedPlaneRectangle(input: readonly XRPoint[]): [XRPoint, XRPoint, XRPoint, XRPoint] | null {
  if (input.length < 3 || input.length > 128 || input.some(point => ![point.x, point.y, point.z].every(Number.isFinite) || Math.abs(point.y) > .02)) return null;
  const polygon = input.map(point => ({ x: point.x, z: point.z }));
  if (Math.hypot(polygon[0].x - polygon.at(-1)!.x, polygon[0].z - polygon.at(-1)!.z) < EPS) polygon.pop();
  if (polygon.length < 3) return null;
  let longest = 0, angle = 0, area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    area += a.x * b.z - b.x * a.z;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length > longest + EPS) { longest = length; angle = Math.atan2(b.z - a.z, b.x - a.x); }
    // Reject malformed self-crossing polygons instead of filling across them.
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      const c = polygon[j], d = polygon[(j + 1) % polygon.length];
      if (cross(a, b, c) * cross(a, b, d) < -EPS && cross(c, d, a) * cross(c, d, b) < -EPS) return null;
    }
  }
  if (Math.abs(area) < .005 || longest < .05) return null;
  // Canonicalize quarter turns so the longest edge does not swap dimensions.
  angle = ((angle + Math.PI / 4) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2) - Math.PI / 4;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const projected = polygon.map(point => ({ x: point.x * cos + point.z * sin, z: -point.x * sin + point.z * cos }));
  const bounds = { left: Math.min(...projected.map(p => p.x)), right: Math.max(...projected.map(p => p.x)), top: Math.min(...projected.map(p => p.z)), bottom: Math.max(...projected.map(p => p.z)) };
  const width = bounds.right - bounds.left, length = bounds.bottom - bounds.top;
  if (Math.min(width, length) < .07 || Math.max(width, length) > 50) return null;
  let best: Rect | null = insideRectangle(projected, bounds) ? bounds : null;
  if (!best) {
    const size = 24, dx = width / size, dz = length / size, heights = new Array<number>(size).fill(0);
    let bestArea = 0;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const cell = { left: bounds.left + col * dx, right: bounds.left + (col + 1) * dx, top: bounds.top + row * dz, bottom: bounds.top + (row + 1) * dz };
        heights[col] = insideRectangle(projected, cell) ? heights[col] + 1 : 0;
      }
      for (let left = 0; left < size; left++) {
        let height = heights[left];
        for (let right = left; right < size && height; right++) {
          height = Math.min(height, heights[right]);
          const nextArea = (right - left + 1) * height;
          if (nextArea > bestArea) {
            bestArea = nextArea;
            best = { left: bounds.left + left * dx, right: bounds.left + (right + 1) * dx, top: bounds.top + (row + 1 - height) * dz, bottom: bounds.top + (row + 1) * dz };
          }
        }
      }
    }
  }
  if (!best || best.right - best.left < .07 || best.bottom - best.top < .07) return null;
  // Keep a centimetre inside the reported boundary to avoid numeric edge spill.
  const corners = [[best.left + .01, best.top + .01], [best.right - .01, best.top + .01], [best.right - .01, best.bottom - .01], [best.left + .01, best.bottom - .01]];
  return corners.map(([x, z]) => ({ x: x * cos - z * sin, y: 0, z: x * sin + z * cos })) as [XRPoint, XRPoint, XRPoint, XRPoint];
}

export function planeRectangleToWorld(corners: readonly XRPoint[], transform: XRTransform): WorldARMeasurement | null {
  const m = transform.matrix;
  // Native plane local +Y is its normal. Reject walls and sloping surfaces.
  if (m.length !== 16 || !Array.from(m).every(Number.isFinite) || Math.abs(m[5]) < .995) return null;
  const world = corners.map(p => ({ x: m[0] * p.x + m[8] * p.z + m[12], y: m[1] * p.x + m[9] * p.z + m[13], z: m[2] * p.x + m[10] * p.z + m[14] }));
  if (world.length !== 4 || Math.max(...world.map(p => p.y)) - Math.min(...world.map(p => p.y)) > .06) return null;
  const [a, b, , d] = world;
  const width = Math.hypot(b.x - a.x, b.z - a.z), length = Math.hypot(d.x - a.x, d.z - a.z);
  if (Math.min(width, length) < .05 || Math.max(width, length) > 50) return null;
  return { width, length, corners: world.map(point => ({ ...point, y: a.y })) as WorldARMeasurement['corners'] };
}

const OBJECT_LABELS = new Set(['bed', 'desk', 'table', 'chair', 'couch', 'sofa', 'wardrobe', 'cabinet', 'shelf', 'screen', 'monitor', 'keyboard', 'laptop', 'plant', 'door', 'window', 'storage']);
export function supportedObjectLabel(semanticLabel: string | undefined): string | null {
  const label = semanticLabel?.trim().toLowerCase();
  return label && OBJECT_LABELS.has(label) ? label : null;
}

/** Bounds of an explicitly labelled, bounded native object mesh. These describe
 * observed geometry only; missing/occluded portions cannot be reconstructed. */
export function observedMeshBounds(vertices: Float32Array, semanticLabel: string | undefined, transform: XRTransform): WorldARObject | null {
  const label = supportedObjectLabel(semanticLabel);
  const m = transform.matrix;
  if (!label || vertices.length < 12 || vertices.length % 3 !== 0 || vertices.length > 60000 || m.length !== 16 || !Array.from(m).every(Number.isFinite) || Math.abs(m[5]) < .995) return null;
  const axis = Math.hypot(m[0], m[2]);
  if (axis < .99 || axis > 1.01) return null;
  const ux = m[0] / axis, uz = m[2] / axis;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const a = vertices[i], b = vertices[i + 1], c = vertices[i + 2];
    if (![a, b, c].every(value => Number.isFinite(value) && Math.abs(value) <= 10000)) return null;
    // Translation has no effect on dimensions. Project onto the mesh's upright
    // horizontal axes so a rotated object does not acquire enlarged world bounds.
    const worldX = m[0] * a + m[4] * b + m[8] * c, y = m[1] * a + m[5] * b + m[9] * c, worldZ = m[2] * a + m[6] * b + m[10] * c;
    const x = worldX * ux + worldZ * uz, z = -worldX * uz + worldZ * ux;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const width = maxX - minX, length = maxZ - minZ, height = maxY - minY;
  if (![width, length, height].every(value => Number.isFinite(value) && value >= .01 && value <= 30)) return null;
  return { label, width, length, height };
}
