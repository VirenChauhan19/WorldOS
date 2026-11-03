// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AR_CATALOG, createCatalogItem } from './catalog';
import { nativeARCapabilities, nativeModel, startNativeInteriorAR } from './native';
import type { NativeARController, NativeARModel } from './native';
import { furnitureMeshes } from '../room/furnitureGeometry';
import type { WorldAROptions, WorldARPlacementPose, WorldARSceneObject, WorldARState } from '../live/xr';

const bridge = vi.hoisted(() => ({
  isNativePlatform: vi.fn(), getPlatform: vi.fn(), isPluginAvailable: vi.fn(),
  getCapabilities: vi.fn(), start: vi.fn(), updateScene: vi.fn(), select: vi.fn(), end: vi.fn(), addListener: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: bridge.isNativePlatform, getPlatform: bridge.getPlatform, isPluginAvailable: bridge.isPluginAvailable },
  registerPlugin: () => bridge,
}));

type EventState = Partial<WorldARState> & { sessionId: string; pose?: WorldARPlacementPose; reset?: boolean };
type SentScene = {
  sessionId: string;
  objects: (WorldARSceneObject & { meshes: NativeARModel['meshes'] })[];
  selectedId: string | null;
  preview: NativeARModel | null;
  previewRotation: number;
};
const controllers: NativeARController[] = [];
const listeners: { receive: (state: EventState) => void; remove: ReturnType<typeof vi.fn> }[] = [];
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function options(extra: Partial<WorldAROptions> = {}) {
  return {
    canvas: document.createElement('canvas'), overlay: document.createElement('div'),
    onState: vi.fn(), onMeasurement: vi.fn(), onPlace: vi.fn(), onObjectSelect: vi.fn(), onSceneReset: vi.fn(), ...extra,
  };
}
async function open(extra: Partial<WorldAROptions> = {}) {
  const callbacks = options(extra), ar = await startNativeInteriorAR(callbacks);
  controllers.push(ar);
  const sessionId = bridge.start.mock.calls.at(-1)![0].sessionId as string;
  const listener = listeners.at(-1)!;
  const emit = (state: Omit<EventState, 'sessionId'>, id = sessionId) => listener.receive({ sessionId: id, ...state });
  return { ar, callbacks, sessionId, listener, emit };
}
function object(id = 'chair-one', x = 0): WorldARSceneObject {
  return { id, item: createCatalogItem('chair', id), position: { x, y: 0, z: -1 }, rotation: 0 };
}
function sent(index = -1) { return bridge.updateScene.mock.calls.at(index)![0] as SentScene; }
const hit = { phase: 'ready' as const, canSelect: true, pose: { position: { x: 1, y: .75, z: -2 }, rotation: 0 } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(1000);
  bridge.isNativePlatform.mockReturnValue(true);
  bridge.getPlatform.mockReturnValue('ios');
  bridge.isPluginAvailable.mockReturnValue(true);
  bridge.getCapabilities.mockResolvedValue({ supported: true, cameraPermission: 'prompt' });
  bridge.start.mockResolvedValue(undefined);
  bridge.updateScene.mockResolvedValue(undefined);
  bridge.select.mockResolvedValue({ id: null });
  bridge.end.mockResolvedValue(undefined);
  bridge.addListener.mockImplementation(async (_event: string, receive: (state: EventState) => void) => {
    const listener = { receive, remove: vi.fn().mockResolvedValue(undefined) };
    listeners.push(listener);
    return listener;
  });
  document.documentElement.className = 'ordinary-app';
});
afterEach(async () => {
  for (const ar of controllers.splice(0)) await ar.end();
  listeners.length = 0;
  document.documentElement.className = '';
  vi.useRealTimers();
});

