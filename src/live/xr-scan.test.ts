import { expect, it } from 'vitest';
import { createFloorScan, isPlausibleFloorHit } from './xr-scan';
import type { XRPoint } from './xr-types';

const point = (x: number, z: number, y = 0): XRPoint => ({ x, y, z });
const viewer = (x = 0): XRPoint => ({ x, y: 1.6, z: 0 });
const coverage = [[0, 0], [2, 0], [4, 0], [4, 3], [2, 3], [0, 3]];
function observe(scan: ReturnType<typeof createFloorScan>, samples = coverage, height = 0, start = 0) {
  samples.forEach(([x, z], index) => scan.add(point(x, z, height), viewer(index * .04), start + index * 250));
}

it('accepts only finite nearby hits plausibly below the viewer', () => {
  expect(isPlausibleFloorHit(point(2, 1), viewer())).toBe(true);
  for (const invalid of [point(0, 0, 1.2), point(0, 0, -1), point(9, 0), point(NaN, 0), point(0, Infinity)]) {
    expect(isPlausibleFloorHit(invalid, viewer())).toBe(false);
  }
  expect(isPlausibleFloorHit(point(0, 0), { ...viewer(), y: NaN })).toBe(false);
});

it('requires six distinct samples, movement, and useful spread on both axes', () => {
  const scan = createFloorScan();
  observe(scan, coverage.slice(0, 5));
  expect(scan.snapshot(1000)).toMatchObject({ sampleCount: 5, measurement: null });
  for (let index = 0; index < 20; index++) scan.add(point(.01, .01), viewer(.2), 1250 + index * 250);
  expect(scan.snapshot(6000)).toMatchObject({ sampleCount: 5, measurement: null });
  scan.add(point(0, 3), viewer(.2), 6250);
  expect(scan.snapshot(6250).measurement?.width).toBeCloseTo(3.98);
  expect(scan.snapshot(6250).measurement?.length).toBeCloseTo(2.98);
  expect(scan.snapshot(6250).measurement?.source).toBe('hit-test-scan');

  scan.reset();
  coverage.forEach(([x, z], index) => scan.add(point(x, z), viewer(), index * 250));
  expect(scan.snapshot(1250).measurement).toBeNull();
  scan.add(point(0, 3), viewer(.2), 1500);
  expect(scan.snapshot(1500).measurement).not.toBeNull();

  scan.reset();
  observe(scan, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
  expect(scan.snapshot(1250).measurement).toBeNull();
  scan.reset();
  observe(scan, [[0, 0], [2, 0], [4, 0], [4, .6], [2, .6], [0, .6]]);
  expect(scan.snapshot(1250).measurement).toBeNull();
});

it('keeps a rectangle inside sampled convex coverage instead of its bounding box', () => {
  const scan = createFloorScan();
  observe(scan, [[0, 0], [2, 0], [4, 0], [2, 2], [0, 4], [0, 2]]);
  const measurement = scan.snapshot(1250).measurement;
  expect(measurement).not.toBeNull();
  expect(measurement!.width * measurement!.length).toBeLessThan(8);
  for (const corner of measurement!.corners) {
    expect(corner.x).toBeGreaterThanOrEqual(0);
    expect(corner.z).toBeGreaterThanOrEqual(0);
    expect(corner.x + corner.z).toBeLessThanOrEqual(4);
  }
});

it('ignores isolated height outliers and replaces higher surfaces with a recurring lower level', () => {
  const scan = createFloorScan();
  observe(scan, coverage, .7);
  expect(scan.snapshot(1250).measurement?.corners.every(corner => corner.y === .7)).toBe(true);
  scan.add(point(0, 0, -.6), viewer(.2), 1500);
  expect(scan.snapshot(1500).sampleCount).toBe(6);
  expect(scan.snapshot(1500).lastSeen).toBe(1250);
  observe(scan, coverage.slice(0, 3), 0, 1750);
  expect(scan.snapshot(2250)).toMatchObject({ sampleCount: 3, measurement: null, lastSeen: 2250 });
  coverage.slice(3).forEach(([x, z], index) => scan.add(point(x, z), viewer(.12 + index * .04), 2500 + index * 250));
  const floor = scan.snapshot(3000);
  expect(floor.sampleCount).toBe(6);
  expect(floor.measurement?.corners.every(corner => corner.y === 0)).toBe(true);
  scan.add(point(0, 0, .7), viewer(.2), 3250);
  expect(scan.snapshot(3250).lastSeen).toBe(3000);
});

it('stabilizes only unchanged fresh coverage and restarts stability when it expands', () => {
  const scan = createFloorScan();
  observe(scan);
  expect(scan.snapshot(1250).stable).toBe(false);
  scan.add(point(0, 3), viewer(.2), 2749);
  expect(scan.snapshot(2749).stable).toBe(false);
  scan.add(point(0, 3), viewer(.2), 2750);
  expect(scan.snapshot(2750).stable).toBe(true);
  expect(scan.snapshot(3051).stable).toBe(false);
  scan.add(point(5, 3), viewer(.2), 3250);
  scan.add(point(5, 0), viewer(.2), 3500);
  const expanded = scan.snapshot(3500);
  expect(expanded.measurement!.width * expanded.measurement!.length).toBeGreaterThan(3.98 * 2.98);
  expect(expanded.stable).toBe(false);
  scan.add(point(5, 0), viewer(.2), 5000);
  expect(scan.snapshot(5000).stable).toBe(true);
});

it('ignores invalid and older input, copies native coordinates, and resets all observations', () => {
  const scan = createFloorScan();
  observe(scan);
  const before = scan.snapshot(1250);
  scan.add(point(5, 0), viewer(.2), 1000);
  scan.add(point(5, 0), viewer(.2), 1250);
  scan.add(point(5, 0), viewer(.2), NaN);
  scan.add(point(NaN, 0), viewer(.2), 1500);
  scan.add(point(5, 0), { ...viewer(.2), y: Infinity }, 1500);
  expect(scan.snapshot(1250)).toEqual(before);
  before.measurement!.corners[0].x = -100;
  expect(scan.snapshot(1250).measurement!.corners[0].x).toBeCloseTo(.01);
  scan.reset();
  expect(scan.snapshot(1500)).toEqual({ measurement: null, sampleCount: 0, stable: false, lastSeen: -Infinity });
  const observed = point(0, 0);
  scan.add(observed, viewer(), 0); observed.x = 50;
  observe(scan, coverage.slice(1), 0, 250);
  expect(scan.snapshot(1250).measurement?.width).toBeCloseTo(3.98);
});

it('flushes changed geometry after throttling and bounds retained samples during a longer scan', () => {
  const scan = createFloorScan();
  coverage.forEach(([x, z], index) => scan.add(point(x, z), viewer(index * .04), index * 10));
  expect(scan.snapshot(50).measurement).toBeNull();
  scan.add(point(0, 3), viewer(.2), 200);
  expect(scan.snapshot(200).measurement).not.toBeNull();
  for (let index = 0; index < 169; index++) scan.add(point((index % 13) * .4, Math.floor(index / 13) * .4), viewer(.2), 210 + index);
  scan.add(point(0, 3), viewer(.2), 500);
  expect(scan.snapshot(500).sampleCount).toBe(128);
  expect(scan.snapshot(500).measurement).not.toBeNull();
});

it('retains observed coverage when new hull edges change the rectangle search axes', () => {
  const scan = createFloorScan();
  observe(scan);
  let previousArea = scan.snapshot(1250).measurement!.width * scan.snapshot(1250).measurement!.length;
  [[6, 5], [5, -2], [-2, 4], [-2, -1]].forEach(([x, z], index) => {
    const now = 1500 + index * 250;
    scan.add(point(x, z), viewer(.2), now);
    const next = scan.snapshot(now).measurement!;
    expect(next.width * next.length).toBeGreaterThanOrEqual(previousArea);
    previousArea = next.width * next.length;
  });
});

it('preserves boundary support at the sample cap while still allowing outward expansion', () => {
  const scan = createFloorScan();
  observe(scan);
  for (let index = 0; index < 122; index++) scan.add(point(.4 + (index % 13) * .25, .4 + Math.floor(index / 13) * .24), viewer(.2), 1500 + index);
  scan.add(point(0, 0), viewer(.2), 2000);
  const before = scan.snapshot(2000);
  expect(before.sampleCount).toBe(128);
  scan.add(point(.15, .15), viewer(.2), 2250);
  expect(scan.snapshot(2250).measurement).toEqual(before.measurement);
  scan.add(point(5, 0), viewer(.2), 2500);
  scan.add(point(5, 3), viewer(.2), 2750);
  const expanded = scan.snapshot(2750);
  expect(expanded.sampleCount).toBe(128);
  expect(expanded.measurement!.width * expanded.measurement!.length).toBeGreaterThan(before.measurement!.width * before.measurement!.length);
  expect(expanded.measurement!.corners.every(corner => corner.x >= 0 && corner.x <= 5 && corner.z >= 0 && corner.z <= 3)).toBe(true);
});

it('withholds stable status while changed observations await a throttled geometry update', () => {
  const scan = createFloorScan();
  observe(scan);
  scan.add(point(1, 1), viewer(.2), 2750);
  expect(scan.snapshot(2750).stable).toBe(true);
  scan.add(point(5, 3), viewer(.2), 2751);
  expect(scan.snapshot(2751).measurement).not.toBeNull();
  expect(scan.snapshot(2751).stable).toBe(false);
  scan.add(point(5, 3), viewer(.2), 2950);
  expect(scan.snapshot(2950).stable).toBe(true);
});
