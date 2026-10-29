import type { XRFrameLike, XRHitTestSourceLike, XRLayerConstructor, XRLayerLike, XRMeshLike, XRPlaneLike, XRPoint, XRSpaceLike, XRSystemLike } from './xr-types';
import type { FurnitureItem, FurniturePlacement } from '../room/layout';
import { furnitureMeshes } from '../room/furnitureGeometry';
import type { SceneMesh } from '../room/furnitureGeometry';
import { inscribedPlaneRectangle, observedMeshBounds, planeRectangleToWorld, supportedObjectLabel } from './xr-plane';

export type WorldARPhase = 'searching' | 'measuring' | 'ready' | 'tracking-lost' | 'ended';
export interface WorldARState {
  phase: WorldARPhase;
  points: 0 | 1 | 2 | 3;
  canSelect: boolean;
  message: string;
  detectedSurface?: WorldARSurface;
  detectedSurfaces?: WorldARSurface[];
  detectedObjects?: WorldARObject[];
}
export interface WorldARSurface { label: string; width: number; length: number }
export interface WorldARObject extends WorldARSurface { height: number }
export interface WorldARMeasurement {
  width: number;
  length: number;
  corners: [XRPoint, XRPoint, XRPoint, XRPoint];
}
export interface WorldARFootprint { width: number; length: number; clearance: number; rotated?: boolean }
export interface WorldARRoomLayout { items: readonly FurnitureItem[]; placements: readonly FurniturePlacement[] }
export interface WorldARController {
  setFootprint(value: WorldARFootprint | null): void;
  setRoomLayout(value: WorldARRoomLayout | null): void;
  useDetectedSurface(): boolean;
  selectPoint(): boolean;
  reset(): void;
  end(): Promise<void>;
}
export interface WorldAROptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  signal?: AbortSignal;
  onState: (state: WorldARState) => void;
  onMeasurement: (measurement: WorldARMeasurement | null) => void;
}

const MAX_EXTENT = 50;
const MIN_EXTENT = .05;
const MAX_HEIGHT_DIFFERENCE = .06;
const finitePoint = (point: XRPoint) => [point.x, point.y, point.z].every(Number.isFinite);
const distance = (a: XRPoint, b: XRPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const system = () => (navigator as Navigator & { xr?: XRSystemLike }).xr;

export async function isWorldARSupported(): Promise<boolean> {
  if (!window.isSecureContext || !system()) return false;
  try { return await system()!.isSessionSupported('immersive-ar'); } catch { return false; }
}

/** A and B define the width edge; C selects the perpendicular opposite side.
 * Measurements are estimates of a user-bounded rectangle, not scene occupancy. */
export function rectangleFromPoints(a: XRPoint, b: XRPoint, c: XRPoint): WorldARMeasurement | null {
  if (![a, b, c].every(finitePoint)) return null;
  const heights = [a.y, b.y, c.y];
  if (Math.max(...heights) - Math.min(...heights) > MAX_HEIGHT_DIFFERENCE) return null;
  const width = distance(a, b);
  if (width < MIN_EXTENT || width > MAX_EXTENT) return null;
  const perpendicular = { x: -(b.z - a.z) / width, z: (b.x - a.x) / width };
  const signedLength = (c.x - a.x) * perpendicular.x + (c.z - a.z) * perpendicular.z;
  const length = Math.abs(signedLength);
  if (length < MIN_EXTENT || length > MAX_EXTENT) return null;
  const offset = { x: perpendicular.x * signedLength, z: perpendicular.z * signedLength };
  return {
    width, length,
    corners: [
      { ...a }, { x: b.x, y: a.y, z: b.z },
      { x: b.x + offset.x, y: a.y, z: b.z + offset.z },
      { x: a.x + offset.x, y: a.y, z: a.z + offset.z },
    ],
  };
}

type XRGL = WebGLRenderingContext & { makeXRCompatible(): Promise<void> };
type Color = [number, number, number, number];
const LIME: Color = [.835, .961, .502, 1];
const AMBER: Color = [1, .718, .36, 1];
const WHITE: Color = [.95, .98, .9, 1];

/** Convert room-local metre coordinates to the same world reference space as
 * the hit-test rectangle. Height remains vertical even if the floor axes turn. */
export function roomVerticesToWorld(vertices: readonly number[], measurement: WorldARMeasurement): Float32Array {
  if (vertices.length % 9 !== 0 || !vertices.every(Number.isFinite)) throw new Error('Furniture geometry must contain finite XYZ triangles.');
  const [a, b, , d] = measurement.corners;
  const u = { x: (b.x - a.x) / measurement.width, z: (b.z - a.z) / measurement.width };
  const v = { x: (d.x - a.x) / measurement.length, z: (d.z - a.z) / measurement.length };
  const result = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    result[i] = a.x + u.x * x + v.x * z;
    result[i + 1] = a.y + y;
    result[i + 2] = a.z + u.z * x + v.z * z;
  }
  return result;
}

