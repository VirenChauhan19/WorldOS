// @vitest-environment jsdom
// Browser/device sessions and recognition are mocked; metric fit calculations are real.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorldARController, WorldARMeasurement, WorldAROptions } from './xr';
vi.mock('./useLiveCamera', () => ({ useLiveCamera: vi.fn() }));
vi.mock('./xr', () => ({ isWorldARSupported: vi.fn(), startWorldAR: vi.fn() }));
import { useLiveCamera } from './useLiveCamera';
import { isWorldARSupported, startWorldAR } from './xr';
import LiveSpace from './LiveSpace';

let camera: ReturnType<typeof useLiveCamera>;
let controller: WorldARController;
let options: WorldAROptions;
const measured: WorldARMeasurement = { width: 2, length: 3, corners: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }] };
beforeEach(() => {
  window.history.replaceState(null, '', '#/live');
  camera = { status: 'idle', error: '', analysis: null, analysisFrame: null, steady: false, analyzing: false, start: vi.fn(async () => {}), stop: vi.fn(), retry: vi.fn() };
  controller = { setFootprint: vi.fn(), setRoomLayout: vi.fn(), useDetectedSurface: vi.fn(() => true), selectPoint: vi.fn(() => true), reset: vi.fn(), end: vi.fn(async () => {}) };
  vi.mocked(useLiveCamera).mockReturnValue(camera);
  vi.mocked(isWorldARSupported).mockResolvedValue(false);
  vi.mocked(startWorldAR).mockImplementation(async value => { options = value; value.onState({ phase: 'searching', points: 0, canSelect: false, message: 'Find a horizontal surface.' }); return controller; });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function enterSpace(width: string, length: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Enter measurements' }));
  fireEvent.change(screen.getByLabelText('Space width'), { target: { value: width } });
  fireEvent.change(screen.getByLabelText('Space length'), { target: { value: length } });
}
async function startAR() {
  vi.mocked(isWorldARSupported).mockResolvedValue(true);
  const view = render(<LiveSpace/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Measure a space in AR' }));
  await screen.findByRole('button', { name: 'End AR' });
  return view;
}

it('starts automatic recognition without asking users to label the scene or reusing their fit target as a detection prompt', async () => {
  render(<LiveSpace/>);
  expect((screen.getByRole('switch', { name: 'Automatic item recognition' }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByLabelText(/what would you like to keep track of/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /mark.*item/i })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Open camera & recognize' }));
  expect(camera.start).toHaveBeenCalledOnce();
  fireEvent.click(within(screen.getByRole('group', { name: 'Try an item to add' })).getByRole('button', { name: 'Car' }));
  fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
  fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'A bicycle' } });
  for (const [input] of vi.mocked(useLiveCamera).mock.calls) {
    expect(input.autoAnalyze).toBe(true);
    expect(Object.keys(input).sort()).toEqual(['active', 'autoAnalyze', 'videoRef']);
  }
  expect(camera.start).toHaveBeenCalledOnce();
});

it('compares entered dimensions, preserves example attribution, and clears the verdict for invalid measurements', async () => {
  render(<LiveSpace/>);
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
  enterSpace('60', '50');
  expect(screen.getByRole('heading', { name: 'Example footprint fits' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /actual dimensions/ }));
  expect(screen.getByRole('heading', { name: 'Footprint fits' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Item width'), { target: { value: '80' } });
  expect(screen.getByRole('heading', { name: 'Needs more room' })).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: /actual dimensions/ }) as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText('Space width'), { target: { value: '' } });
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
  expect(screen.queryByRole('img', { name: /Top-down dimension comparison/ })).toBeNull();
  await waitFor(() => expect(isWorldARSupported).toHaveBeenCalled());
});

it('treats a car preset as editable dimensions and never turns a footprint comparison into parking approval', async () => {
  render(<LiveSpace/>);
  fireEvent.click(within(screen.getByRole('group', { name: 'Try an item to add' })).getByRole('button', { name: 'Car' }));
  expect((screen.getByLabelText('Measurement unit') as HTMLSelectElement).value).toBe('m');
  enterSpace('3', '6');
  expect(screen.getByRole('heading', { name: 'Example footprint fits' })).toBeTruthy();
  expect(screen.getByText(/Parked footprint only.*turning path yourself.*Never use while driving/)).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: /including mirrors/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /including mirrors/ }));
  expect(screen.getByRole('heading', { name: 'Footprint fits' })).toBeTruthy();
  expect(screen.queryByText(/safe to park|can be parked|parking approved/i)).toBeNull();
  await waitFor(() => expect(isWorldARSupported).toHaveBeenCalled());
});

it('uses tracked measurements only while tracking is available and clears the renderer on invalid footprint input', async () => {
  await startAR();
  expect(camera.stop).toHaveBeenCalledOnce();
  act(() => { options.onMeasurement(measured); options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Measured.' }); });
  expect(screen.getByRole('heading', { name: 'Example footprint fits' })).toBeTruthy();
  expect(controller.setFootprint).toHaveBeenLastCalledWith({ width: .36, length: .25, clearance: .05, rotated: false });
  act(() => options.onState({ phase: 'tracking-lost', points: 3, canSelect: false, message: 'Tracking paused.' }));
  expect(screen.getByRole('heading', { name: 'Tracking paused' })).toBeTruthy();
  expect(screen.queryByText(/Width remaining/)).toBeNull();
  act(() => options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Tracking restored.' }));
  fireEvent.change(screen.getByLabelText('Item width'), { target: { value: '' } });
  expect(controller.setFootprint).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'End AR' }));
  await waitFor(() => expect(controller.end).toHaveBeenCalledOnce());
});

it('ends an AR session that resolves after navigation and ignores its late callbacks', async () => {
  vi.mocked(isWorldARSupported).mockResolvedValue(true);
  let resolve!: (value: WorldARController) => void;
  vi.mocked(startWorldAR).mockImplementation(value => { options = value; return new Promise(done => { resolve = done; }); });
  const { rerender } = render(<LiveSpace active/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Measure a space in AR' }));
  rerender(<LiveSpace active={false}/>);
  await act(async () => { resolve(controller); });
  expect(controller.end).toHaveBeenCalledOnce();
  act(() => { options.onMeasurement(measured); options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Late callback.' }); });
  rerender(<LiveSpace active/>);
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
  expect(controller.setFootprint).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'End AR' })).toBeNull();
});

it('invalidates callbacks when the browser ends the AR session', async () => {
  await startAR();
  act(() => options.onState({ phase: 'ended', points: 0, canSelect: false, message: 'AR ended.' }));
  act(() => options.onMeasurement(measured));
  expect(screen.queryByRole('button', { name: 'End AR' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
});
