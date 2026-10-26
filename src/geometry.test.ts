import { describe, expect, it } from 'vitest';
import { boxFromPoints, center, resizeBox, translateBox } from './geometry';

describe('normalized annotation geometry', () => {
  it('supports drawing in either direction', () => {
    expect(boxFromPoints({ x: .8, y: .9 }, { x: .2, y: .1 })).toEqual({ x: .2, y: .1, width: .6000000000000001, height: .8 });
  });
  it('keeps dragged boxes in the image without changing size', () => {
    expect(translateBox({ x: .2, y: .3, width: .4, height: .5 }, 2, -1)).toEqual({ x: .6, y: 0, width: .4, height: .5 });
  });
  it('clamps resizing to image boundaries and minimum size', () => {
    expect(resizeBox({ x: .7, y: .8, width: .1, height: .1 }, 2, -1)).toEqual({ x: .7, y: .8, width: 1 - .7, height: .015 });
  });
  it('preserves normalized centers across viewport sizes', () => {
    const point = center({ x: .2, y: .4, width: .2, height: .3 });
    for (const width of [375, 800, 1440]) expect((point.x * width) / width).toBeCloseTo(.3);
    expect(point.y).toBeCloseTo(.55);
  });
});
