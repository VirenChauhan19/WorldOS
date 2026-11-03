import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { furnitureMeshes } from '../room/furnitureGeometry';
import type { FurnitureItem } from '../room/layout';
import type { WorldARController, WorldAROptions, WorldARPlacementPose, WorldARSceneObject, WorldARState } from '../live/xr';

export interface NativeARCapabilities {
  supported: boolean;
  cameraPermission?: 'granted' | 'prompt' | 'denied' | 'restricted';
  reason?: string;
}
export interface NativeARModel {
  item: FurnitureItem;
  meshes: { vertices: number[]; color: number[] }[];
}
type NativeObject = WorldARSceneObject & { meshes: NativeARModel['meshes'] };
interface NativeState extends Partial<WorldARState> {
  sessionId: string;
  pose?: WorldARPlacementPose;
  reset?: boolean;
}
interface NativeSceneUpdate {
  sessionId: string;
  objects: NativeObject[];
  selectedId: string | null;
  preview: NativeARModel | null;
  previewRotation: number;
}
interface InteriorARPlugin {
  getCapabilities(): Promise<NativeARCapabilities>;
  start(options: { sessionId: string }): Promise<void>;
  updateScene(options: NativeSceneUpdate): Promise<void>;
  select(options: { sessionId: string; x: number; y: number }): Promise<{ id: string | null }>;
  end(options: { sessionId: string }): Promise<void>;
  addListener(event: 'state', listener: (state: NativeState) => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<InteriorARPlugin>('InteriorAR');
export interface NativeARController extends WorldARController {
  selectAt(x: number, y: number): Promise<void>;
}

/** Discovery never requests camera access and never treats mobile Safari as a native app. */
export async function nativeARCapabilities(): Promise<NativeARCapabilities> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios' || !Capacitor.isPluginAvailable('InteriorAR')) return { supported: false };
  try { return await native.getCapabilities(); }
  catch { return { supported: false, reason: 'The iPhone AR editor could not be reached. Reopen the installed app.' }; }
}

/** Same models as the studio, with local coordinates centered at each object's base. */
export function nativeModel(item: FurnitureItem): NativeARModel {
  const groups = new Map<string, NativeARModel['meshes'][number]>();
  for (const mesh of furnitureMeshes(item, { itemId: item.id, x: 0, z: 0, rotation: 0 })) {
    const key = mesh.color.join(','), existing = groups.get(key);
    const vertices = mesh.vertices.map((value, index) => value - (index % 3 === 0 ? item.width / 2 : index % 3 === 2 ? item.depth / 2 : 0));
    if (existing) existing.vertices.push(...vertices);
    else groups.set(key, { vertices, color: [...mesh.color] });
  }
  return { item: { ...item }, meshes: [...groups.values()] };
}

const isPose = (value: WorldARPlacementPose | undefined): value is WorldARPlacementPose => !!value?.position
  && [value.position.x, value.position.y, value.position.z, value.rotation].every(Number.isFinite)
  && [value.position.x, value.position.y, value.position.z].every(n => Math.abs(n) <= 50);
const message = (error: unknown) => error instanceof Error ? error.message : typeof (error as { message?: unknown })?.message === 'string' ? (error as { message: string }).message : 'The iPhone AR editor could not update. Please reopen it.';

/** Native camera/RealityKit underlay, with the existing studio controls in the WebView.
 * Only ephemeral world positions cross this bridge; normal scene saving stays in scene.ts. */
export async function startNativeInteriorAR(options: WorldAROptions): Promise<NativeARController> {
  const { signal, onState, onPlace, onObjectSelect, onSceneReset } = options;
  if (signal?.aborted) throw new DOMException('AR start cancelled.', 'AbortError');
  const sessionId = crypto.randomUUID();
  let ended = false, started = false, listener: PluginListenerHandle | undefined;
  let objects: WorldARSceneObject[] = [], selectedId: string | null = null, preview: FurnitureItem | null = null, previewRotation = 0;
  let pose: WorldARPlacementPose | null = null, receivedAt = 0, phase: WorldARState['phase'] = 'searching', stateKey = '';
  let scheduled = false, inFlight = false, changed = false, retryTracking = false, needsReset = true, resetVersion = 0, selectionRequest = 0;
  const models = new Map<string, { key: string; value: NativeARModel }>();
  const cssRoot = document.documentElement;
  function model(item: FurnitureItem) {
    const key = JSON.stringify(item), cached = models.get(item.id);
    if (cached?.key === key) return cached.value;
    const value = nativeModel(item); models.set(item.id, { key, value }); return value;
  }
  function publish(next: WorldARState) {
    const key = JSON.stringify(next);
    if (key !== stateKey) { stateKey = key; onState(next); }
  }
  function currentPose() {
    if (ended || !pose || phase === 'tracking-lost' || Date.now() - receivedAt > 350) return null;
    return { position: { ...pose.position }, rotation: previewRotation };
  }
  function release() {
    if (ended) return;
    ended = true; started = false; selectionRequest++; pose = null; objects = []; preview = null; models.clear();
    window.clearInterval(watchdog);
    cssRoot.classList.remove('native-interior-ar');
    signal?.removeEventListener('abort', cancel);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', cancel);
    const handle = listener; listener = undefined; void handle?.remove().catch(() => {});
  }
  async function end() {
    if (ended) return;
    release();
    publish({ phase: 'ended', points: 0, canSelect: false, message: 'AR session ended. Your design remains in the studio.' });
    await native.end({ sessionId }).catch(() => {});
  }
  function cancel() { void end(); }
  function visibility() { if (document.hidden) cancel(); }
  function queue() {
    changed = true;
    if (!started || ended || scheduled || inFlight || retryTracking) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; void send(); });
  }
  async function send() {
    if (ended || !started || inFlight || !changed || retryTracking) return;
    inFlight = true; changed = false;
    const acknowledging = needsReset, generation = resetVersion;
    const snapshot = acknowledging ? [] : objects;
    try {
      const payload: NativeSceneUpdate = {
        sessionId, objects: snapshot.map(object => ({ ...object, item: { ...object.item }, position: { ...object.position }, meshes: model(object.item).meshes })),
        selectedId: acknowledging ? null : selectedId, preview: preview ? model(preview) : null, previewRotation,
      };
      await native.updateScene(payload);
      if (ended || generation !== resetVersion) return;
      if (acknowledging) { needsReset = false; if (objects.length) changed = true; }
    } catch (error) {
      if (ended || generation !== resetVersion) return;
      const code = (error as { code?: string })?.code;
      if (code === 'AR_TRACKING') { changed = true; retryTracking = true; }
      else if (code === 'AR_RESET') { resetVersion++; needsReset = true; objects = []; selectedId = null; pose = null; changed = true; onSceneReset?.(); }
      else { await end(); publish({ phase: 'ended', points: 0, canSelect: false, message: message(error) }); }
    } finally {
      inFlight = false;
      if (changed && !retryTracking && !ended) queue();
    }
  }
  function state(value: NativeState) {
    if (ended || value.sessionId !== sessionId) return;
    const nextPhase = value.phase;
    if (!nextPhase || !['searching', 'ready', 'tracking-lost', 'ended'].includes(nextPhase)) return;
    phase = nextPhase; receivedAt = Date.now();
    if (nextPhase === 'ended') { release(); publish({ phase: 'ended', points: 0, canSelect: false, message: value.message || 'AR session ended.' }); return; }
    pose = value.canSelect && isPose(value.pose) && nextPhase !== 'tracking-lost' ? value.pose : null;
    if (value.reset) {
      resetVersion++; needsReset = true; objects = []; selectedId = null; preview = null; pose = null; retryTracking = false; selectionRequest++;
      onSceneReset?.(); queue();
    }
    if (retryTracking && nextPhase !== 'tracking-lost') { retryTracking = false; queue(); }
    publish({ phase: nextPhase, points: 0, canSelect: !!currentPose(), message: value.message || 'Move your phone slowly to find a floor or tabletop.' });
  }
  const watchdog = window.setInterval(() => {
    if (started && !ended && receivedAt && Date.now() - receivedAt > 500) {
      pose = null; phase = 'tracking-lost';
      publish({ phase: 'tracking-lost', points: 0, canSelect: false, message: 'Tracking paused. Look back at the surface.' });
    }
  }, 200);
  signal?.addEventListener('abort', cancel, { once: true });
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', cancel);
  try {
    const handle = await native.addListener('state', state);
    if (ended || signal?.aborted) { await handle.remove(); throw new DOMException('AR start cancelled.', 'AbortError'); }
    listener = handle;
    await native.start({ sessionId });
    if (ended || signal?.aborted) { await native.end({ sessionId }).catch(() => {}); throw new DOMException('AR start cancelled.', 'AbortError'); }
    started = true; cssRoot.classList.add('native-interior-ar');
    changed = true; await send();
    if (ended) throw new Error('The iPhone AR session ended before it was ready.');
  } catch (error) { if (!ended) { release(); await native.end({ sessionId }).catch(() => {}); } throw error; }
  return {
    setFootprint: () => {}, setRoomLayout: () => {}, useDetectedSurface: () => false,
    selectPoint() { const value = currentPose(); if (!preview || !value) return false; onPlace?.(value); return true; },
    reset() { resetVersion++; objects = []; selectedId = null; preview = null; needsReset = true; retryTracking = false; selectionRequest++; onSceneReset?.(); queue(); },
    end,
    setScene(value, selection = null) {
      if (ended) return;
      objects = value.map(object => ({ ...object, item: { ...object.item }, position: { ...object.position } })); selectedId = selection;
      const keep = new Set(objects.map(o => o.item.id)); if (preview) keep.add(preview.id);
      for (const id of models.keys()) if (!keep.has(id)) models.delete(id);
      queue();
    },
    setPlacementPreview(item, rotation = 0) { if (ended) return; selectionRequest++; preview = item ? { ...item } : null; previewRotation = rotation; queue(); },
    getPlacementPose: currentPose,
    async selectAt(x, y) {
      if (ended || !started || phase === 'tracking-lost' || Date.now() - receivedAt > 350 || ![x, y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return;
      if (preview) { const value = currentPose(); if (value) onPlace?.(value); return; }
      const request = ++selectionRequest;
      try { const result = await native.select({ sessionId, x, y }); if (!ended && request === selectionRequest) onObjectSelect?.(objects.some(o => o.id === result.id) ? result.id : null); }
      catch { /* A tracking interruption invalidates this tap. */ }
    },
  };
}