describe('native AR discovery', () => {
  it('never calls the camera bridge from Safari, Android, or an app without the plugin', async () => {
    bridge.isNativePlatform.mockReturnValue(false);
    expect(await nativeARCapabilities()).toEqual({ supported: false });
    bridge.isNativePlatform.mockReturnValue(true); bridge.getPlatform.mockReturnValue('android');
    expect(await nativeARCapabilities()).toEqual({ supported: false });
    bridge.getPlatform.mockReturnValue('ios'); bridge.isPluginAvailable.mockReturnValue(false);
    expect(await nativeARCapabilities()).toEqual({ supported: false });
    expect(bridge.getCapabilities).not.toHaveBeenCalled();
    expect(bridge.start).not.toHaveBeenCalled();
    expect(bridge.addListener).not.toHaveBeenCalled();
  });

  it('reports native capability and denied permission without requesting camera access', async () => {
    const result = { supported: true, cameraPermission: 'denied', reason: 'Allow Camera in Settings.' };
    bridge.getCapabilities.mockResolvedValue(result);
    expect(await nativeARCapabilities()).toEqual(result);
    expect(bridge.start).not.toHaveBeenCalled();
    expect(bridge.updateScene).not.toHaveBeenCalled();
    bridge.getCapabilities.mockRejectedValue(new Error('Bridge unavailable'));
    expect(await nativeARCapabilities()).toMatchObject({ supported: false, reason: expect.stringContaining('Reopen') });
  });
});

