/** Measurements are in metres. A rectangle comparison is not an obstacle or safety check. */
export interface SpaceDimensions {
  width: number;
  length: number;
  height?: number;
}

export interface ItemDimensions extends SpaceDimensions {
  id: string;
  label: string;
}

export type FitVerdict = 'fits' | 'too-tight' | 'does-not-fit' | 'unknown';

export interface FitAssessment {
  verdict: FitVerdict;
  rotation: 0 | 90;
  /** Total remaining horizontal room, before subtracting the requested side margins. */
  remainingWidth: number | null;
  remainingLength: number | null;
  /** Item footprint plus the requested clearance on both horizontal sides. */
  requiredWidth: number | null;
  requiredLength: number | null;
  remainingHeight: number | null;
  clearance: number;
  heightChecked: boolean;
  reason: string;
}

export interface FitSuggestion {
  item: ItemDimensions;
  assessment: FitAssessment;
}

/** Generic examples, not dimensions of a named product or vehicle. Always editable. */
export const ITEM_PRESETS: readonly ItemDimensions[] = [
  { id: 'laptop', label: 'Laptop', width: .36, length: .25, height: .025 },
  { id: 'chair', label: 'Chair', width: .60, length: .60, height: .90 },
  { id: 'cabinet', label: 'Cabinet', width: .80, length: .40, height: 1.20 },
  { id: 'car', label: 'Car', width: 1.85, length: 4.50, height: 1.50 },
];

export const PRESET_NOTICE = 'Example sizes only. Enter the actual dimensions, including protruding parts such as mirrors.';

// This tolerance covers floating-point arithmetic, not sensor error or measurement uncertainty.
const ROUNDING_EPSILON = 1e-9;

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validDimensions(value: SpaceDimensions | null | undefined): value is SpaceDimensions {
  return !!value && positive(value.width) && positive(value.length)
    && (value.height === undefined || positive(value.height));
}

function unknown(clearance: number, reason: string): FitAssessment {
  return {
    verdict: 'unknown', rotation: 0, remainingWidth: null, remainingLength: null,
    requiredWidth: null, requiredLength: null, remainingHeight: null,
    clearance, heightChecked: false, reason,
  };
}

interface Orientation {
  rotation: 0 | 90;
  remainingWidth: number;
  remainingLength: number;
  requiredWidth: number;
  requiredLength: number;
  footprintFits: boolean;
  clearanceFits: boolean;
  overflow: number;
}

function orientation(space: SpaceDimensions, item: ItemDimensions, clearance: number, rotation: 0 | 90): Orientation {
  const width = rotation === 0 ? item.width : item.length;
  const length = rotation === 0 ? item.length : item.width;
  const requiredWidth = width + 2 * clearance;
  const requiredLength = length + 2 * clearance;
  return {
    rotation, remainingWidth: space.width - width, remainingLength: space.length - length,
    requiredWidth, requiredLength,
    footprintFits: width <= space.width + ROUNDING_EPSILON && length <= space.length + ROUNDING_EPSILON,
    clearanceFits: requiredWidth <= space.width + ROUNDING_EPSILON && requiredLength <= space.length + ROUNDING_EPSILON,
    overflow: Math.max(0, requiredWidth - space.width) / space.width + Math.max(0, requiredLength - space.length) / space.length,
  };
}

function priority(value: Orientation): number {
  return value.clearanceFits ? 2 : value.footprintFits ? 1 : 0;
}

/**
 * Compare measured rectangular dimensions in the two axis-aligned orientations.
 * Clearance is reserved at each horizontal edge; no overhead clearance is inferred.
 * This never derives scale from camera pixels or accounts for obstacles, access paths,
 * turning circles, door opening, people, overhangs, slopes, or measurement error.
 */
export function assessFit(space: SpaceDimensions | null | undefined, item: ItemDimensions, clearance = 0): FitAssessment {
  if (!validDimensions(space)) return unknown(clearance, 'Measure the space width and length. Any supplied height must also be a positive finite measurement.');
  if (!validDimensions(item)) return unknown(clearance, 'Enter the actual item width and length. Any supplied height must also be a positive finite measurement.');
  if (!Number.isFinite(clearance) || clearance < 0) return unknown(clearance, 'Enter a finite, non-negative clearance for each horizontal side.');

  const straight = orientation(space, item, clearance, 0);
  const turned = orientation(space, item, clearance, 90);
  if (![straight.requiredWidth, straight.requiredLength, turned.requiredWidth, turned.requiredLength].every(Number.isFinite)) {
    return unknown(clearance, 'The supplied dimensions are outside the supported numeric range.');
  }
  // Avoid a needless turn when both orientations satisfy the same constraints.
  // For an insufficient fit, report the orientation with less proportional overflow.
  const best = priority(turned) > priority(straight)
    || (priority(turned) === priority(straight) && priority(straight) < 2 && turned.overflow < straight.overflow)
    ? turned : straight;

  const heightChecked = space.height !== undefined && item.height !== undefined;
  const remainingHeight = heightChecked ? space.height! - item.height! : null;
  const heightFits = remainingHeight === null || remainingHeight >= -ROUNDING_EPSILON;
  const heightNote = heightChecked ? ' Entered height was also compared; overhead margin is not included.' : ' Height has not been checked.';
  const result = {
    rotation: best.rotation,
    remainingWidth: best.remainingWidth,
    remainingLength: best.remainingLength,
    requiredWidth: best.requiredWidth,
    requiredLength: best.requiredLength,
    remainingHeight, clearance, heightChecked,
  };

  if (!heightFits) return { ...result, verdict: 'does-not-fit', reason: 'The item is taller than the entered available height.' };
  if (!best.footprintFits) return { ...result, verdict: 'does-not-fit', reason: 'The item footprint exceeds the measured rectangle in both checked orientations.' + heightNote };
  if (!best.clearanceFits) return { ...result, verdict: 'too-tight', reason: 'The footprint fits, but the requested room on each side does not.' + heightNote };
  return {
    ...result, verdict: 'fits',
    reason: (clearance === 0 ? 'The footprint fits the measured rectangle. No extra side clearance is reserved.' : 'The footprint and requested clearance fit the measured rectangle.') + heightNote,
  };
}

/** Independent alternatives for the same empty rectangle, not a simultaneous packing plan. */
export function suggestFits(space: SpaceDimensions | null | undefined, items: readonly ItemDimensions[] = ITEM_PRESETS, clearance = 0): FitSuggestion[] {
  const suggestions = items.map(item => ({ item, assessment: assessFit(space, item, clearance) }))
    .filter(value => value.assessment.verdict === 'fits');
  // Log area preserves size ordering without overflowing for large finite measurements.
  return suggestions.sort((a, b) => (Math.log(b.item.width) + Math.log(b.item.length)) - (Math.log(a.item.width) + Math.log(a.item.length)));
}