interface WorldRoomMesh { vertices: Float32Array; color: Color; center: XRPoint }
function prepareRoomMeshes(value: WorldARRoomLayout): SceneMesh[] {
  const allowedKinds = new Set(['bed', 'desk', 'table', 'wardrobe', 'chair']);
  if (value.items.length > 32 || value.placements.length > value.items.length) throw new Error('The AR room supports up to 32 distinct furniture items.');
  const items = new Map<string, FurnitureItem>();
  for (const item of value.items) {
    if (typeof item.id !== 'string' || !item.id.trim() || items.has(item.id) || !allowedKinds.has(item.kind) ||
      ![item.width, item.depth, item.height].every(n => Number.isFinite(n) && n > 0 && n <= MAX_EXTENT) ||
      typeof item.color !== 'string' || !/^#[\da-f]{6}$/i.test(item.color)) {
      throw new Error('Furniture needs unique IDs, a supported kind, positive dimensions up to 50 m, and a six-digit color.');
    }
    items.set(item.id, { ...item });
  }
  const placed = new Set<string>();
  const meshes: SceneMesh[] = [];
  for (const source of value.placements) {
    const placement = { ...source }, item = items.get(placement.itemId);
    if (!item || placed.has(placement.itemId) || ![placement.x, placement.z].every(n => Number.isFinite(n) && n >= 0 && n <= MAX_EXTENT) || ![0, 90].includes(placement.rotation)) {
      throw new Error('Furniture placements need matching unique items, finite room coordinates, and a 0 or 90 degree rotation.');
    }
    placed.add(placement.itemId);
    for (const mesh of furnitureMeshes(item, placement)) {
      if (!mesh.vertices.length || mesh.vertices.length % 9 !== 0 || !mesh.vertices.every(Number.isFinite) || mesh.color.length !== 4 || !mesh.color.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
        throw new Error('This furniture model could not be rendered safely.');
      }
      meshes.push({ vertices: [...mesh.vertices], color: [...mesh.color] as Color });
    }
  }
  // Shaded primitive faces often share a color. Batch their opaque triangles
  // once, rather than issuing hundreds of tiny buffer uploads every XR frame.
  const batches = new Map<string, SceneMesh>();
  const translucent: SceneMesh[] = [];
  for (const mesh of meshes) {
    if (mesh.color[3] < .999) { translucent.push(mesh); continue; }
    const key = mesh.color.join(','), batch = batches.get(key);
    if (batch) batch.vertices.push(...mesh.vertices);
    else batches.set(key, mesh);
  }
  return [...batches.values(), ...translucent];
}

function anchorRoomMeshes(meshes: SceneMesh[], measurement: WorldARMeasurement): WorldRoomMesh[] {
  return meshes.map(mesh => {
    const vertices = roomVerticesToWorld(mesh.vertices, measurement);
    const center = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < vertices.length; i += 3) { center.x += vertices[i]; center.y += vertices[i + 1]; center.z += vertices[i + 2]; }
    const count = vertices.length / 3;
    center.x /= count; center.y /= count; center.z /= count;
    return { vertices, color: [...mesh.color] as Color, center };
  });
}