describe('native catalog geometry', () => {
  it.each(AR_CATALOG)('exports $id at its base center with finite triangles and unchanged winding', ({ item }) => {
    const native = nativeModel(item), points: number[][] = [];
    const signatures = (meshes: NativeARModel['meshes']) => meshes.flatMap(mesh => {
      const result: string[] = [];
      for (let i = 0; i < mesh.vertices.length; i += 9) {
        const [a, b, c] = [0, 3, 6].map(offset => mesh.vertices.slice(i + offset, i + offset + 3));
        const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
        const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        result.push([...mesh.color, ...normal].map(value => (Math.abs(value) < 1e-10 ? 0 : value).toFixed(10)).join(','));
      }
      return result;
    }).sort();
    expect(native.meshes.length).toBeGreaterThan(0);
    for (const mesh of native.meshes) {
      expect(mesh.vertices.length % 9).toBe(0);
      expect(mesh.vertices.every(Number.isFinite)).toBe(true);
      expect(mesh.color).toHaveLength(4);
      expect(mesh.color.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
      for (let i = 0; i < mesh.vertices.length; i += 3) points.push(mesh.vertices.slice(i, i + 3));
    }
    for (const [axis, lower, upper] of [[0, -item.width / 2, item.width / 2], [1, 0, item.height], [2, -item.depth / 2, item.depth / 2]]) {
      const min = Math.min(...points.map(point => point[axis])), max = Math.max(...points.map(point => point[axis]));
      expect(min).toBeGreaterThanOrEqual(lower - 1e-9);
      expect(max).toBeLessThanOrEqual(upper + 1e-9);
      // Foliage stays slightly within the declared footprint; rigid furniture
      // reaches its exact bounds. Both remain life-size, centered at the base.
      expect(max - min).toBeGreaterThan((upper - lower) * .8);
      if (item.kind !== 'plant' || axis === 1) {
        expect(min).toBeCloseTo(lower, 9);
        expect(max).toBeCloseTo(upper, 9);
      }
    }
    expect(signatures(native.meshes)).toEqual(signatures(furnitureMeshes(item, { itemId: item.id, x: 0, z: 0, rotation: 0 })));
  });

  it('does not share mutable model arrays or item data between independent placements', () => {
    const item = createCatalogItem('desk', 'desk'), first = nativeModel(item), second = nativeModel(item);
    first.item.width = 99; first.meshes[0].vertices[0] = 99; first.meshes[0].color[0] = 99;
    expect(second.item).toEqual(item);
    expect(second.meshes[0].vertices[0]).not.toBe(99);
    expect(second.meshes[0].color[0]).not.toBe(99);
  });
});

it('subscribes before starting and acknowledges an empty world before exposing the native editor', async () => {
  const r = await open();
  expect(bridge.addListener).toHaveBeenCalledWith('state', expect.any(Function));
  expect(bridge.addListener.mock.invocationCallOrder[0]).toBeLessThan(bridge.start.mock.invocationCallOrder[0]);
  expect(sent()).toMatchObject({ sessionId: r.sessionId, objects: [], selectedId: null, preview: null });
  expect(document.documentElement.classList.contains('native-interior-ar')).toBe(true);
  expect(document.documentElement.classList.contains('ordinary-app')).toBe(true);
  expect(r.ar.getPlacementPose?.()).toBeNull();
});

it('does not register listeners or open the camera for an already cancelled request', async () => {
  const abort = new AbortController(); abort.abort();
  await expect(startNativeInteriorAR(options({ signal: abort.signal }))).rejects.toMatchObject({ name: 'AbortError' });
  expect(bridge.addListener).not.toHaveBeenCalled();
  expect(bridge.start).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('requires a fresh finite pose from this session and uses the preview rotation when placing', async () => {
  const r = await open();
  r.ar.setPlacementPreview?.(object().item, 90);
  r.emit(hit, 'another-session');
  expect(r.ar.selectPoint()).toBe(false);
  for (const bad of [NaN, Infinity, 51]) {
    r.emit({ ...hit, pose: { ...hit.pose, position: { ...hit.pose.position, x: bad } } });
    expect(r.ar.selectPoint()).toBe(false);
  }
  r.emit(hit);
  const pose = r.ar.getPlacementPose?.();
  expect(pose).toEqual({ position: hit.pose.position, rotation: 90 });
  pose!.position.x = 40;
  expect(r.ar.selectPoint()).toBe(true);
  expect(r.callbacks.onPlace).toHaveBeenLastCalledWith({ position: hit.pose.position, rotation: 90 });
  vi.advanceTimersByTime(351);
  expect(r.ar.getPlacementPose?.()).toBeNull();
  expect(r.ar.selectPoint()).toBe(false);
  vi.advanceTimersByTime(250);
  expect(r.callbacks.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'tracking-lost', canSelect: false }));
  r.emit(hit);
  expect(r.ar.selectPoint()).toBe(true);
  r.emit({ phase: 'tracking-lost', canSelect: true, pose: hit.pose });
  expect(r.ar.selectPoint()).toBe(false);
});

it('serializes native writes and sends only the newest complete scene after an in-flight move', async () => {
  const r = await open(), firstWrite = deferred<void>();
  bridge.updateScene.mockImplementationOnce(() => firstWrite.promise);
  const original = object();
  r.ar.setScene?.([original], original.id); await settle();
  expect(bridge.updateScene).toHaveBeenCalledTimes(2);
  original.position.x = 99;
  expect(sent().objects[0].position.x).toBe(0);
  r.ar.setScene?.([object('chair-one', 1)]);
  const latest = object('chair-one', 3); latest.item.color = '#ff0000'; latest.rotation = 180;
  r.ar.setScene?.([latest, object('chair-two', -2)], latest.id);
  r.ar.setPlacementPreview?.(createCatalogItem('desk', 'preview-desk'), 270);
  await settle();
  expect(bridge.updateScene).toHaveBeenCalledTimes(2);
  firstWrite.resolve(); await settle();
  expect(bridge.updateScene).toHaveBeenCalledTimes(3);
  expect(sent()).toMatchObject({ selectedId: 'chair-one', previewRotation: 270, preview: { item: { id: 'preview-desk' } } });
  expect(sent().objects.map(item => ({ id: item.id, x: item.position.x, rotation: item.rotation }))).toEqual([
    { id: 'chair-one', x: 3, rotation: 180 }, { id: 'chair-two', x: -2, rotation: 0 },
  ]);
  expect(sent().objects[0].item.color).toBe('#ff0000');
  expect(sent().objects[0].meshes).not.toEqual(sent(1).objects[0].meshes);
});

it('picks only known scene objects and ignores superseded taps or foreign tracking events', async () => {
  const r = await open(), tap = deferred<{ id: string | null }>();
  r.ar.setScene?.([object()]); await settle();
  r.emit(hit, 'foreign');
  await r.ar.selectAt(.5, .5);
  expect(bridge.select).not.toHaveBeenCalled();
  r.emit({ phase: 'ready', canSelect: false });
  bridge.select.mockResolvedValueOnce({ id: 'not-in-this-design' });
  await r.ar.selectAt(.2, .7);
  expect(bridge.select).toHaveBeenLastCalledWith({ sessionId: r.sessionId, x: .2, y: .7 });
  expect(r.callbacks.onObjectSelect).toHaveBeenLastCalledWith(null);
  bridge.select.mockImplementationOnce(() => tap.promise);
  const pending = r.ar.selectAt(.5, .5);
  r.ar.setPlacementPreview?.(object().item);
  tap.resolve({ id: 'chair-one' }); await pending;
  expect(r.callbacks.onObjectSelect).toHaveBeenCalledTimes(1);
  r.emit(hit);
  await r.ar.selectAt(.5, .5);
  expect(r.callbacks.onPlace).toHaveBeenCalledTimes(1);
  r.ar.setPlacementPreview?.(null);
  bridge.select.mockResolvedValueOnce({ id: 'chair-one' });
  await r.ar.selectAt(.5, .5);
  expect(r.callbacks.onObjectSelect).toHaveBeenLastCalledWith('chair-one');
  const count = bridge.select.mock.calls.length;
  for (const [x, y] of [[-1, .5], [.5, 2], [NaN, .5]]) await r.ar.selectAt(x, y);
  vi.advanceTimersByTime(351); await r.ar.selectAt(.5, .5);
  expect(bridge.select).toHaveBeenCalledTimes(count);
});

it('cancels pending camera permission without restoring an ended session after a late success', async () => {
  const permission = deferred<void>(), abort = new AbortController(), callbacks = options({ signal: abort.signal });
  bridge.start.mockImplementationOnce(() => permission.promise);
  const starting = startNativeInteriorAR(callbacks), rejected = expect(starting).rejects.toMatchObject({ name: 'AbortError' });
  await settle();
  const sessionId = bridge.start.mock.calls[0][0].sessionId;
  abort.abort(); await settle();
  expect(bridge.end).toHaveBeenCalledWith({ sessionId });
  expect(listeners[0].remove).toHaveBeenCalledTimes(1);
  permission.resolve(); await rejected;
  listeners[0].receive({ ...hit, sessionId });
  expect(document.documentElement.classList.contains('native-interior-ar')).toBe(false);
  expect(document.documentElement.classList.contains('ordinary-app')).toBe(true);
  expect(bridge.updateScene).not.toHaveBeenCalled();
  expect(callbacks.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'ended' }));
});

