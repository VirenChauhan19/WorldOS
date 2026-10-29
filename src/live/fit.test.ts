import { describe, expect, it } from 'vitest';
import { assessFit, ITEM_PRESETS, suggestFits } from './fit';
import type { ItemDimensions, SpaceDimensions } from './fit';

const item: ItemDimensions = { id: 'test', label: 'Measured item', width: .7, length: 1.2 };

describe('measured rectangular fit', () => {
  it('reserves clearance on both sides and accepts exact decimal boundaries', () => {
    const result = assessFit({ width: .9, length: 1.4 }, item, .1);
    expect(result.verdict).toBe('fits');
    expect(result.rotation).toBe(0);
    expect(result.requiredWidth).toBeCloseTo(.9);
    expect(result.requiredLength).toBeCloseTo(1.4);
    expect(result.remainingWidth).toBeCloseTo(.2);
    expect(result.remainingLength).toBeCloseTo(.2);
    expect(result.heightChecked).toBe(false);
    expect(result.reason).toContain('Height has not been checked');
  });

  it('finds a 90-degree fit even when the original orientation fits without its margin', () => {
    const result = assessFit({ width: 2, length: 3 }, { ...item, width: 1.8, length: 1 }, .2);
    expect(result.verdict).toBe('fits');
    expect(result.rotation).toBe(90);
    expect(result.requiredWidth).toBeCloseTo(1.4);
    expect(result.requiredLength).toBeCloseTo(2.2);
  });

  it('keeps the original orientation when both fit', () => {
    expect(assessFit({ width: 4, length: 4 }, item, .1).rotation).toBe(0);
  });

  it('distinguishes missing side clearance from an oversized footprint', () => {
    const car: ItemDimensions = { id: 'car', label: 'Actual car dimensions', width: 1.9, length: 4.6 };
    expect(assessFit({ width: 2.2, length: 4.9 }, car, .2).verdict).toBe('too-tight');
    expect(assessFit({ width: 1.8, length: 4.9 }, car, .2).verdict).toBe('does-not-fit');
    expect(assessFit({ width: 2.4, length: 5.2 }, car, .25).verdict).toBe('fits');
  });

  it('does not classify a genuinely insufficient margin as rounding noise', () => {
    expect(assessFit({ width: .899, length: 1.4 }, item, .1).verdict).toBe('too-tight');
    expect(assessFit({ width: .699, length: 1.2 }, item, 0).verdict).toBe('does-not-fit');
  });

  it('checks supplied height and does not infer missing height or overhead clearance', () => {
    const tall = { ...item, height: 1.6 };
    const low = assessFit({ width: 3, length: 3, height: 1.5 }, tall, .1);
    expect(low.verdict).toBe('does-not-fit');
    expect(low.heightChecked).toBe(true);
    expect(low.remainingHeight).toBeCloseTo(-.1);
    const exact = assessFit({ width: 3, length: 3, height: 1.6 }, tall, .1);
    expect(exact.verdict).toBe('fits');
    expect(exact.reason).toContain('overhead margin is not included');
    expect(assessFit({ width: 3, length: 3 }, tall, .1).heightChecked).toBe(false);
    expect(assessFit({ width: 3, length: 3, height: 1.6 }, item, .1).heightChecked).toBe(false);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid dimension %s without a fit claim', value => {
    for (const key of ['width', 'length', 'height'] as const) {
      expect(assessFit({ width: 3, length: 3, [key]: value }, item).verdict).toBe('unknown');
      expect(assessFit({ width: 3, length: 3 }, { ...item, [key]: value }).verdict).toBe('unknown');
    }
  });

  it.each([-1, NaN, Infinity])('rejects invalid side clearance %s', clearance => {
    expect(assessFit({ width: 3, length: 3 }, item, clearance).verdict).toBe('unknown');
  });

  it('leaves unknown measurements empty and rejects numeric overflow', () => {
    const result = assessFit(null, item);
    expect(result.verdict).toBe('unknown');
    expect(result.remainingWidth).toBeNull();
    expect(result.requiredLength).toBeNull();
    expect(assessFit(undefined, item).verdict).toBe('unknown');
    expect(assessFit({ width: 1 } as SpaceDimensions, item).verdict).toBe('unknown');
    expect(assessFit({ width: 1e308, length: 1e308 }, item, 1e308).verdict).toBe('unknown');
  });

  it('makes zero-clearance interpretation explicit', () => {
    const result = assessFit({ width: .7, length: 1.2 }, item);
    expect(result.verdict).toBe('fits');
    expect(result.reason).toContain('No extra side clearance');
  });
});

describe('what else fits', () => {
  it('returns only independently fitting alternatives, largest footprint first', () => {
    const candidates: ItemDimensions[] = [
      { id: 'small', label: 'Small', width: .2, length: .2 },
      { id: 'large', label: 'Large', width: .8, length: .7 },
      { id: 'tight', label: 'Tight', width: .9, length: .9 },
      { id: 'oversize', label: 'Oversize', width: 2, length: 2 },
      { id: 'tall', label: 'Tall', width: .5, length: .5, height: 3 },
    ];
    const original = structuredClone(candidates);
    const results = suggestFits({ width: 1, length: 1, height: 2 }, candidates, .1);
    expect(results.map(result => result.item.id)).toEqual(['large', 'small']);
    expect(results.every(result => result.assessment.verdict === 'fits')).toBe(true);
    expect(candidates).toEqual(original);
  });

  it('does not suggest anything without measurements and keeps presets reusable', () => {
    expect(suggestFits(null)).toEqual([]);
    const original = structuredClone(ITEM_PRESETS);
    expect(suggestFits({ width: 1, length: 1 }).length).toBeGreaterThan(0);
    expect(ITEM_PRESETS).toEqual(original);
  });
});
