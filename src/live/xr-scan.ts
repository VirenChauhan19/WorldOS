import type { XRPoint } from './xr-types';
import type { WorldARMeasurement } from './xr';
import { inscribedPlaneRectangle } from './xr-plane';

const HEIGHT_TOLERANCE = .05;
const SAMPLE_SPACING = .2;
const MIN_SAMPLES = 6;
const MAX_SAMPLES = 128;
const MAX_CLUSTERS = 8;
const MIN_CAMERA_MOVEMENT = .15;
const horizontalDistance = (a: XRPoint, b: XRPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const finitePoint = (point: XRPoint) => [point.x, point.y, point.z].every(value => Number.isFinite(value) && Math.abs(value) <= 10000);

/** Geometric floor plausibility only: an unlabelled hit cannot establish whether
 * a surface is the floor. The user must aim at the floor; a lower repeatedly
 * observed level supersedes a higher one. */
export function isPlausibleFloorHit(point: XRPoint, viewer: XRPoint): boolean {
  if (!finitePoint(point) || !finitePoint(viewer)) return false;
  const belowViewer = viewer.y - point.y;
  return belowViewer >= .6 && belowViewer <= 2.5 && horizontalDistance(point, viewer) <= 8;
}

interface Cluster {
  points: XRPoint[];
  minHeight: number;
  maxHeight: number;
  firstViewer: XRPoint;
  cameraMovement: number;
  lastSeen: number;
  revision: number;
}

export interface FloorScanSnapshot {
  measurement: WorldARMeasurement | null;
  sampleCount: number;
  stable: boolean;
  lastSeen: number;
}

function cross(a: XRPoint, b: XRPoint, c: XRPoint) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

/** This hull interpolates between observed hits. Its interior does not prove
 * obstacle clearance, complete room boundaries, or unseen floor geometry. */
function hull(points: readonly XRPoint[]): XRPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const lower: XRPoint[] = [], upper: XRPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-8) lower.pop();
    lower.push(point);
  }
  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-8) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function insideHull(polygon: readonly XRPoint[], point: XRPoint): boolean {
  return polygon.length >= 3 && polygon.every((a, index) => cross(a, polygon[(index + 1) % polygon.length], point) >= -1e-8);
}

function measurementFromCluster(cluster: Cluster, polygon: readonly XRPoint[]): WorldARMeasurement | null {
  if (cluster.points.length < MIN_SAMPLES || cluster.cameraMovement < MIN_CAMERA_MOVEMENT) return null;
  const corners = inscribedPlaneRectangle(polygon.map(point => ({ ...point, y: 0 })));
  if (!corners) return null;
  const width = horizontalDistance(corners[0], corners[1]), length = horizontalDistance(corners[0], corners[3]);
  if (Math.min(width, length) < 1) return null;
  const heights = cluster.points.map(point => point.y).sort((a, b) => a - b);
  const height = heights[Math.floor(heights.length / 2)];
  return { width, length, corners: corners.map(point => ({ ...point, y: height })) as WorldARMeasurement['corners'], source: 'hit-test-scan' };
}

function addSample(cluster: Cluster, point: XRPoint): boolean {
  if (cluster.points.some(sample => horizontalDistance(point, sample) < SAMPLE_SPACING)) return false;
  const next = { ...point };
  if (cluster.points.length < MAX_SAMPLES) cluster.points.push(next);
  else {
    const boundary = hull(cluster.points);
    if (insideHull(boundary, next)) return false;
    const expanded = hull([...cluster.points, next]);
    // Preserve every extreme point, so a bounded scan cannot retract a previously
    // supported corner. An unusually complex full hull simply stops expanding.
    if (expanded.length > MAX_SAMPLES) return false;
    const boundarySet = new Set(expanded);
    cluster.points = [...expanded, ...cluster.points.filter(sample => !boundarySet.has(sample)).slice(0, MAX_SAMPLES - expanded.length)];
  }
  cluster.minHeight = Math.min(...cluster.points.map(sample => sample.y));
  cluster.maxHeight = Math.max(...cluster.points.map(sample => sample.y));
  return true;
}

function sameRectangle(a: WorldARMeasurement, b: WorldARMeasurement): boolean {
  return a.corners.every((point, index) => {
    const previous = b.corners[index];
    return Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) <= .05;
  });
}

