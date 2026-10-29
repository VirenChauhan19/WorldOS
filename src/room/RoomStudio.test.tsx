// @vitest-environment jsdom
// Camera, device sessions and rendering are mocked; simultaneous planning remains real.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldARController, WorldARMeasurement, WorldAROptions } from '../live/xr';
import type { FurnitureItem, FurniturePlacement, RoomSize } from './layout';
import { orientedSize } from './layout';

interface PreviewProps { room: RoomSize; showWalls: boolean; items: FurnitureItem[]; placements: FurniturePlacement[] }
vi.mock('./RoomPreview', () => ({ default: (props: PreviewProps) => <output data-testid="room-preview">{JSON.stringify(props)}</output> }));
vi.mock('../live/useLiveCamera', () => ({ useLiveCamera: vi.fn() }));
vi.mock('../live/xr', () => ({ isWorldARSupported: vi.fn(), startWorldAR: vi.fn() }));
import { useLiveCamera } from '../live/useLiveCamera';
import { isWorldARSupported, startWorldAR } from '../live/xr';
import RoomStudio from './RoomStudio';

let camera: ReturnType<typeof useLiveCamera>;
let controller: WorldARController & { useDetectedSurface(): boolean };
let options: WorldAROptions;
const measured: WorldARMeasurement = {
  width: 4, length: 4.5,
  corners: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 4.5 }, { x: 0, y: 0, z: 4.5 }],
};

