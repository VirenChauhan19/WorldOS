/** All dimensions and positions use metres. The room is a clear rectangular floor. */
export interface RoomSize { width: number; depth: number; height?: number }
export type FurnitureKind = 'bed' | 'desk' | 'table' | 'wardrobe' | 'chair';
export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  label: string;
  width: number;
  depth: number;
  height: number;
  color: string;
}
/** x/z locate the minimum corner of the rotated, axis-aligned footprint. */
export interface FurniturePlacement { itemId: string; x: number; z: number; rotation: 0 | 90 }
export interface RoomLayoutIssue { type: string; itemIds: string[]; message: string }
export interface RoomLayout {
  status: 'fits' | 'partial' | 'unknown' | 'conflict';
  placements: FurniturePlacement[];
  unplacedIds: string[];
  issues: RoomLayoutIssue[];
  reason: string;
  /** Union of placed footprints inside the room, excluding clearance. */
  occupiedArea: number;
  /** Remaining floor area, not a promise of usable circulation or access. */
  freeArea: number;
}

/** Example outer dimensions, including the bed frame. Replace with actual product sizes. */
export const FURNITURE_PRESETS: readonly FurnitureItem[] = [
  { id: 'queen-bed', kind: 'bed', label: 'Queen bed', width: 1.65, depth: 2.15, height: 1.05, color: '#d4c4ab' },
  { id: 'desk', kind: 'desk', label: 'Desk', width: 1.2, depth: .6, height: .75, color: '#b59a73' },
  { id: 'table', kind: 'table', label: 'Table', width: .9, depth: .9, height: .75, color: '#c4a47e' },
  { id: 'wardrobe', kind: 'wardrobe', label: 'Wardrobe', width: 1.2, depth: .6, height: 2.1, color: '#b5bca6' },
  { id: 'chair', kind: 'chair', label: 'Chair', width: .5, depth: .5, height: .85, color: '#a4b6b1' },
];

const MAX_DIMENSION = 30;
const MAX_ITEMS = 12;
const MAX_SEARCH_NODES = 1800;
const MAX_CANDIDATE_CHECKS = 60000;
const EPS = 1e-9; // Floating-point tolerance only; this does not cover measurement error.
const KINDS: readonly string[] = ['bed', 'desk', 'table', 'wardrobe', 'chair'];

export function orientedSize(item: FurnitureItem, rotation: 0 | 90): { width: number; depth: number } {
  return rotation === 90 ? { width: item.depth, depth: item.width } : { width: item.width, depth: item.depth };
}

function dimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_DIMENSION;
}
function validRoom(room: RoomSize | null | undefined): room is RoomSize {
  return !!room && dimension(room.width) && dimension(room.depth) && (room.height === undefined || dimension(room.height));
}
function issue(type: string, itemIds: string[], message: string): RoomLayoutIssue { return { type, itemIds, message }; }

function validate(room: RoomSize | null | undefined, items: readonly FurnitureItem[], gap: number): RoomLayoutIssue[] {
  const issues: RoomLayoutIssue[] = [];
  if (!validRoom(room)) issues.push(issue('invalid-room', [], 'Enter positive, finite room dimensions of at most 30 m.'));
  if (!Number.isFinite(gap) || gap < 0 || gap > MAX_DIMENSION) issues.push(issue('invalid-gap', [], 'Enter a finite furniture gap from 0 to 30 m.'));
  if (items.length > MAX_ITEMS) issues.push(issue('item-limit', [], 'Arrange at most 12 furniture items at a time.'));
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) {
      issues.push(issue('invalid-item', [], 'Every furniture item needs a non-empty ID.'));
      continue;
    }
    if (ids.has(item.id)) issues.push(issue('duplicate-item', [item.id], 'Furniture IDs must be unique.'));
    ids.add(item.id);
    if (!KINDS.includes(item.kind) || !dimension(item.width) || !dimension(item.depth) || !dimension(item.height)) {
      issues.push(issue('invalid-item', [item.id], 'Each item needs a supported kind and positive, finite dimensions of at most 30 m.'));
    }
  }
  return issues;
}

function unknown(room: RoomSize | null | undefined, items: readonly FurnitureItem[], issues: RoomLayoutIssue[]): RoomLayout {
  return {
    status: 'unknown', placements: [], unplacedIds: items.filter(Boolean).map(item => item.id), issues,
    reason: 'The arrangement cannot be assessed until its inputs are valid.', occupiedArea: 0,
    freeArea: validRoom(room) ? room.width * room.depth : 0,
  };
}