it('removes a listener that arrives after start cancellation without opening the camera', async () => {
  const abort = new AbortController(), registration = deferred<{ remove: ReturnType<typeof vi.fn> }>();
  const remove = vi.fn().mockResolvedValue(undefined);
  bridge.addListener.mockImplementationOnce(() => registration.promise);
  const starting = startNativeInteriorAR(options({ signal: abort.signal }));
  const rejected = expect(starting).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort(); registration.resolve({ remove }); await rejected;
  expect(remove).toHaveBeenCalledTimes(1);
  expect(bridge.start).not.toHaveBeenCalled();
  expect(document.documentElement.classList.contains('native-interior-ar')).toBe(false);
});

it('cleans up a denied camera request and supports a fresh subsequent session', async () => {
  bridge.start.mockRejectedValueOnce({ code: 'CAMERA_PERMISSION_DENIED', message: 'Allow Camera in Settings.' });
  await expect(startNativeInteriorAR(options())).rejects.toMatchObject({ code: 'CAMERA_PERMISSION_DENIED' });
  expect(listeners[0].remove).toHaveBeenCalledTimes(1);
  expect(document.documentElement.classList.contains('native-interior-ar')).toBe(false);
  const r = await open();
  expect(r.sessionId).not.toBe(bridge.start.mock.calls[0][0].sessionId);
  expect(document.documentElement.classList.contains('native-interior-ar')).toBe(true);
});