beforeEach(() => {
  camera = { status: 'idle', error: '', analysis: null, analysisFrame: null, steady: false, analyzing: false, start: vi.fn(async () => {}), stop: vi.fn(), retry: vi.fn() };
  controller = { setFootprint: vi.fn(), setRoomLayout: vi.fn(), selectPoint: vi.fn(() => true), useDetectedSurface: vi.fn(() => true), reset: vi.fn(), end: vi.fn(async () => {}) };
  vi.mocked(useLiveCamera).mockReturnValue(camera);
  vi.mocked(isWorldARSupported).mockResolvedValue(false);
  vi.mocked(startWorldAR).mockImplementation(async value => {
    options = value;
    value.onState({ phase: 'searching', points: 0, canSelect: false, message: 'Find a horizontal surface.' });
    return controller;
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

function preview(): PreviewProps { return JSON.parse(screen.getByTestId('room-preview').textContent!); }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function enterRoom(width: string, depth: string) {
  fireEvent.click(screen.getByRole('button', { name: 'I already know my room size' }));
  change('Room width', width);
  change('Room length', depth);
}
function expectNoPositiveVerdict() {
  expect(screen.queryByRole('heading', { name: /All \d+ fit/ })).toBeNull();
}
async function renderStudio() {
  const result = render(<RoomStudio/>);
  await waitFor(() => expect(isWorldARSupported).toHaveBeenCalledOnce());
  return result;
}
async function startAR() {
  vi.mocked(isWorldARSupported).mockResolvedValue(true);
  const result = render(<RoomStudio/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Scan & furnish in AR' }));
  await screen.findByRole('button', { name: 'End AR' });
  return result;
}

describe('room furnishing controls', () => {
  it('arranges every piece without room dimensions and keeps room fit unconfirmed', async () => {
    await renderStudio();
    expect(screen.getByRole('heading', { name: '4 pieces, one arrangement' })).toBeTruthy();
    expect(screen.getByText(/Room fit is unconfirmed/)).toBeTruthy();
    expectNoPositiveVerdict();
    expect(screen.queryByLabelText('Room width')).toBeNull();
    expect(screen.queryByLabelText('Room length')).toBeNull();
    expect(screen.queryByLabelText('Ceiling height')).toBeNull();
    expect(preview().placements.map(value => value.itemId).sort()).toEqual(['desk', 'queen-bed', 'table', 'wardrobe']);
    expect(preview().showWalls).toBe(false);
    expect(preview().room.width).toBeGreaterThan(0); expect(preview().room.depth).toBeGreaterThan(0);
    expect(screen.getByText(/Check doors, windows, drawers, outlets and access/)).toBeTruthy();
  });

  it('shows optional blank room fields and waits for both dimensions before checking a measured fit', async () => {
    await renderStudio();
    fireEvent.click(screen.getByRole('button', { name: 'I already know my room size' }));
    expect((screen.getByLabelText('Room width') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Room length') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Ceiling height') as HTMLInputElement).value).toBe('');
    expectNoPositiveVerdict();
    expect(preview().placements).toHaveLength(4);
    change('Room width', '4');
    expectNoPositiveVerdict();
    expect(screen.queryByTestId('room-preview')).toBeNull();
    change('Room length', '4.5');
    expect(screen.getByRole('heading', { name: 'All 4 fit the measured space' })).toBeTruthy();
    expect(preview().room).toEqual({ width: 4, depth: 4.5 });
    expect(preview().showWalls).toBe(true);
    expect(preview().placements).toHaveLength(4);
    expect(screen.getByText(/Ceiling height is not checked/)).toBeTruthy();
  });

  it('resizes the suggested footprint when furniture changes without asking for or inventing room dimensions', async () => {
    await renderStudio();
    const before = preview().room;
    change('Furniture width', '6');
    expect(preview().room).not.toEqual(before);
    expect(Math.max(preview().room.width, preview().room.depth)).toBeGreaterThanOrEqual(6);
    expect(preview().placements).toHaveLength(4);
    expect(preview().showWalls).toBe(false);
    expect(screen.queryByLabelText('Room width')).toBeNull();
    expect(screen.getByRole('heading', { name: '4 pieces, one arrangement' })).toBeTruthy();
    expect(screen.getByText(/Room fit is unconfirmed/)).toBeTruthy();
    expectNoPositiveVerdict();
  });

  it('reports unplaced furniture for a small room and renders only the placed pieces', async () => {
    await renderStudio();
    enterRoom('1', '1');
    expectNoPositiveVerdict();
    expect(screen.getByText('Still to place')).toBeTruthy();
    const snapshot = preview();
    expect(snapshot.placements.length).toBeGreaterThan(0);
    expect(snapshot.placements.length).toBeLessThan(4);
    expect(snapshot.placements.some(value => value.itemId === 'queen-bed')).toBe(false);
    expect(screen.getByRole('button', { name: 'Edit Queen bed' }).textContent).toContain('Unplaced');
    expect(screen.getByText(/Unplaced pieces are not shown in the preview/)).toBeTruthy();
  });

  it.each(['room', 'furniture', 'gap'] as const)('removes positive feedback and furniture rendering for invalid %s input', async input => {
    await renderStudio();
    enterRoom('4', '4.5');
    if (input === 'room') change('Room width', '0');
    if (input === 'furniture') change('Furniture width', '');
    if (input === 'gap') change('Space between furniture', '-1');
    expectNoPositiveVerdict();
    expect(screen.getByRole('heading', { name: 'Add valid measurements' })).toBeTruthy();
    if (input === 'room') expect(screen.queryByTestId('room-preview')).toBeNull();
    else expect(preview().placements).toEqual([]);
  });

  it('rechecks changed dimensions, removes furniture and adds a new piece to the shared layout', async () => {
    await renderStudio();
    enterRoom('4', '4.5');
    change('Furniture width', '6');
    expectNoPositiveVerdict();
    expect(preview().placements.some(value => value.itemId === 'queen-bed')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Queen bed' }));
    expect(screen.getByRole('heading', { name: 'All 3 fit the measured space' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add furniture' }));
    fireEvent.click(within(screen.getByLabelText('Furniture collection')).getByRole('button', { name: /Chair/ }));
    expect(screen.getByRole('button', { name: 'Edit Chair' })).toBeTruthy();
    expect(preview().placements).toHaveLength(4);
    expect(preview().items.filter(item => item.kind === 'chair')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'All 4 fit the measured space' })).toBeTruthy();
  });

  it('checks a manual rotation against the room boundary and restores the automatic arrangement on request', async () => {
    await renderStudio();
    for (const name of ['Desk', 'Table', 'Wardrobe']) fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));
    enterRoom('1.7', '2.3');
    expect(screen.getByRole('heading', { name: 'All 1 fit the measured space' })).toBeTruthy();
    const original = preview().placements;
    fireEvent.click(screen.getByRole('button', { name: /Rotate 90/ }));
    expectNoPositiveVerdict();
    expect(screen.getByRole('heading', { name: 'This arrangement needs a change' })).toBeTruthy();
    expect(preview().placements.find(value => value.itemId === 'queen-bed')!.rotation).toBe(90);
    fireEvent.click(screen.getByRole('button', { name: 'Arrange furniture' }));
    expect(preview().placements).toEqual(original);
    expect(screen.getByRole('heading', { name: 'All 1 fit the measured space' })).toBeTruthy();
  });

  it('expands an unmeasured furniture footprint after rotation and movement without inventing a room boundary', async () => {
    await renderStudio();
    for (const name of ['Desk', 'Table', 'Wardrobe']) fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));
    expect(preview().room).toEqual({ width: 1.65, depth: 2.15 });
    fireEvent.click(screen.getByRole('button', { name: /Rotate 90/ }));
    expect(preview().room).toEqual({ width: 2.15, depth: 1.65 });
    expect(preview().placements).toEqual([{ itemId: 'queen-bed', x: 0, z: 0, rotation: 90 }]);
    expect(screen.queryByRole('heading', { name: 'This arrangement needs a change' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move furniture right' }));
    expect(preview().placements[0].x).toBe(.1);
    expect(preview().room.width).toBeCloseTo(2.25);
    expect(preview().showWalls).toBe(false);
    expect(screen.getByRole('heading', { name: '1 pieces, one arrangement' })).toBeTruthy();
    expect(screen.queryByLabelText('Room width')).toBeNull();
    expectNoPositiveVerdict();
  });

  it.each(['empty', 'incomplete', 'invalid'] as const)('shows no arbitrary floor rectangle when the scene is %s', async state => {
    await renderStudio();
    if (state === 'empty') for (const name of ['Queen bed', 'Desk', 'Table', 'Wardrobe']) fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));
    if (state === 'incomplete') {
      fireEvent.click(screen.getByRole('button', { name: 'I already know my room size' }));
      change('Room width', '4');
    }
    if (state === 'invalid') change('Furniture width', '');
    expect(screen.queryByTestId('room-preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Floor plan' }));
    expect(screen.queryByRole('group', { name: 'Editable room floor plan' })).toBeNull();
    expect(screen.queryByText('4 m')).toBeNull(); expect(screen.queryByText('4.5 m')).toBeNull();
    expect(screen.getAllByText(state === 'empty' ? 'Choose your furniture' : state === 'incomplete' ? 'Complete your room measurements' : 'Check furniture sizes').length).toBeGreaterThan(0);
    expectNoPositiveVerdict();
  });

  it('moves a floor-plan piece into another piece by keyboard and preserves the conflict when changing finish', async () => {
    await renderStudio();
    const snapshot = preview();
    const before = snapshot.placements.find(value => value.itemId === 'queen-bed')!;
    const wardrobe = snapshot.placements.find(value => value.itemId === 'wardrobe')!;
    const bedSize = orientedSize(snapshot.items.find(value => value.id === before.itemId)!, before.rotation);
    const targetX = Math.min(snapshot.room.width - bedSize.width, wardrobe.x + .1);
    const targetZ = Math.min(snapshot.room.depth - bedSize.depth, wardrobe.z + .1);
    fireEvent.click(screen.getByRole('button', { name: 'Floor plan' }));
    const bed = screen.getByRole('button', { name: 'Move Queen bed' });
    fireEvent.focus(bed);
    for (let i = 0; i < Math.round(Math.abs(targetX - before.x) * 10); i++) fireEvent.keyDown(bed, { key: targetX > before.x ? 'ArrowRight' : 'ArrowLeft' });
    for (let i = 0; i < Math.round(Math.abs(targetZ - before.z) * 10); i++) fireEvent.keyDown(bed, { key: targetZ > before.z ? 'ArrowDown' : 'ArrowUp' });
    expectNoPositiveVerdict();
    expect(screen.getByRole('heading', { name: 'This arrangement needs a change' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sage finish' }));
    fireEvent.click(screen.getByRole('button', { name: '3D room' }));
    const after = preview().placements.find(value => value.itemId === 'queen-bed')!;
    expect(Math.abs(after.x - targetX)).toBeLessThanOrEqual(.051);
    expect(Math.abs(after.z - targetZ)).toBeLessThanOrEqual(.051);
    const wardrobeSize = orientedSize(snapshot.items.find(value => value.id === wardrobe.itemId)!, wardrobe.rotation);
    expect(Math.min(after.x + bedSize.width, wardrobe.x + wardrobeSize.width) - Math.max(after.x, wardrobe.x)).toBeGreaterThan(0);
    expect(Math.min(after.z + bedSize.depth, wardrobe.z + wardrobeSize.depth) - Math.max(after.z, wardrobe.z)).toBeGreaterThan(0);
    expect(preview().items.find(item => item.id === 'queen-bed')!.color).toBe('#7d8e73');
    expectNoPositiveVerdict();
  });

  it('starts automatic camera recognition without using furniture targets as recognition prompts', async () => {
    await renderStudio();
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    expect(camera.start).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Room width')).toBeNull();
    const calls = vi.mocked(useLiveCamera).mock.calls;
    expect(calls.at(-1)![0].active).toBe(true);
    for (const [input] of calls) {
      expect(input.autoAnalyze).toBe(true);
      expect(Object.keys(input).sort()).toEqual(['active', 'autoAnalyze', 'videoRef']);
    }
  });

  it('restarts camera access after a camera startup failure', async () => {
    camera.status = 'error'; camera.error = 'Camera access was not allowed.';
    await renderStudio();
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    vi.mocked(camera.start).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(camera.start).toHaveBeenCalledOnce();
    expect(camera.retry).not.toHaveBeenCalled();
  });

  it('retries recognition on an already live camera without reopening camera access', async () => {
    camera.status = 'live'; camera.error = 'Recognition paused: connection unavailable.';
    await renderStudio();
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    vi.mocked(camera.start).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(camera.retry).toHaveBeenCalledOnce();
    expect(camera.start).not.toHaveBeenCalled();
  });
});

describe('tracked room session lifecycle', () => {
  it('waits for acceptance of a detected surface before using its dimensions to place every piece', async () => {
    await startAR();
    expect(options.measurementMode).toBe('scan');
    expect(screen.queryByLabelText('Room width')).toBeNull();
    const detected = { label: 'floor', width: 4, length: 4.5 };
    const detectedState = {
      phase: 'searching' as const, points: 0 as const, canSelect: true,
      message: 'A surface is ready.', detectedSurface: detected, detectedSurfaces: [detected],
    };
    act(() => options.onState(detectedState));
    expectNoPositiveVerdict();
    expect(controller.setRoomLayout).toHaveBeenLastCalledWith(null);
    expect(controller.useDetectedSurface).not.toHaveBeenCalled();
    vi.mocked(controller.useDetectedSurface).mockImplementation(() => {
      options.onMeasurement(measured);
      options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Surface accepted.' });
      return true;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use detected floor area' }));
    expect(controller.useDetectedSurface).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'All 4 fit the measured space' })).toBeTruthy();
    expect(vi.mocked(controller.setRoomLayout).mock.calls.at(-1)![0]!.placements).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Edit in 3D' }));
    expect(preview().room).toEqual({ width: 4, depth: 4.5 });
    expect(screen.getByText(/DETECTED SURFACE AREA/)).toBeTruthy();
  });

  it('automatically places all furniture when a stable native scan covers a large enough floor area', async () => {
    await startAR();
    vi.mocked(controller.useDetectedSurface).mockImplementation(() => {
      options.onMeasurement({ ...measured, source: 'hit-test-scan' });
      options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Scanned floor area stays anchored.' });
      return true;
    });
    act(() => options.onState({
      phase: 'measuring', points: 0, canSelect: false, message: 'Floor coverage is steady.',
      detectedSurface: { label: 'scanned floor area', width: 4, length: 4.5, source: 'hit-test-scan' },
      scan: { phase: 'stable', sampleCount: 12, area: 18, message: 'Observed floor coverage is steady.' },
    }));
    expect(controller.useDetectedSurface).toHaveBeenCalledOnce();
    expect(controller.selectPoint).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Room width')).toBeNull();
    expect(screen.getByRole('heading', { name: 'All 4 fit the measured space' })).toBeTruthy();
    expect(vi.mocked(controller.setRoomLayout).mock.calls.at(-1)![0]!.placements).toHaveLength(4);
  });

  it('keeps scanning when stable observed floor coverage cannot fit every selected piece', async () => {
    await startAR();
    act(() => options.onState({
      phase: 'measuring', points: 0, canSelect: false, message: 'Keep scanning to expand this area.',
      detectedSurface: { label: 'scanned floor area', width: 1.1, length: 1.1, source: 'hit-test-scan' },
      scan: { phase: 'stable', sampleCount: 6, area: 1.21, message: 'Observed floor coverage is steady.' },
    }));
    expect(controller.useDetectedSurface).not.toHaveBeenCalled();
    expect(controller.setRoomLayout).toHaveBeenLastCalledWith(null);
    expect(controller.selectPoint).not.toHaveBeenCalled();
    expectNoPositiveVerdict();
    expect(screen.getByRole('button', { name: 'Use detected surface' })).toBeTruthy();
    expect(screen.getByText(/Keep scanning to include more floor/)).toBeTruthy();
  });

  it('renders all four pieces from an AR measurement, pauses fit feedback on tracking loss and clears invalid furniture', async () => {
    await startAR();
    expect(camera.stop).toHaveBeenCalledOnce();
    expect(controller.setRoomLayout).toHaveBeenLastCalledWith(null);
    act(() => {
      options.onMeasurement(measured);
      options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Room measured.' });
    });
    expect(screen.getByRole('heading', { name: 'All 4 fit the measured space' })).toBeTruthy();
    const layout = vi.mocked(controller.setRoomLayout).mock.calls.at(-1)![0]!;
    expect(layout.items).toHaveLength(4);
    expect(layout.placements).toHaveLength(4);
    act(() => options.onState({ phase: 'tracking-lost', points: 3, canSelect: false, message: 'Tracking paused.' }));
    expectNoPositiveVerdict();
    expect(screen.getByText('Fit paused until tracking returns')).toBeTruthy();
    act(() => options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Tracking restored.' }));
    change('Furniture width', '');
    expect(controller.setRoomLayout).toHaveBeenLastCalledWith(null);
    expectNoPositiveVerdict();
  });

  it.each(['inactive', 'hidden', 'unmount'] as const)('cancels pending AR on %s and ends a late session without accepting late measurements', async cause => {
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    let resolve!: (value: WorldARController) => void;
    vi.mocked(startWorldAR).mockImplementation(value => { options = value; return new Promise(done => { resolve = done; }); });
    const view = render(<RoomStudio active/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Scan & furnish in AR' }));
    if (cause === 'inactive') view.rerender(<RoomStudio active={false}/>);
    if (cause === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      fireEvent(document, new Event('visibilitychange'));
    }
    if (cause === 'unmount') view.unmount();
    expect(options.signal?.aborted).toBe(true);
    await act(async () => { resolve(controller); });
    expect(controller.end).toHaveBeenCalledOnce();
    act(() => {
      options.onMeasurement({ ...measured, width: 1, length: 1 });
      options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Late measurement.' });
    });
    expect(controller.setRoomLayout).not.toHaveBeenCalled();
    if (cause !== 'unmount') {
      view.rerender(<RoomStudio active/>);
      expect(screen.getByRole('heading', { name: '4 pieces, one arrangement' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'End AR' })).toBeNull();
      expect(preview().placements).toHaveLength(4); expect(preview().showWalls).toBe(false);
      expectNoPositiveVerdict();
    }
  });

  it('ignores callbacks after the browser ends the AR session', async () => {
    await startAR();
    act(() => options.onState({ phase: 'ended', points: 0, canSelect: false, message: 'AR ended.' }));
    act(() => options.onMeasurement({ ...measured, width: 1, length: 1 }));
    expect(screen.queryByRole('button', { name: 'End AR' })).toBeNull();
    expect(screen.getByRole('heading', { name: '4 pieces, one arrangement' })).toBeTruthy();
    expect(preview().placements).toHaveLength(4); expect(preview().showWalls).toBe(false);
    expectNoPositiveVerdict();
  });
});