interface Rect { itemId: string; x: number; z: number; width: number; depth: number }
function rect(item: FurnitureItem, placement: FurniturePlacement): Rect {
  return { itemId: item.id, x: placement.x, z: placement.z, ...orientedSize(item, placement.rotation) };
}
function inBounds(room: RoomSize, value: Rect): boolean {
  return value.x >= -EPS && value.z >= -EPS
    && value.x + value.width <= room.width + EPS && value.z + value.depth <= room.depth + EPS;
}
function relation(a: Rect, b: Rect): { overlap: boolean; distance: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const depth = Math.min(a.z + a.depth, b.z + b.depth) - Math.max(a.z, b.z);
  return { overlap: width > EPS && depth > EPS, distance: Math.hypot(Math.max(0, -width), Math.max(0, -depth)) };
}
function separated(a: Rect, b: Rect, gap: number): boolean {
  const result = relation(a, b);
  return !result.overlap && result.distance + EPS >= gap;
}

/** Compute the clipped union so overlaps or out-of-bounds edits cannot inflate occupied area. */
function area(room: RoomSize, values: readonly Rect[]): { occupiedArea: number; freeArea: number } {
  const clipped = values.map(value => ({
    left: Math.max(0, value.x), right: Math.min(room.width, value.x + value.width),
    top: Math.max(0, value.z), bottom: Math.min(room.depth, value.z + value.depth),
  })).filter(value => value.right > value.left && value.bottom > value.top);
  const xs = [...new Set(clipped.flatMap(value => [value.left, value.right]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1], right = xs[i];
    const intervals = clipped.filter(value => value.left < right && value.right > left)
      .map(value => [value.top, value.bottom]).sort((a, b) => a[0] - b[0]);
    let length = 0, end = -Infinity;
    for (const [start, finish] of intervals) {
      length += Math.max(0, finish - Math.max(start, end));
      end = Math.max(end, finish);
    }
    total += (right - left) * length;
  }
  const occupiedArea = Math.max(0, Math.min(room.width * room.depth, total));
  return { occupiedArea, freeArea: Math.max(0, room.width * room.depth - occupiedArea) };
}

function fitProofs(room: RoomSize, items: readonly FurnitureItem[]): RoomLayoutIssue[] {
  const issues: RoomLayoutIssue[] = [];
  for (const item of items) {
    const straight = item.width <= room.width + EPS && item.depth <= room.depth + EPS;
    const turned = item.depth <= room.width + EPS && item.width <= room.depth + EPS;
    if (!straight && !turned) issues.push(issue('oversized-item', [item.id], `${item.label} exceeds the room footprint in both checked orientations.`));
    if (room.height !== undefined && item.height > room.height + EPS) issues.push(issue('height', [item.id], `${item.label} is taller than the entered room height.`));
  }
  const total = items.reduce((sum, item) => sum + item.width * item.depth, 0);
  if (total > room.width * room.depth + EPS) {
    issues.push(issue('insufficient-area', items.map(item => item.id), 'The combined furniture footprints exceed the room floor area, even before gaps.'));
  }
  return issues;
}

/**
 * Independently validate edited placements. Gap is the shortest horizontal distance
 * between two rectangles; walls have no mandatory margin. No door, route, or access
 * geometry is inferred. Missing room height remains explicitly unchecked.
 */
export function assessRoomLayout(room: RoomSize | null | undefined, items: readonly FurnitureItem[], placements: readonly FurniturePlacement[], gap = .3): RoomLayout {
  const errors = validate(room, items, gap);
  if (errors.length || !room) return unknown(room, items, errors);
  const byId = new Map(items.map(item => [item.id, item]));
  const seen = new Set<string>();
  for (const value of placements) {
    if (!value || !byId.has(value.itemId) || !Number.isFinite(value.x) || !Number.isFinite(value.z) || ![0, 90].includes(value.rotation)) {
      errors.push(issue('invalid-placement', value?.itemId ? [value.itemId] : [], 'Every placement must refer to a selected item and have finite coordinates and a 0 or 90 degree rotation.'));
    } else if (seen.has(value.itemId)) {
      errors.push(issue('duplicate-placement', [value.itemId], 'An item may be placed only once.'));
    }
    if (value) seen.add(value.itemId);
  }
  if (errors.length) return unknown(room, items, errors);

  const values = placements.map(value => rect(byId.get(value.itemId)!, value));
  const issues = fitProofs(room, items);
  for (const value of values) {
    if (!inBounds(room, value)) issues.push(issue('bounds', [value.itemId], `${byId.get(value.itemId)!.label} extends outside the room.`));
  }
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
    const a = values[i], b = values[j], result = relation(a, b);
    if (result.overlap) issues.push(issue('overlap', [a.itemId, b.itemId], `${byId.get(a.itemId)!.label} overlaps ${byId.get(b.itemId)!.label}.`));
    else if (result.distance + EPS < gap) issues.push(issue('clearance', [a.itemId, b.itemId], `${byId.get(a.itemId)!.label} and ${byId.get(b.itemId)!.label} need the requested ${gap} m gap.`));
  }
  const unplacedIds = items.filter(item => !seen.has(item.id)).map(item => item.id);
  const status = issues.length ? 'conflict' : unplacedIds.length ? 'partial' : 'fits';
  if (unplacedIds.length) issues.push(issue('unplaced', unplacedIds, 'Some selected furniture has not been positioned.'));
  const scope = room.height === undefined ? ' Height is not checked.' : ' Entered furniture heights were compared; overhead margin is not included.';
  return {
    status, placements: placements.map(value => ({ ...value })), unplacedIds, issues, ...area(room, values),
    reason: status === 'fits' ? 'All selected footprints fit with the requested gaps. Doorways and access paths are not checked.' + scope
      : status === 'partial' ? 'Position the remaining items before assessing the whole arrangement.' + scope
      : 'This arrangement has dimensional or placement conflicts. Review the highlighted items.' + scope,
  };
}

