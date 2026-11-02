import type { SceneObject } from '../types';

// Bounded 2D patch tracking. This follows visible image texture only; it never
// infers depth, keeps world anchors, or extrapolates through lost tracking.
export type TrackingFrame = { pixels: Uint8Array; width: number; height: number; at: number };
export const TRACK_TTL_MS = 8000;
const R = 3;
const PATCH_PIXELS = (R * 2 + 1) ** 2;
type Point = { x: number; y: number; texture: number };

export function trackingFrame(rgba: Uint8ClampedArray, width: number, height: number, at: number): TrackingFrame {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  return { pixels, width, height, at };
}

function inside(frame: TrackingFrame, x: number, y: number) {
  return x >= R && y >= R && x < frame.width - R && y < frame.height - R;
}

function texture(frame: TrackingFrame, x: number, y: number) {
  let sum = 0, squared = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const value = frame.pixels[(y + dy) * frame.width + x + dx];
    sum += value; squared += value * value;
  }
  return squared / PATCH_PIXELS - (sum / PATCH_PIXELS) ** 2;
}

function match(a: TrackingFrame, b: TrackingFrame, point: Point, radius: number) {
  let best = Infinity, second = Infinity, mx = 0, my = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const x = point.x + dx, y = point.y + dy;
    if (!inside(b, x, y)) continue;
    let error = 0;
    for (let py = -R; py <= R; py++) for (let px = -R; px <= R; px++) {
      error += Math.abs(a.pixels[(point.y + py) * a.width + point.x + px] - b.pixels[(y + py) * b.width + x + px]);
    }
    error /= PATCH_PIXELS;
    if (error < best) { second = best; best = error; mx = dx; my = dy; }
    else if (error < second) second = error;
  }
  // Ambiguous repeated texture and occlusions fail closed.
  return best < 18 && second - best > 1.5 && best < second * .85 ? { dx: mx, dy: my } : null;
}

export function trackObjects(objects: SceneObject[], before: TrackingFrame, after: TrackingFrame): SceneObject[] {
  if (before.width !== after.width || before.height !== after.height || after.at - before.at > 400 || after.at < before.at) return [];
  if (before === after) return objects;
  return objects.flatMap(object => {
    // Preserve a label on an unchanged region even when its surface lacks
    // texture. Include the boundary so a moving plain object is not retained
    // just because the middle of its old box is still the same colour.
    let difference = 0, samples = 0;
    for (let y = Math.max(0, Math.floor(object.box.y * before.height) - 2); y < Math.min(before.height, Math.ceil((object.box.y + object.box.height) * before.height) + 2); y++) {
      for (let x = Math.max(0, Math.floor(object.box.x * before.width) - 2); x < Math.min(before.width, Math.ceil((object.box.x + object.box.width) * before.width) + 2); x++) {
        difference += Math.abs(before.pixels[y * before.width + x] - after.pixels[y * after.width + x]); samples++;
      }
    }
    if (samples && difference / samples < 1) return [object];
    const candidates: Point[] = [];
    for (const fx of [.05, .25, .5, .75, .95]) for (const fy of [.05, .25, .5, .75, .95]) {
      const x = Math.round((object.box.x + object.box.width * fx) * before.width);
      const y = Math.round((object.box.y + object.box.height * fy) * before.height);
      if (inside(before, x, y)) candidates.push({ x, y, texture: texture(before, x, y) });
    }
    const points = candidates.sort((a, b) => b.texture - a.texture).filter((point, index, all) =>
      point.texture > 60 && !all.slice(0, index).some(other => Math.hypot(point.x - other.x, point.y - other.y) < 4)).slice(0, 9);
    const shifts = points.flatMap(point => {
      const forward = match(before, after, point, 6);
      if (!forward) return [];
      const reverse = match(after, before, { ...point, x: point.x + forward.dx, y: point.y + forward.dy }, 6);
      return reverse && Math.abs(forward.dx + reverse.dx) <= 1 && Math.abs(forward.dy + reverse.dy) <= 1 ? [forward] : [];
    });
    const agreed = shifts.map(shift => shifts.filter(other => Math.abs(other.dx - shift.dx) <= 1 && Math.abs(other.dy - shift.dy) <= 1)).sort((a, b) => b.length - a.length)[0];
    if (!agreed || agreed.length < Math.max(3, Math.ceil(shifts.length * .6))) return [];
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const x = object.box.x + median(agreed.map(shift => shift.dx)) / before.width;
    const y = object.box.y + median(agreed.map(shift => shift.dy)) / before.height;
    if (x < 0 || y < 0 || x + object.box.width > 1 || y + object.box.height > 1) return [];
    return [{ ...object, box: { ...object.box, x, y } }];
  });
}

export class ImageTracker {
  constructor(private ttlMs=TRACK_TTL_MS){}
  private history: TrackingFrame[] = [];
  private objects: SceneObject[] = [];
  private capturedAt = -Infinity;

  clear() { this.history = []; this.objects = []; this.capturedAt = -Infinity; }

  push(frame: TrackingFrame): SceneObject[] {
    const previous = this.history.at(-1);
    this.history.push(frame);
    // Bound both age and memory; never retain full camera photographs here.
    this.history = this.history.filter(value => frame.at - value.at <= TRACK_TTL_MS).slice(-110);
    this.objects = frame.at - this.capturedAt > this.ttlMs ? [] : previous ? trackObjects(this.objects, previous, frame) : [];
    return this.objects;
  }

  seed(objects: SceneObject[], captured: TrackingFrame): SceneObject[] {
    const index = this.history.indexOf(captured);
    this.objects = [];
    if (index < 0) return [];
    let tracked = objects;
    // Replay the exact image path while the API was running, so old boxes
    // cannot suddenly appear at their original coordinates over a new view.
    for (let i = index + 1; i < this.history.length && tracked.length; i++) {
      tracked = trackObjects(tracked, this.history[i - 1], this.history[i]);
    }
    this.capturedAt = captured.at;
    this.objects = tracked;
    return tracked;
  }
}
