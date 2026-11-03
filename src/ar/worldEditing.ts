import type { XRPoint } from '../live/xr-types';
import type { DesignObject } from './scene';

/** Keep the observed wall back or ceiling top fixed as an AR model is resized.
 * World positions are base centers; the saved plan's axis-aligned minimum
 * corners must not introduce sideways drift at arbitrary physical wall angles. */
export function resizeMountedWorldPosition(before: DesignObject, after: DesignObject, position: XRPoint, rotation: number, surface: 'vertical' | 'ceiling'): XRPoint {
  if (!position || ![position.x, position.y, position.z, rotation].every(Number.isFinite)) {
    throw new Error('The placed object has an invalid position or rotation. Place it again before resizing.');
  }
  if (![before.item.width, before.item.depth, before.item.height, after.item.width, after.item.depth, after.item.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Enter valid object dimensions before resizing.');
  }
  if (surface === 'ceiling') return { ...position, y: position.y - (after.item.height - before.item.height) };
  if (surface !== 'vertical') throw new Error('Choose a wall or ceiling for mounted resizing.');
  const radians = (rotation % 360) * Math.PI / 180, halfDepthChange = (after.item.depth - before.item.depth) / 2;
  return { x: position.x - Math.sin(radians) * halfDepthChange, y: position.y, z: position.z + Math.cos(radians) * halfDepthChange };
}