function uniqueCoordinates(values: number[], max: number): number[] {
  return [...new Set(values.filter(value => value >= -EPS && value <= max + EPS).map(value => Math.max(0, Math.min(max, value))))].sort((a, b) => a - b);
}

const furnishingOrder: Record<FurnitureKind, number> = { bed: 0, wardrobe: 1, desk: 2, table: 3, chair: 4 };
interface Candidate { placement: FurniturePlacement; footprint: Rect; preference: number[] }

/** Preferences only order the search; every valid orientation and edge remains available.
 * The local back wall is z=0. A quarter turn puts an item's back against the right wall.
 * Beds and tall storage reserve wall space before smaller pieces. Tables favour the
 * open front/centre, without assuming that any doorway or circulation route is clear. */
function candidates(room: RoomSize, item: FurnitureItem, rectangles: readonly Rect[], beds: readonly Rect[], gap: number): Candidate[] {
  const result: Candidate[] = [];
  const rotations: readonly (0 | 90)[] = item.width === item.depth ? [0] : [0, 90];
  for (const rotation of rotations) {
    const size = orientedSize(item, rotation);
    if (size.width > room.width + EPS || size.depth > room.depth + EPS) continue;
    const maxX = room.width - size.width, maxZ = room.depth - size.depth;
    const xs = uniqueCoordinates([0, maxX, maxX / 2, ...rectangles.flatMap(value => [value.x + value.width + gap, value.x - size.width - gap, value.x, value.x + value.width - size.width])], maxX);
    const zs = uniqueCoordinates([0, maxZ, maxZ / 2, ...rectangles.flatMap(value => [value.z + value.depth + gap, value.z - size.depth - gap, value.z, value.z + value.depth - size.depth])], maxZ);
    for (const z of zs) for (const x of xs) {
      const placement = { itemId: item.id, x, z, rotation }, footprint = rect(item, placement);
      const backWall = rotation === 0 ? z / room.depth : (maxX - x) / room.width;
      const wall = Math.min(x / room.width, (maxX - x) / room.width, z / room.depth, (maxZ - z) / room.depth);
      const bedDistance = beds.length ? Math.min(...beds.map(bed => relation(footprint, bed).distance)) / Math.max(room.width, room.depth) : 0;
      const turn = rotation === 0 ? 0 : 1;
      let preference: number[];
      if (item.kind === 'bed') preference = [backWall, turn, Math.min(x, maxX - x) / room.width, x];
      else if (item.kind === 'wardrobe') preference = [backWall, turn, -bedDistance, -x];
      else if (item.kind === 'desk') preference = [wall, -bedDistance, backWall, turn];
      else preference = [Math.hypot((x - maxX / 2) / room.width, (z - maxZ * .72) / room.depth), turn];
      result.push({ placement, footprint, preference });
    }
  }
  return result.sort((a, b) => {
    for (let i = 0; i < a.preference.length; i++) {
      const difference = a.preference[i] - b.preference[i];
      if (Math.abs(difference) > EPS) return difference;
    }
    return a.placement.z - b.placement.z || a.placement.x - b.placement.x || a.placement.rotation - b.placement.rotation;
  });
}