function renderer(gl: XRGL) {
  function compile(type: number, source: string) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('The AR graphics shader could not be created.');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader); throw new Error('This device could not compile the AR graphics.');
    }
    return shader;
  }
  const vertex = compile(gl.VERTEX_SHADER, 'attribute vec3 position; uniform mat4 projection; uniform mat4 view; void main(){gl_Position=projection*view*vec4(position,1.0);}');
  let fragment: WebGLShader;
  try { fragment = compile(gl.FRAGMENT_SHADER, 'precision mediump float; uniform vec4 tint; void main(){gl_FragColor=tint;}'); }
  catch (error) { gl.deleteShader(vertex); throw error; }
  const program = gl.createProgram();
  if (!program) { gl.deleteShader(vertex); gl.deleteShader(fragment); throw new Error('The AR renderer could not start.'); }
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw new Error('This device could not initialize AR graphics.'); }
  const buffer = gl.createBuffer();
  if (!buffer) { gl.deleteProgram(program); throw new Error('The AR graphics buffer could not be created.'); }
  const position = gl.getAttribLocation(program, 'position');
  const projection = gl.getUniformLocation(program, 'projection');
  const view = gl.getUniformLocation(program, 'view');
  const tint = gl.getUniformLocation(program, 'tint');
  return {
    prepare(projectionMatrix: Float32Array, viewMatrix: Float32Array) {
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(projection, false, projectionMatrix); gl.uniformMatrix4fv(view, false, viewMatrix);
    },
    draw(points: XRPoint[], color: Color, mode: number = gl.LINE_STRIP) {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points.flatMap(point => [point.x, point.y + .008, point.z])), gl.DYNAMIC_DRAW);
      gl.uniform4fv(tint, color); gl.drawArrays(mode, 0, points.length);
    },
    drawMesh(mesh: WorldRoomMesh) {
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.DYNAMIC_DRAW);
      gl.uniform4fv(tint, mesh.color); gl.drawArrays(gl.TRIANGLES, 0, mesh.vertices.length / 3);
    },
    dispose() { gl.deleteBuffer(buffer); gl.deleteProgram(program); },
  };
}

function ring(center: XRPoint, radius: number): XRPoint[] {
  return Array.from({ length: 33 }, (_, i) => ({ x: center.x + Math.cos(i * Math.PI / 16) * radius, y: center.y, z: center.z + Math.sin(i * Math.PI / 16) * radius }));
}
function centeredFootprint(measurement: WorldARMeasurement, width: number, length: number): XRPoint[] {
  const [a, b, , d] = measurement.corners;
  const u = { x: (b.x - a.x) / measurement.width, z: (b.z - a.z) / measurement.width };
  const v = { x: (d.x - a.x) / measurement.length, z: (d.z - a.z) / measurement.length };
  const left = (measurement.width - width) / 2, top = (measurement.length - length) / 2;
  return [[left, top], [left + width, top], [left + width, top + length], [left, top + length]].map(([x, z]) => ({ x: a.x + u.x * x + v.x * z, y: a.y + .006, z: a.z + u.z * x + v.z * z }));
}

/** Must be called directly from a user action so the native AR permission prompt
 * is tied to that action. No camera frames are sent to a server by this engine. */