/** Bounded observations in one native XR reference space. The caller validates
 * live native poses and resets after tracking loss or a reference-space reset. */
export function createFloorScan() {
  let clusters: Cluster[] = [];
  let active: Cluster | null = null;
  let measurement: WorldARMeasurement | null = null;
  let stableAnchor: WorldARMeasurement | null = null;
  let unchangedSince = -Infinity, lastInputAt = -Infinity, lastComputedAt = -Infinity, computedRevision = -1;

  function chooseCluster(): Cluster | null {
    const recurring = clusters.filter(cluster => cluster.points.length >= 3);
    if (recurring.length) return recurring.sort((a, b) => a.minHeight - b.minHeight)[0];
    return [...clusters].sort((a, b) => b.points.length - a.points.length || a.minHeight - b.minHeight)[0] ?? null;
  }

  function compute(now: number) {
    if (!active || active.revision === computedRevision || now - lastComputedAt < 200) return;
    const polygon = hull(active.points);
    let next = measurementFromCluster(active, polygon);
    // The grid search can choose different axes as a boundary grows. Keep a
    // better prior rectangle only while all its corners remain supported.
    if (measurement && (!next || measurement.width * measurement.length > next.width * next.length) && measurement.corners.every(point => insideHull(polygon, point))) next = measurement;
    computedRevision = active.revision; lastComputedAt = now;
    if (!next) { measurement = null; stableAnchor = null; unchangedSince = -Infinity; return; }
    if (!stableAnchor || !sameRectangle(next, stableAnchor)) { stableAnchor = next; unchangedSince = now; }
    measurement = next;
  }

  return {
    add(point: XRPoint, viewer: XRPoint, now: number): void {
      if (!Number.isFinite(now) || now <= lastInputAt || !isPlausibleFloorHit(point, viewer)) return;
      lastInputAt = now;
      let cluster = clusters
        .filter(value => Math.max(value.maxHeight, point.y) - Math.min(value.minHeight, point.y) <= HEIGHT_TOLERANCE)
        .sort((a, b) => Math.abs((a.minHeight + a.maxHeight) / 2 - point.y) - Math.abs((b.minHeight + b.maxHeight) / 2 - point.y))[0];
      if (!cluster) {
        if (clusters.length >= MAX_CLUSTERS) {
          const evicted = clusters.filter(value => value !== active).sort((a, b) => a.points.length - b.points.length || a.lastSeen - b.lastSeen)[0];
          clusters = clusters.filter(value => value !== evicted);
        }
        cluster = { points: [], minHeight: point.y, maxHeight: point.y, firstViewer: { ...viewer }, cameraMovement: 0, lastSeen: now, revision: 0 };
        clusters.push(cluster);
      }
      cluster.lastSeen = now;
      const movement = horizontalDistance(viewer, cluster.firstViewer);
      if (cluster.cameraMovement < MIN_CAMERA_MOVEMENT && movement >= MIN_CAMERA_MOVEMENT) cluster.revision++;
      cluster.cameraMovement = Math.max(cluster.cameraMovement, movement);
      if (addSample(cluster, point)) cluster.revision++;
      const next = chooseCluster();
      if (active !== next) {
        active = next; measurement = null; stableAnchor = null;
        unchangedSince = -Infinity; computedRevision = -1; lastComputedAt = -Infinity;
      }
      compute(now);
    },
    snapshot(now: number): FloorScanSnapshot {
      return {
        measurement: measurement ? { ...measurement, corners: measurement.corners.map(point => ({ ...point })) as WorldARMeasurement['corners'] } : null,
        sampleCount: active?.points.length ?? 0,
        stable: !!measurement && active?.revision === computedRevision && Number.isFinite(now) && now >= lastInputAt && now - unchangedSince >= 1500 && now - (active?.lastSeen ?? -Infinity) <= 300,
        lastSeen: active?.lastSeen ?? -Infinity,
      };
    },
    reset(): void {
      clusters = []; active = null; measurement = null; stableAnchor = null;
      unchangedSince = -Infinity; lastInputAt = -Infinity; lastComputedAt = -Infinity; computedRevision = -1;
    },
  };
}
