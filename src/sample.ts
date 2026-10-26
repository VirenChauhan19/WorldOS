import type { Box, SceneImage, SceneObject } from './types';
export const SAMPLE_IMAGE: SceneImage = { image_url: '/sample-desk.svg', width: 1200, height: 800, name: 'Studio desk · illustrated sample' };
export const SAMPLE_TARGET: Box = { x: 0.3, y: 0.36, width: 0.4, height: 0.45 };
export const SAMPLE_OBJECTS: SceneObject[] = [
  { id: 'notebook', label: 'Notebook', box: { x: 0.39, y: 0.39, width: 0.16, height: 0.26 }, locked: false },
  { id: 'headphones', label: 'Headphones', box: { x: 0.60, y: 0.50, width: 0.17, height: 0.21 }, locked: false },
  { id: 'coffee', label: 'Coffee', box: { x: 0.78, y: 0.26, width: 0.11, height: 0.16 }, locked: true },
  { id: 'plant', label: 'Plant', box: { x: 0.08, y: 0.10, width: 0.15, height: 0.24 }, locked: true },
  { id: 'phone', label: 'Phone', box: { x: 0.12, y: 0.63, width: 0.085, height: 0.21 }, locked: false },
  { id: 'keyboard', label: 'Keyboard', box: { x: 0.33, y: 0.06, width: 0.36, height: 0.15 }, locked: true },
];