export async function startWorldAR({ canvas, overlay, signal, onState, onMeasurement }: WorldAROptions): Promise<WorldARController> {
  if (signal?.aborted) throw new DOMException('The AR start was cancelled.', 'AbortError');
  const xr = system();
  if (!window.isSecureContext || !xr) throw new Error('World-tracked AR is unavailable here. Use an AR-capable browser over HTTPS.');
  const Layer = (window as Window & { XRWebGLLayer?: XRLayerConstructor }).XRWebGLLayer;
  if (!Layer) throw new Error('This browser does not provide the graphics needed for world-tracked AR.');
  // Request before any awaited feature check to retain the user's activation.
  const session = await xr.requestSession('immersive-ar', {
    requiredFeatures: ['local', 'hit-test', 'dom-overlay'], optionalFeatures: ['local-floor', 'plane-detection', 'mesh-detection'], domOverlay: { root: overlay },
  });
  let ended = false, handle = 0, watchdog = 0, lastFrameAt = performance.now(), lastHitAt = -Infinity, endMessage = 'AR session ended.';
  let reference: XRSpaceLike | null = null, source: XRHitTestSourceLike | null = null, gl: XRGL | null = null, layer: XRLayerLike | null = null;
  let graphics: ReturnType<typeof renderer> | null = null;
  let hit: XRPoint | null = null, points: XRPoint[] = [], measurement: WorldARMeasurement | null = null, footprint: WorldARFootprint | null = null;
  let roomMeshes: SceneMesh[] | null = null, worldRoomMeshes: WorldRoomMesh[] | null = null;
  type SurfaceTrack = { changedAt: number; local: WorldARMeasurement['corners'] | null; anchor: WorldARMeasurement | null; current: WorldARMeasurement | null; label: string; since: number; seen: number; frames: number };
  type ObjectTrack = { changedAt: number; bounds: WorldARObject; anchorBounds: WorldARObject; basis: number[]; anchor: XRPoint; since: number; seen: number; frames: number };
  const planeTracks = new Map<XRPlaneLike, SurfaceTrack>(), meshTracks = new Map<XRMeshLike, ObjectTrack>();
  let surfaces: SurfaceTrack[] = [], objects: ObjectTrack[] = [];
  let stateKey = '';
  function clearDetection() { planeTracks.clear(); meshTracks.clear(); surfaces = []; objects = []; }
  const rounded = (value: number) => Math.round(value * 100) / 100;
  function publish(phase: WorldARPhase, message: string, canSelect = !!hit && points.length < 3) {
    const state: WorldARState = { phase, points: points.length as WorldARState['points'], canSelect, message };
    if (!ended && phase !== 'tracking-lost') {
      if (!points.length && surfaces.length) {
        state.detectedSurfaces = surfaces.map(surface => ({ label: surface.label, width: rounded(surface.current!.width), length: rounded(surface.current!.length) }));
        state.detectedSurface = state.detectedSurfaces[0];
      }
      if (objects.length) state.detectedObjects = objects.map(object => ({ label: object.bounds!.label, width: rounded(object.bounds!.width), length: rounded(object.bounds!.length), height: rounded(object.bounds!.height) }));
    }
    const key = JSON.stringify(state);
    if (key !== stateKey) { stateKey = key; onState(state); }
  }
  function clearMeasurement() { hit = null; lastHitAt = -Infinity; points = []; measurement = null; roomMeshes = null; worldRoomMeshes = null; clearDetection(); onMeasurement(null); }
  function cleanup() {
    if (ended) return;
    ended = true; hit = null; clearDetection();
    session.cancelAnimationFrame(handle); window.clearInterval(watchdog); source?.cancel(); source = null;
    session.removeEventListener('end', cleanup); session.removeEventListener('visibilitychange', visibilityChanged);
    reference?.removeEventListener('reset', originChanged); canvas.removeEventListener('webglcontextlost', graphicsLost);
    overlay.removeEventListener('beforexrselect', preventUISelection);
    signal?.removeEventListener('abort', cancelStart);
    document.removeEventListener('visibilitychange', documentVisibilityChanged);
    window.removeEventListener('pagehide', cancelStart);
    graphics?.dispose(); graphics = null; roomMeshes = null; worldRoomMeshes = null; onMeasurement(null);
    publish('ended', endMessage, false);
  }
  function originChanged() { clearMeasurement(); publish('searching', 'Tracking origin changed. Measure the space again.', false); }
  function visibilityChanged() {
    if (session.visibilityState !== 'visible') { hit = null; clearDetection(); publish('tracking-lost', 'AR is paused. Return to the camera to continue.', false); }
  }
  async function stopSession(message = 'AR session ended.') {
    if (ended) return;
    endMessage = message;
    const stopping = session.end();
    // Invalidate measurements and frames immediately; native session shutdown
    // can complete later, and must not leave a positive fit visible meanwhile.
    cleanup();
    try { await stopping; } catch { /* Already-ended runtimes can reject end(). */ }
  }
  function graphicsLost(event: Event) { event.preventDefault(); void stopSession('AR graphics were interrupted. Restart AR to measure again.'); }
  function cancelStart() { void stopSession('AR session stopped.'); }
  function documentVisibilityChanged() { if (document.hidden) cancelStart(); }
  function preventUISelection(event: Event) { if (event.target instanceof Element && event.target.closest('button,input,select,textarea,a,label,[role="button"]')) event.preventDefault(); }
  session.addEventListener('end', cleanup); session.addEventListener('visibilitychange', visibilityChanged);
  canvas.addEventListener('webglcontextlost', graphicsLost); overlay.addEventListener('beforexrselect', preventUISelection);
  signal?.addEventListener('abort', cancelStart, { once: true });
  document.addEventListener('visibilitychange', documentVisibilityChanged); window.addEventListener('pagehide', cancelStart);
  try {
    if (signal?.aborted || document.hidden) { cancelStart(); throw new DOMException('The AR start was cancelled.', 'AbortError'); }
    if (!session.domOverlayState) throw new Error('This browser cannot show the measurement controls inside AR.');
    const attributes: WebGLContextAttributes & { xrCompatible: boolean } = { xrCompatible: true, alpha: true, antialias: true, preserveDrawingBuffer: false };
    gl = canvas.getContext('webgl', attributes) as XRGL | null;
    if (!gl) throw new Error('Your browser could not create an AR graphics context.');
    await gl.makeXRCompatible();
    if (ended) throw new Error('The AR session ended before it was ready.');
    layer = new Layer(session, gl, { alpha: true }); session.updateRenderState({ baseLayer: layer });
    graphics = renderer(gl);
    try { reference = await session.requestReferenceSpace('local-floor'); } catch { reference = await session.requestReferenceSpace('local'); }
    if (ended) throw new Error('The AR session ended before it was ready.');
    reference.addEventListener('reset', originChanged);
    const viewer = await session.requestReferenceSpace('viewer');
    source = await session.requestHitTestSource({ space: viewer, entityTypes: ['plane'] });
    if (ended) { source.cancel(); throw new Error('The AR session ended before it was ready.'); }
    gl.clearColor(0, 0, 0, 0); gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearDepth(1); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.lineWidth(2);
  } catch (error) {
    await stopSession(); throw error;
  }

  function updateDetection(xrFrame: XRFrameLike, now: number) {
    if (!xrFrame.getPose || !reference) { clearDetection(); return; }
    const seenPlanes = new Set<XRPlaneLike>();
    let planeCount = 0;
    // Cache polygon work by the native geometry revision, while refreshing poses
    // every frame. A missing/changed tracking pose never leaves a usable estimate.
    for (const plane of xrFrame.detectedPlanes ?? []) {
      if (planeCount++ >= 24) break;
      if (plane.orientation !== 'horizontal' || !Number.isFinite(plane.lastChangedTime)) continue;
      const label = plane.semanticLabel?.trim().toLowerCase();
      // A horizontal pose alone cannot make a labelled ceiling/wall a usable
      // furniture support surface, even when no floor has been detected yet.
      if (label === 'ceiling' || label === 'wall') continue;
      const pose = xrFrame.getPose(plane.planeSpace, reference);
      if (!pose || pose.emulatedPosition) continue;
      let track = planeTracks.get(plane);
      const safeLabel = ['floor', 'table', 'desk', 'shelf'].includes(label ?? '') ? label! : 'surface';
      if (!track) {
        track = { changedAt: plane.lastChangedTime, local: inscribedPlaneRectangle(plane.polygon), anchor: null, current: null, label: safeLabel, since: now, seen: now, frames: 0 };
        planeTracks.set(plane, track);
      } else if (track.changedAt !== plane.lastChangedTime) {
        track.local = inscribedPlaneRectangle(plane.polygon); track.changedAt = plane.lastChangedTime;
      }
      const next = track.local && planeRectangleToWorld(track.local, pose.transform);
      if (!next) { planeTracks.delete(plane); continue; }
      seenPlanes.add(plane);
      const stable = track.anchor && track.label === safeLabel && next.corners.every((point, index) => {
        const previous = track!.anchor!.corners[index];
        return Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) <= .04;
      });
      if (!stable) { track.anchor = next; track.since = now; track.frames = 0; }
      track.current = next; track.label = safeLabel; track.seen = now; track.frames++;
    }
    for (const plane of planeTracks.keys()) if (!seenPlanes.has(plane)) planeTracks.delete(plane);
    surfaces = [...planeTracks.values()].filter(track => track.frames >= 3 && now - track.since >= 500 && now - track.seen <= 300)
      .sort((a, b) => Number(b.label === 'floor') - Number(a.label === 'floor') || b.current!.width * b.current!.length - a.current!.width * a.current!.length).slice(0, 3);

    const seenMeshes = new Set<XRMeshLike>();
    let meshCount = 0, vertexBudget = 20000;
    for (const mesh of xrFrame.detectedMeshes ?? []) {
      if (!supportedObjectLabel(mesh.semanticLabel)) continue;
      if (meshCount++ >= 12) break;
      if (!Number.isFinite(mesh.lastChangedTime)) continue;
      const pose = xrFrame.getPose(mesh.meshSpace, reference);
      if (!pose || pose.emulatedPosition || !finitePoint(pose.transform.position)) continue;
      if (pose.transform.matrix.length !== 16 || !Array.from(pose.transform.matrix).every(Number.isFinite) || Math.abs(pose.transform.matrix[5]) < .995) continue;
      const basis = Array.from(pose.transform.matrix.slice(0, 12));
      let track = meshTracks.get(mesh);
      const changed = !track || track.changedAt !== mesh.lastChangedTime || basis.some((value, index) => Math.abs(value - track!.basis[index]) > .002) || track.bounds?.label !== mesh.semanticLabel?.trim().toLowerCase();
      if (changed) {
        const vertexCount = mesh.vertices.length / 3;
        if (vertexCount > vertexBudget) continue;
        vertexBudget -= vertexCount;
      }
      const bounds = changed ? observedMeshBounds(mesh.vertices, mesh.semanticLabel, pose.transform) : track!.bounds;
      if (!bounds) { meshTracks.delete(mesh); continue; }
      seenMeshes.add(mesh);
      const position = pose.transform.position;
      const stable = track && track.anchorBounds.label === bounds.label && (['width', 'length', 'height'] as const).every(key => Math.abs(bounds[key] - track!.anchorBounds[key]) <= .025) && Math.hypot(position.x - track.anchor.x, position.y - track.anchor.y, position.z - track.anchor.z) <= .04;
      if (!track || !stable) {
        track = { changedAt: mesh.lastChangedTime, bounds, anchorBounds: bounds, basis, anchor: { ...position }, since: now, seen: now, frames: 0 };
        meshTracks.set(mesh, track);
      }
      track.changedAt = mesh.lastChangedTime; track.bounds = bounds; if (changed) track.basis = basis; track.seen = now; track.frames++;
    }
    for (const mesh of meshTracks.keys()) if (!seenMeshes.has(mesh)) meshTracks.delete(mesh);
    objects = [...meshTracks.values()].filter(track => track.frames >= 3 && now - track.since >= 500 && now - track.seen <= 300)
      .sort((a, b) => b.bounds!.width * b.bounds!.length * b.bounds!.height - a.bounds!.width * a.bounds!.length * a.bounds!.height).slice(0, 3);
  }

  function frame(time: number, xrFrame: XRFrameLike) {
    if (ended || !gl || !graphics || !reference || !source || !layer) return;
    try {
      lastFrameAt = performance.now();
      handle = session.requestAnimationFrame(frame);
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const pose = xrFrame.getViewerPose(reference);
      if (!pose || !pose.views.length || pose.emulatedPosition || session.visibilityState !== 'visible') {
        hit = null; clearDetection(); publish('tracking-lost', 'Tracking paused. Move slowly and point back at the measured surface.', false); return;
      }
      updateDetection(xrFrame, lastFrameAt);
      hit = null;
      for (const result of xrFrame.getHitTestResults(source)) {
        const candidate = result.getPose(reference);
        if (!candidate || candidate.emulatedPosition) continue;
        const matrix = candidate.transform.matrix;
        const point = candidate.transform.position;
        // A hit on a wall cannot provide the horizontal footprint being measured.
        if (!finitePoint(point) || !Number.isFinite(matrix[5]) || Math.abs(matrix[5]) < .94) continue;
        if (points.length && Math.abs(point.y - points[0].y) > MAX_HEIGHT_DIFFERENCE) continue;
        hit = { x: point.x, y: point.y, z: point.z }; lastHitAt = time; break;
      }
      if (measurement) publish('ready', 'Measured rectangle stays anchored as you move.', false);
      else if (!points.length && surfaces.length) publish('measuring', 'A stable visible surface area is ready. Confirm it or mark your own corners.', !!hit);
      else if (!hit) publish('searching', 'Move slowly over a textured, level surface to find a plane.', false);
      else publish('measuring', ['Aim at the first corner and mark it.', 'Aim along the width edge and mark its end.', 'Aim at the opposite side to set the length.'][points.length]);

      for (const view of pose.views) {
        const viewport = layer.getViewport(view); if (!viewport) continue;
        gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
        gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
        graphics.prepare(view.projectionMatrix, view.transform.inverse.matrix);
        if (hit && points.length < 3) graphics.draw(ring(hit, .06), LIME);
        points.forEach(point => graphics!.draw(ring(point, .025), WHITE));
        if (points.length && !measurement) graphics.draw([...points, ...(hit ? [hit] : [])], WHITE);
        if (!points.length && surfaces[0]?.current) {
          const corners = surfaces[0].current.corners;
          graphics.draw(corners, [.835, .961, .502, .08], gl.TRIANGLE_FAN);
          graphics.draw([...corners, corners[0]], LIME);
        }
        if (measurement) {
          const corners = measurement.corners;
          graphics.draw(corners, [.835, .961, .502, .09], gl.TRIANGLE_FAN);
          graphics.draw([...corners, corners[0]], WHITE);
          if (footprint) {
            // Orientation is selected by the fit assessment, never changed silently
            // by the renderer. Callers may also pass already-oriented dimensions.
            const rotate = footprint.rotated ?? false;
            const width = rotate ? footprint.length : footprint.width, length = rotate ? footprint.width : footprint.length;
            const fits = width + 2 * footprint.clearance <= measurement.width && length + 2 * footprint.clearance <= measurement.length;
            const shape = centeredFootprint(measurement, width, length), margin = centeredFootprint(measurement, width + 2 * footprint.clearance, length + 2 * footprint.clearance);
            const color = fits ? LIME : AMBER;
            graphics.draw(shape, [color[0], color[1], color[2], .18], gl.TRIANGLE_FAN);
            graphics.draw([...shape, shape[0]], color);
            graphics.draw([...margin, margin[0]], [color[0], color[1], color[2], .5]);
          }
          if (roomMeshes) {
            worldRoomMeshes ??= anchorRoomMeshes(roomMeshes, measurement);
            gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
            for (const mesh of worldRoomMeshes) if (mesh.color[3] >= .999) graphics.drawMesh(mesh);
            // Sort translucent components per eye; solid furniture parts retain
            // their depth, so a wardrobe correctly hides furniture behind it.
            const eye = view.transform.position;
            const squaredDistance = (point: XRPoint) => (point.x - eye.x) ** 2 + (point.y - eye.y) ** 2 + (point.z - eye.z) ** 2;
            const transparent = worldRoomMeshes.filter(mesh => mesh.color[3] < .999).sort((a, b) => squaredDistance(b.center) - squaredDistance(a.center));
            gl.depthMask(false);
            for (const mesh of transparent) graphics.drawMesh(mesh);
            gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
          }
        }
      }
    } catch {
      hit = null;
      void stopSession('AR tracking was interrupted. Restart AR to measure again.');
    }
  }

  publish('searching', 'Move slowly over a textured, level surface to find a plane.', false);
  try {
    handle = session.requestAnimationFrame(frame);
    watchdog = window.setInterval(() => {
      const elapsed = performance.now() - lastFrameAt;
      if (!ended && (elapsed > 1500 || ((surfaces.length || objects.length) && elapsed > 300))) {
        hit = null; clearDetection();
        publish('tracking-lost', 'No recent tracking update. Wait for the camera to recover.', false);
      }
    }, 500);
  } catch (error) { await stopSession(); throw error; }
  return {
    setFootprint(value) {
      if (value && (![value.width, value.length, value.clearance].every(Number.isFinite) || value.width <= 0 || value.length <= 0 || value.clearance < 0 || Math.max(value.width, value.length, value.clearance) > MAX_EXTENT)) throw new Error('Enter finite dimensions up to 50 meters and a non-negative clearance up to 50 meters.');
      footprint = value ? { ...value } : null;
      if (value) { roomMeshes = null; worldRoomMeshes = null; }
    },
    setRoomLayout(value) {
      const next = value ? prepareRoomMeshes(value) : null;
      roomMeshes = next; worldRoomMeshes = null;
      if (value) footprint = null;
    },
    useDetectedSurface() {
      const candidate = surfaces[0];
      if (ended || measurement || points.length || !candidate?.current || performance.now() - candidate.seen > 300 || session.visibilityState !== 'visible') return false;
      const current = candidate.current;
      measurement = { width: current.width, length: current.length, corners: current.corners.map(point => ({ ...point })) as WorldARMeasurement['corners'] };
      points = [measurement.corners[0], measurement.corners[1], measurement.corners[3]].map(point => ({ ...point }));
      hit = null; worldRoomMeshes = null;
      onMeasurement({ ...measurement, corners: measurement.corners.map(point => ({ ...point })) as WorldARMeasurement['corners'] });
      publish('ready', 'Detected visible surface area stays anchored as you move.', false);
      return true;
    },
    selectPoint() {
      if (ended || !hit || points.length >= 3 || performance.now() - lastHitAt > 300 || session.visibilityState !== 'visible') return false;
      if (points.length === 1 && (distance(points[0], hit) < MIN_EXTENT || distance(points[0], hit) > MAX_EXTENT)) { publish('measuring', 'Choose a width edge between 5 cm and 50 m.', true); return false; }
      if (points.length === 2) {
        const next = rectangleFromPoints(points[0], points[1], hit);
        if (!next) { publish('measuring', 'Mark a different point on the same level surface, away from the width edge.', true); return false; }
        points.push({ ...hit }); measurement = next; onMeasurement(next);
        publish('ready', 'Measured rectangle stays anchored as you move.', false); return true;
      }
      points.push({ ...hit }); hit = null;
      publish('searching', points.length === 1 ? 'First corner set. Aim at the end of the width edge.' : 'Width set. Aim at the opposite side.', false); return true;
    },
    reset() { if (ended) return; clearMeasurement(); publish('searching', 'Move slowly over a textured, level surface to find a plane.', false); },
    async end() { await stopSession(); },
  };
}