/**
 * Bounded deterministic wall/centre/edge search. Exhaustion is not proof of impossibility.
 * Input order is used only as a stable tie-breaker; returned placements retain item IDs.
 */
export function planRoom(room: RoomSize | null | undefined, items: readonly FurnitureItem[], gap = .3): RoomLayout {
  const errors = validate(room, items, gap);
  if (errors.length || !room) return unknown(room, items, errors);
  const proofs = fitProofs(room, items);
  const individuallyBlocked = new Set(proofs.filter(value => value.type === 'oversized-item' || value.type === 'height').flatMap(value => value.itemIds));
  const eligible = items.filter(item => !individuallyBlocked.has(item.id)).map((item, index) => ({ item, index }))
    .sort((a, b) => furnishingOrder[a.item.kind] - furnishingOrder[b.item.kind] || b.item.width * b.item.depth - a.item.width * a.item.depth || Math.max(b.item.width, b.item.depth) - Math.max(a.item.width, a.item.depth) || a.index - b.index)
    .map(value => value.item);
  const bedIds = new Set(items.filter(item => item.kind === 'bed').map(item => item.id));
  let nodes = 0, checks = 0;
  let best: FurniturePlacement[] = [];
  let solved: FurniturePlacement[] | null = null;
  const placed: FurniturePlacement[] = [], rectangles: Rect[] = [];

  function search(index: number): boolean {
    if (placed.length > best.length) best = placed.map(value => ({ ...value }));
    if (index === eligible.length) { solved = placed.map(value => ({ ...value })); return true; }
    if (++nodes > MAX_SEARCH_NODES || checks >= MAX_CANDIDATE_CHECKS) return false;
    const item = eligible[index];
    for (const { placement, footprint } of candidates(room!, item, rectangles, rectangles.filter(value => bedIds.has(value.itemId)), gap)) {
      if (++checks > MAX_CANDIDATE_CHECKS) return false;
      if (!inBounds(room!, footprint) || !rectangles.every(other => separated(footprint, other, gap))) continue;
      placed.push(placement); rectangles.push(footprint);
      if (search(index + 1)) return true;
      placed.pop(); rectangles.pop();
      if (nodes >= MAX_SEARCH_NODES || checks >= MAX_CANDIDATE_CHECKS) return false;
    }
    return false;
  }
  search(0);

  // Fill any remaining small items into the best partial result without moving it.
  const chosen: FurniturePlacement[] = solved ?? best;
  const chosenRects = chosen.map(value => rect(items.find(item => item.id === value.itemId)!, value));
  if (!solved) for (const item of [...eligible].reverse()) {
    if (chosen.some(value => value.itemId === item.id)) continue;
    for (const { placement, footprint } of candidates(room, item, chosenRects, chosenRects.filter(value => bedIds.has(value.itemId)), gap)) {
      if (inBounds(room, footprint) && chosenRects.every(other => separated(footprint, other, gap))) {
        chosen.push(placement); chosenRects.push(footprint); break;
      }
    }
  }
  const result = assessRoomLayout(room, items, chosen, gap);
  if (result.status === 'fits') return result;
  if (proofs.length) return { ...result, status: 'conflict', reason: 'The selected furniture cannot all fit these entered dimensions: at least one item or the combined footprint exceeds the room. Doorways and access are not assessed.' };
  return {
    ...result, status: 'partial',
    issues: [...result.issues, issue('search-incomplete', result.unplacedIds, 'No complete arrangement was found by the bounded corner search. A different manual arrangement may still fit.')],
    reason: 'No complete arrangement was found within the bounded search. This does not prove the furniture cannot fit; adjust the arrangement, dimensions, or requested gap.',
  };
}