it('ends idempotently, releases listeners and CSS, and ignores late updates and picks', async () => {
  const r = await open(), update = deferred<void>(), pick = deferred<{ id: string | null }>();
  r.emit(hit); r.ar.setScene?.([object()]); await settle();
  bridge.select.mockImplementationOnce(() => pick.promise);
  const selecting = r.ar.selectAt(.5, .5);
  bridge.updateScene.mockImplementationOnce(() => update.promise);
  r.ar.setScene?.([object('chair-one', 2)]); await settle();
  await r.ar.end(); await r.ar.end();
  update.reject({ code: 'AR_RESET' }); pick.resolve({ id: 'chair-one' }); await selecting; await settle();
  r.emit(hit);
  r.ar.setScene?.([object()]); r.ar.setPlacementPreview?.(object().item); await settle();
  expect(bridge.end).toHaveBeenCalledTimes(1);
  expect(r.listener.remove).toHaveBeenCalledTimes(1);
  expect(r.callbacks.onObjectSelect).not.toHaveBeenCalled();
  expect(r.callbacks.onSceneReset).not.toHaveBeenCalled();
  expect(r.ar.selectPoint()).toBe(false);
  expect(document.documentElement.classList.contains('native-interior-ar')).toBe(false);
  expect(document.documentElement.classList.contains('ordinary-app')).toBe(true);
  expect(bridge.updateScene).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('clears old world positions and invalidates a pending pick when the tracking origin resets', async () => {
  const r = await open(), pick = deferred<{ id: string | null }>();
  r.emit(hit); r.ar.setScene?.([object()]); await settle();
  bridge.select.mockImplementationOnce(() => pick.promise);
  const selecting = r.ar.selectAt(.5, .5);
  r.emit({ phase: 'searching', canSelect: false, reset: true }); await settle();
  expect(r.callbacks.onSceneReset).toHaveBeenCalledTimes(1);
  expect(r.ar.getPlacementPose?.()).toBeNull();
  expect(sent()).toMatchObject({ objects: [], selectedId: null, preview: null });
  pick.resolve({ id: 'chair-one' }); await selecting;
  expect(r.callbacks.onObjectSelect).not.toHaveBeenCalled();
  r.ar.setScene?.([object('fresh-chair', 4)]); await settle();
  expect(sent().objects.map(value => value.id)).toEqual(['fresh-chair']);
});

it('acknowledges a newer reset even when an older reset acknowledgement is still in flight', async () => {
  const r = await open(), acknowledgement = deferred<void>();
  bridge.updateScene.mockImplementationOnce(() => acknowledgement.promise);
  r.ar.reset(); await settle();
  r.emit({ phase: 'searching', canSelect: false, reset: true });
  r.ar.setScene?.([object('new-origin-chair', 2)]);
  acknowledgement.resolve(); await settle();
  const updates = bridge.updateScene.mock.calls.slice(1).map(call => call[0] as SentScene);
  expect(updates.map(update => update.objects.map(value => value.id))).toEqual([[], [], ['new-origin-chair']]);
});

it('waits for tracking recovery before retrying the newest native scene', async () => {
  const r = await open();
  bridge.updateScene.mockRejectedValueOnce({ code: 'AR_TRACKING', message: 'Tracking is limited.' });
  r.ar.setScene?.([object('chair-one', 1)]); await settle();
  const count = bridge.updateScene.mock.calls.length;
  r.ar.setScene?.([object('chair-one', 4)]); await settle();
  r.emit({ phase: 'tracking-lost', canSelect: false }); await settle();
  expect(bridge.updateScene).toHaveBeenCalledTimes(count);
  r.emit(hit); await settle();
  expect(bridge.updateScene).toHaveBeenCalledTimes(count + 1);
  expect(sent().objects[0].position.x).toBe(4);
  expect(bridge.end).not.toHaveBeenCalled();
});

it('clears rejected world coordinates before acknowledging a native origin mismatch', async () => {
  const r = await open();
  bridge.updateScene.mockRejectedValueOnce({ code: 'AR_RESET', message: 'The tracking origin changed.' });
  r.emit(hit); r.ar.setScene?.([object('old-origin-chair', 4)], 'old-origin-chair'); await settle();
  expect(r.callbacks.onSceneReset).toHaveBeenCalledTimes(1);
  expect(sent()).toMatchObject({ objects: [], selectedId: null });
  expect(r.ar.getPlacementPose?.()).toBeNull();
  expect(bridge.end).not.toHaveBeenCalled();
});

it('reports an unrecoverable native update failure and restores the ordinary editor', async () => {
  const r = await open();
  bridge.updateScene.mockRejectedValueOnce({ code: 'INVALID_SCENE', message: 'This object could not be rendered.' });
  r.ar.setScene?.([object()]); await settle();
  expect(bridge.end).toHaveBeenCalledWith({ sessionId: r.sessionId });
  expect(r.listener.remove).toHaveBeenCalledTimes(1);
  expect(r.callbacks.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'ended', message: 'This object could not be rendered.' }));
  expect(document.documentElement.classList.contains('native-interior-ar')).toBe(false);
  expect(document.documentElement.classList.contains('ordinary-app')).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('ends on pagehide and on a native background event without leaving a transparent page', async () => {
  const first = await open();
  window.dispatchEvent(new Event('pagehide')); await settle();
  expect(first.listener.remove).toHaveBeenCalledTimes(1);
  expect(bridge.end).toHaveBeenCalledWith({ sessionId: first.sessionId });
  const second = await open();
  second.emit({ phase: 'ended', message: 'AR ended in the background.' });
  expect(second.listener.remove).toHaveBeenCalledTimes(1);
  expect(second.callbacks.onState).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'ended', message: 'AR ended in the background.' }));
  expect(document.documentElement.classList.contains('native-interior-ar')).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
