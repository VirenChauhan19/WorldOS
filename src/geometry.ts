import type { Box } from './types';
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const center = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
export function boxFromPoints(a: {x: number; y: number}, b: {x: number; y: number}): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
export function translateBox(box: Box, dx: number, dy: number): Box {
  return { ...box, x: clamp(box.x + dx, 0, 1 - box.width), y: clamp(box.y + dy, 0, 1 - box.height) };
}
export function resizeBox(box: Box, dx: number, dy: number): Box {
  return { ...box, width: clamp(box.width + dx, 0.015, 1 - box.x), height: clamp(box.height + dy, 0.015, 1 - box.y) };
}
