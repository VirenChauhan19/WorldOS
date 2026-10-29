// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isWorldARSupported, rectangleFromPoints, roomVerticesToWorld, startWorldAR } from './xr';
import { inscribedPlaneRectangle, observedMeshBounds, planeRectangleToWorld } from './xr-plane';
import type { WorldARMeasurement, WorldARState } from './xr';
import type { XRFrameLike, XRMeshLike, XRPlaneLike, XRPoint } from './xr-types';

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const transform = (position: XRPoint, matrix = identity) => ({ position, matrix, inverse: { matrix: identity } });
const polygon = (width = 4, length = 3): XRPoint[] => [{ x: 0, y: 0, z: 0 }, { x: width, y: 0, z: 0 }, { x: width, y: 0, z: length }, { x: 0, y: 0, z: length }];
const nativePlane = (label?: string): XRPlaneLike => ({ planeSpace: new EventTarget(), polygon: polygon(), orientation: 'horizontal', semanticLabel: label, lastChangedTime: 0 });
const boxVertices = (width = 2, height = .8, depth = 1) => new Float32Array([0, 0, 0, width, 0, 0, width, 0, depth, 0, 0, depth, 0, height, 0, width, height, 0, width, height, depth, 0, height, depth]);
const nativeMesh = (label = 'desk'): XRMeshLike => ({ meshSpace: new EventTarget(), vertices: boxVertices(), semanticLabel: label, lastChangedTime: 0 });
function detectedFrame(planes: XRPlaneLike[] = [], meshes: XRMeshLike[] = [], matrix = identity): XRFrameLike {
  return {
    getViewerPose: () => ({ views: [{ projectionMatrix: identity, transform: transform({ x: 0, y: 1.6, z: 0 }) }] }),
    getHitTestResults: () => [], detectedPlanes: new Set(planes), detectedMeshes: new Set(meshes),
    getPose: () => ({ transform: transform({ x: matrix[12], y: matrix[13], z: matrix[14] }, matrix) }),
  };
}

function runtime({ domOverlay = true, fallback = false, shaderFailure = false } = {}) {
  let callback: (time: number, frame: XRFrameLike) => void = () => {};
  const reference = new EventTarget(), viewer = new EventTarget();
  const source = { cancel: vi.fn() };
  const session = Object.assign(new EventTarget(), {
    visibilityState: 'visible', domOverlayState: domOverlay ? { type: 'screen' } : undefined,
    requestReferenceSpace: vi.fn(async (type: string) => { if (fallback && type === 'local-floor') throw new Error('Unsupported'); return type === 'viewer' ? viewer : reference; }),
    requestHitTestSource: vi.fn(async () => source), updateRenderState: vi.fn(),
    requestAnimationFrame: vi.fn((next: typeof callback) => { callback = next; return 7; }),
    cancelAnimationFrame: vi.fn(), end: vi.fn(async () => { session.dispatchEvent(new Event('end')); }),
  });
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5,
    FLOAT: 6, DYNAMIC_DRAW: 7, LINE_STRIP: 8, TRIANGLE_FAN: 9, BLEND: 10, SRC_ALPHA: 11,
    ONE_MINUS_SRC_ALPHA: 12, DEPTH_TEST: 13, FRAMEBUFFER: 14, COLOR_BUFFER_BIT: 16, DEPTH_BUFFER_BIT: 32, ONE: 1,
    TRIANGLES: 33, LEQUAL: 34, CULL_FACE: 35,
    makeXRCompatible: vi.fn(async () => {}), createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => !shaderFailure), deleteShader: vi.fn(), createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(), linkProgram: vi.fn(), getProgramParameter: vi.fn(() => true), deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})), deleteBuffer: vi.fn(), getAttribLocation: vi.fn(() => 0), getUniformLocation: vi.fn(() => ({})),
    useProgram: vi.fn(), bindBuffer: vi.fn(), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    uniformMatrix4fv: vi.fn(), uniform4fv: vi.fn(), bufferData: vi.fn(), drawArrays: vi.fn(), clearColor: vi.fn(),
    enable: vi.fn(), blendFuncSeparate: vi.fn(), disable: vi.fn(), lineWidth: vi.fn(), bindFramebuffer: vi.fn(), clear: vi.fn(), viewport: vi.fn(),
    clearDepth: vi.fn(), depthFunc: vi.fn(), depthMask: vi.fn(),
  };
  const layer = { framebuffer: {}, getViewport: vi.fn(() => ({ x: 0, y: 0, width: 640, height: 480 })) };
  const xr = { isSessionSupported: vi.fn(async () => true), requestSession: vi.fn(async () => session) };
  Object.defineProperty(navigator, 'xr', { configurable: true, value: xr });
  vi.stubGlobal('XRWebGLLayer', class { framebuffer = layer.framebuffer; getViewport = layer.getViewport; });
  const canvas = document.createElement('canvas'), overlay = document.createElement('div');
  vi.spyOn(canvas, 'getContext').mockReturnValue(gl as unknown as WebGLRenderingContext);
  const states: WorldARState[] = [], measurements: (WorldARMeasurement | null)[] = [];
  function tick(point: XRPoint | null, { tracked = true, horizontal = true, emulated = false } = {}) {
    const matrix = new Float32Array(identity); if (!horizontal) matrix[5] = 0;
    callback(performance.now(), {
      getViewerPose: () => tracked ? { views: [{ projectionMatrix: identity, transform: transform({ x: 0, y: 1.6, z: 0 }) }], emulatedPosition: emulated } : null,
      getHitTestResults: () => point ? [{ getPose: () => ({ transform: transform(point, matrix) }) }] : [],
    });
  }
  return { xr, session, gl, layer, source, reference, tick, states, measurements, tickFrame: (frame: XRFrameLike) => callback(performance.now(), frame),
    options: { canvas, overlay, onState: (state: WorldARState) => states.push(state), onMeasurement: (measurement: WorldARMeasurement | null) => measurements.push(measurement) },
  };
}

beforeEach(() => { vi.stubGlobal('isSecureContext', true); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'xr'); });

it('measures a rectangle in world meters using perpendicular depth, independent of camera orientation', () => {
  const measured = rectangleFromPoints({ x: 2, y: .8, z: 3 }, { x: 2, y: .81, z: 6 }, { x: -2, y: .8, z: 5 });
  expect(measured?.width).toBe(3);
  expect(measured?.length).toBe(4);
  expect(measured?.corners).toEqual([{ x: 2, y: .8, z: 3 }, { x: 2, y: .8, z: 6 }, { x: -2, y: .8, z: 6 }, { x: -2, y: .8, z: 3 }]);
});

it('rejects collinear, non-level, non-finite, and implausibly large selections', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 1, y: 0, z: 0 };
  expect(rectangleFromPoints(a, b, { x: .5, y: 0, z: .01 })).toBeNull();
  expect(rectangleFromPoints(a, b, { x: 0, y: .2, z: 1 })).toBeNull();
  expect(rectangleFromPoints(a, b, { x: NaN, y: 0, z: 1 })).toBeNull();
  expect(rectangleFromPoints(a, { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeNull();
});

it('detects native AR support without requesting a session or camera access', async () => {
  const r = runtime();
  expect(await isWorldARSupported()).toBe(true);
  expect(r.xr.requestSession).not.toHaveBeenCalled();
  vi.stubGlobal('isSecureContext', false);
  expect(await isWorldARSupported()).toBe(false);
});

it('uses native plane hits and view matrices, rejects walls, and releases session resources', async () => {
  const r = runtime({ fallback: true });
  const ar = await startWorldAR(r.options);
  expect(r.xr.requestSession).toHaveBeenCalledWith('immersive-ar', expect.objectContaining({ requiredFeatures: ['local', 'hit-test', 'dom-overlay'] }));
  expect(r.session.requestReferenceSpace).toHaveBeenCalledWith('local');
  r.tick({ x: 0, y: 0, z: 0 }, { horizontal: false });
  expect(ar.selectPoint()).toBe(false);
  r.tick({ x: 0, y: 0, z: 0 }); expect(ar.selectPoint()).toBe(true);
  r.tick({ x: 3, y: 0, z: 0 }); expect(ar.selectPoint()).toBe(true);
  r.tick({ x: 2, y: 0, z: 4 }); expect(ar.selectPoint()).toBe(true);
  expect(r.measurements.at(-1)).toMatchObject({ width: 3, length: 4 });
  ar.setFootprint({ width: 2, length: 3, clearance: .1 });
  r.tick(null);
  expect(r.gl.uniformMatrix4fv).toHaveBeenCalledWith(expect.anything(), false, identity);
  expect(r.gl.drawArrays).toHaveBeenCalledWith(r.gl.TRIANGLE_FAN, 0, 4);
  expect(r.states.at(-1)).toMatchObject({ phase: 'ready', canSelect: false, points: 3 });
  await ar.end();
  expect(r.source.cancel).toHaveBeenCalledTimes(1);
  expect(r.gl.deleteBuffer).toHaveBeenCalledTimes(1);
  expect(r.gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(r.session.cancelAnimationFrame).toHaveBeenCalledWith(7);
  expect(r.measurements.at(-1)).toBeNull();
  expect(r.states.at(-1)?.phase).toBe('ended');
  await ar.end(); expect(r.session.end).toHaveBeenCalledTimes(1);
});

it('blocks stale or emulated tracking and clears measurements on a reference-space reset', async () => {
  const r = runtime(); const ar = await startWorldAR(r.options);
  vi.spyOn(performance, 'now').mockReturnValue(1000);
  r.tick({ x: 0, y: 0, z: 0 });
  vi.mocked(performance.now).mockReturnValue(1400);
  expect(ar.selectPoint()).toBe(false);
  r.tick({ x: 0, y: 0, z: 0 }); expect(ar.selectPoint()).toBe(true);
  r.tick({ x: 1, y: 0, z: 0 }, { emulated: true });
  expect(r.states.at(-1)?.phase).toBe('tracking-lost'); expect(ar.selectPoint()).toBe(false);
  r.tick({ x: 1, y: 0, z: 0 }); expect(ar.selectPoint()).toBe(true);
  r.tick({ x: 1, y: 0, z: 1 }); expect(ar.selectPoint()).toBe(true);
  r.reference.dispatchEvent(new Event('reset'));
  expect(r.measurements.at(-1)).toBeNull();
  expect(r.states.at(-1)).toMatchObject({ phase: 'searching', points: 0, canSelect: false });
  ar.reset();
  expect(() => ar.setFootprint({ width: NaN, length: 2, clearance: 0 })).toThrow();
  await ar.end();
});

it('ends a failed session instead of leaving camera use active', async () => {
  const r = runtime({ domOverlay: false });
  await expect(startWorldAR(r.options)).rejects.toThrow('measurement controls');
  expect(r.session.end).toHaveBeenCalledTimes(1);
  expect(r.states.at(-1)?.phase).toBe('ended');
});

it('cleans up when graphics initialization fails', async () => {
  const r = runtime({ shaderFailure: true });
  await expect(startWorldAR(r.options)).rejects.toThrow('compile');
  expect(r.session.end).toHaveBeenCalledTimes(1);
  expect(r.gl.deleteShader).toHaveBeenCalled();
});

it('ends a runtime failure without leaving a stalled AR camera session', async () => {
  const r = runtime(); await startWorldAR(r.options);
  r.tickFrame({ getViewerPose: () => { throw new Error('Tracking unavailable'); }, getHitTestResults: () => [] });
  await Promise.resolve();
  expect(r.session.end).toHaveBeenCalledTimes(1);
  expect(r.source.cancel).toHaveBeenCalledTimes(1);
  expect(r.states.at(-1)).toMatchObject({ phase: 'ended', canSelect: false });
});

it('renders the requested orientation without silently rotating an oversized footprint', async () => {
  const r = runtime(); const ar = await startWorldAR(r.options);
  r.tick({ x: 0, y: 0, z: 0 }); ar.selectPoint();
  r.tick({ x: 2, y: 0, z: 0 }); ar.selectPoint();
  r.tick({ x: 2, y: 0, z: 3 }); ar.selectPoint();
  const extent = () => {
    const vertices = r.gl.bufferData.mock.calls.at(-1)![1] as Float32Array;
    const xs = Array.from(vertices).filter((_, index) => index % 3 === 0);
    const zs = Array.from(vertices).filter((_, index) => index % 3 === 2);
    return { width: Math.max(...xs) - Math.min(...xs), length: Math.max(...zs) - Math.min(...zs) };
  };
  ar.setFootprint({ width: 3, length: 2, clearance: 0 }); r.tick(null);
  expect(extent()).toEqual({ width: 3, length: 2 });
  ar.setFootprint({ width: 3, length: 2, clearance: 0, rotated: true }); r.tick(null);
  expect(extent()).toEqual({ width: 2, length: 3 });
  expect(() => ar.setFootprint({ width: 1, length: 1, clearance: 1e308 })).toThrow();
  await ar.end();
});

it('clears a positive measurement immediately even when native end completion is delayed', async () => {
  const r = runtime(); const ar = await startWorldAR(r.options);
  r.tick({ x: 0, y: 0, z: 0 }); ar.selectPoint();
  r.tick({ x: 2, y: 0, z: 0 }); ar.selectPoint();
  r.tick({ x: 2, y: 0, z: 3 }); ar.selectPoint();
  let finish!: () => void;
  r.session.end.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const stopping = ar.end();
  expect(r.measurements.at(-1)).toBeNull();
  expect(r.states.at(-1)?.phase).toBe('ended');
  expect(r.source.cancel).toHaveBeenCalledTimes(1);
  finish(); await stopping;
});

it('cancels a pending start and closes a session granted after cancellation', async () => {
  const r = runtime(); const cancel = new AbortController();
  let grant!: (value: typeof r.session) => void;
  r.xr.requestSession.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  const starting = startWorldAR({ ...r.options, signal: cancel.signal });
  cancel.abort(); grant(r.session);
  await expect(starting).rejects.toMatchObject({ name: 'AbortError' });
  expect(r.session.end).toHaveBeenCalledTimes(1);
  expect(r.session.requestHitTestSource).not.toHaveBeenCalled();
});

it('stops an initialized session when the document becomes hidden', async () => {
  const r = runtime(); await startWorldAR(r.options);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(r.session.end).toHaveBeenCalledTimes(1);
  expect(r.states.at(-1)).toMatchObject({ phase: 'ended', canSelect: false });
  expect(r.measurements.at(-1)).toBeNull();
});

it('invalidates ready status if tracking frames silently stop and recovers only on a fresh pose', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  const r = runtime(); const ar = await startWorldAR(r.options);
  r.tick({ x: 0, y: 0, z: 0 }); ar.selectPoint();
  r.tick({ x: 2, y: 0, z: 0 }); ar.selectPoint();
  r.tick({ x: 2, y: 0, z: 3 }); ar.selectPoint();
  expect(r.states.at(-1)?.phase).toBe('ready');
  vi.advanceTimersByTime(2000);
  expect(r.states.at(-1)).toMatchObject({ phase: 'tracking-lost', canSelect: false });
  r.tick(null, { tracked: false });
  expect(r.states.at(-1)?.phase).toBe('tracking-lost');
  r.tick(null);
  expect(r.states.at(-1)?.phase).toBe('ready');
  await ar.end();
  const notifications = r.states.length;
  vi.advanceTimersByTime(4000);
  expect(r.states).toHaveLength(notifications);
});

it('releases initialized resources if the first animation frame cannot be scheduled', async () => {
  const r = runtime();
  r.session.requestAnimationFrame.mockImplementationOnce(() => { throw new Error('Session interrupted'); });
  await expect(startWorldAR(r.options)).rejects.toThrow('Session interrupted');
  expect(r.source.cancel).toHaveBeenCalledTimes(1);
  expect(r.gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(r.session.end).toHaveBeenCalledTimes(1);
});

it('maps furniture metres through measured floor axes and preserves vertical height', () => {
  const measured = rectangleFromPoints({ x: 2, y: .8, z: 3 }, { x: 2, y: .8, z: 6 }, { x: -2, y: .8, z: 3 })!;
  const vertices = roomVerticesToWorld([0, 0, 0, 3, 1, 0, 0, 2, 4], measured);
  expect(vertices[4]).toBeCloseTo(1.8); expect(vertices[7]).toBeCloseTo(2.8);
  expect(Array.from(vertices).filter((_, i) => i % 3 !== 1)).toEqual([2, 3, 2, 6, -2, 3]);
  expect(() => roomVerticesToWorld([NaN, 0, 0], measured)).toThrow();
});

it('renders copied room furniture with depth and clears it on mode changes and reset', async () => {
  const r = runtime(); const ar = await startWorldAR(r.options);
  const measure = () => {
    r.tick({ x: 0, y: 0, z: 0 }); ar.selectPoint(); r.tick({ x: 4, y: 0, z: 0 }); ar.selectPoint(); r.tick({ x: 4, y: 0, z: 3 }); ar.selectPoint();
  };
  measure();
  const item = { id: 'bed', kind: 'bed' as const, label: 'Bed', width: 1, depth: 2, height: 1, color: '#aabbcc' };
  const placement = { itemId: 'bed', x: .5, z: .25, rotation: 90 as const };
  ar.setFootprint({ width: 2, length: 3, clearance: 0 }); ar.setRoomLayout({ items: [item], placements: [placement] });
  item.width = 100; placement.x = 100;
  r.gl.drawArrays.mockClear(); r.gl.bufferData.mockClear(); r.tick(null);
  expect(r.gl.enable).toHaveBeenCalledWith(r.gl.DEPTH_TEST); expect(r.gl.depthFunc).toHaveBeenCalledWith(r.gl.LEQUAL);
  expect(r.gl.drawArrays.mock.calls.some(call => call[0] === r.gl.TRIANGLES)).toBe(true);
  expect(r.gl.drawArrays.mock.calls.filter(call => call[0] === r.gl.TRIANGLE_FAN)).toHaveLength(1);
  const mesh = Array.from(r.gl.bufferData.mock.calls.at(-1)![1] as Float32Array);
  expect(mesh.every(Number.isFinite)).toBe(true);
  expect(Math.max(...mesh.filter((_, i) => i % 3 === 0))).toBeLessThanOrEqual(2.51);
  ar.setFootprint({ width: 1, length: 2, clearance: 0 }); r.gl.drawArrays.mockClear(); r.tick(null);
  expect(r.gl.drawArrays.mock.calls.some(call => call[0] === r.gl.TRIANGLES)).toBe(false);
  item.width = 1; placement.x = .5; ar.setRoomLayout({ items: [item], placements: [placement] });
  ar.reset(); measure(); r.gl.drawArrays.mockClear(); r.tick(null);
  expect(r.gl.drawArrays.mock.calls.some(call => call[0] === r.gl.TRIANGLES)).toBe(false);
  expect(() => ar.setRoomLayout({ items: [{ ...item, height: NaN }], placements: [placement] })).toThrow();
  expect(() => ar.setRoomLayout({ items: [item, item], placements: [placement] })).toThrow();
  expect(() => ar.setRoomLayout({ items: [item], placements: [{ ...placement, itemId: 'missing' }] })).toThrow();
  expect(() => ar.setRoomLayout({ items: [item], placements: [{ ...placement, x: -1 }] })).toThrow();
  await ar.end();
});

it('inscribes concave native boundaries without measuring their enclosing bounding boxes', () => {
  const concave = [[0, 0], [4, 0], [4, 4], [3, 4], [3, 1], [1, 1], [1, 4], [0, 4]].map(([x, z]) => ({ x, y: 0, z }));
  const corners = inscribedPlaneRectangle(concave)!;
  expect(corners).not.toBeNull();
  const measured = planeRectangleToWorld(corners, transform({ x: 0, y: 0, z: 0 }))!;
  expect(measured.width * measured.length).toBeLessThan(4); expect(measured.width * measured.length).toBeGreaterThan(3);
  for (let x = 0; x <= 20; x++) for (let z = 0; z <= 20; z++) {
    const point = { x: corners[0].x + (corners[1].x - corners[0].x) * x / 20 + (corners[3].x - corners[0].x) * z / 20, z: corners[0].z + (corners[1].z - corners[0].z) * x / 20 + (corners[3].z - corners[0].z) * z / 20 };
    expect(point.x <= 1 || point.x >= 3 || point.z <= 1).toBe(true);
  }
  expect(inscribedPlaneRectangle(polygon().map(p => ({ ...p, y: .1 })))).toBeNull();
  expect(inscribedPlaneRectangle(polygon(60, 3))).toBeNull();
  expect(inscribedPlaneRectangle([{ x: NaN, y: 0, z: 0 }, ...polygon()])).toBeNull();
});

it('transforms native planes into world metres and rejects tilted poses', () => {
  const corners = inscribedPlaneRectangle(polygon())!;
  const matrix = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 2, .5, 3, 1]);
  const measured = planeRectangleToWorld(corners, transform({ x: 2, y: .5, z: 3 }, matrix))!;
  expect(measured.width).toBeCloseTo(3.98); expect(measured.length).toBeCloseTo(2.98);
  expect(measured.corners[0].x).toBeCloseTo(1.99); expect(measured.corners[0].z).toBeCloseTo(3.01);
  expect(measured.corners.every(point => point.y === .5)).toBe(true);
  matrix[5] = .8;
  expect(planeRectangleToWorld(corners, transform({ x: 0, y: 0, z: 0 }, matrix))).toBeNull();
});

it('offers stable native planes, prioritizes a floor label, and freezes confirmation', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const r = runtime(); const ar = await startWorldAR(r.options);
  expect(r.xr.requestSession).toHaveBeenCalledWith('immersive-ar', expect.objectContaining({ optionalFeatures: expect.arrayContaining(['plane-detection', 'mesh-detection']) }));
  const floor = nativePlane('floor'), table = nativePlane('table'), unknown = nativePlane();
  table.polygon = polygon(8, 8); unknown.polygon = polygon(6, 6);
  const frame = detectedFrame([table, unknown, floor]);
  r.tickFrame(frame); expect(ar.useDetectedSurface()).toBe(false);
  vi.mocked(performance.now).mockReturnValue(250); r.tickFrame(frame);
  expect(r.states.at(-1)?.detectedSurface).toBeUndefined();
  vi.mocked(performance.now).mockReturnValue(600); r.tickFrame(frame);
  expect(r.states.at(-1)?.detectedSurface).toEqual({ label: 'floor', width: 3.98, length: 2.98 });
  expect(r.states.at(-1)?.detectedSurfaces?.map(surface => surface.label)).toEqual(['floor', 'table', 'surface']);
  expect(ar.useDetectedSurface()).toBe(true);
  expect(r.states.at(-1)).toMatchObject({ phase: 'ready', points: 3, canSelect: false });
  const frozen = r.measurements.at(-1)!;
  floor.polygon = polygon(5, 5); floor.lastChangedTime++;
  vi.mocked(performance.now).mockReturnValue(700); r.tickFrame(frame);
  expect(r.measurements.at(-1)).toBe(frozen); expect(ar.useDetectedSurface()).toBe(false);
  await ar.end();
});

it('removes missing surfaces and rejects stale, emulated, moving, or wall geometry', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const r = runtime(); const ar = await startWorldAR(r.options);
  const floor = nativePlane('floor'), wall = { ...nativePlane('floor'), orientation: 'vertical' as const };
  const frame = detectedFrame([floor, wall]);
  for (const time of [0, 250, 600]) { vi.mocked(performance.now).mockReturnValue(time); r.tickFrame(frame); }
  expect(r.states.at(-1)?.detectedSurfaces).toHaveLength(1);
  vi.mocked(performance.now).mockReturnValue(1000); expect(ar.useDetectedSurface()).toBe(false);
  const shifted = new Float32Array(identity); shifted[12] = .2;
  r.tickFrame(detectedFrame([floor], [], shifted)); expect(r.states.at(-1)?.detectedSurface).toBeUndefined();
  for (const time of [1250, 1600]) { vi.mocked(performance.now).mockReturnValue(time); r.tickFrame(detectedFrame([floor], [], shifted)); }
  expect(r.states.at(-1)?.detectedSurface?.label).toBe('floor');
  r.tickFrame({ ...frame, getPose: () => ({ transform: transform({ x: 0, y: 0, z: 0 }), emulatedPosition: true }) });
  expect(r.states.at(-1)?.detectedSurface).toBeUndefined(); expect(ar.useDetectedSurface()).toBe(false);
  for (const time of [1700, 1950, 2300]) { vi.mocked(performance.now).mockReturnValue(time); r.tickFrame(frame); }
  r.tickFrame(detectedFrame());
  expect(r.states.at(-1)?.detectedSurface).toBeUndefined(); expect(ar.useDetectedSurface()).toBe(false);
  await ar.end();
});

it('never offers native ceiling or wall labels as horizontal furniture surfaces', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const r = runtime(); const ar = await startWorldAR(r.options);
  const ceiling = nativePlane(' Ceiling '), wall = nativePlane('wall'), unknown = nativePlane();
  for (const time of [0, 250, 600]) { vi.mocked(performance.now).mockReturnValue(time); r.tickFrame(detectedFrame([ceiling, wall])); }
  expect(r.states.at(-1)?.detectedSurfaces).toBeUndefined();
  expect(ar.useDetectedSurface()).toBe(false);
  for (const time of [700, 950, 1300]) { vi.mocked(performance.now).mockReturnValue(time); r.tickFrame(detectedFrame([ceiling, wall, unknown])); }
  expect(r.states.at(-1)?.detectedSurfaces).toEqual([{ label: 'surface', width: 3.98, length: 2.98 }]);
  unknown.semanticLabel = 'ceiling';
  r.tickFrame(detectedFrame([ceiling, wall, unknown]));
  expect(r.states.at(-1)?.detectedSurfaces).toBeUndefined();
  expect(ar.useDetectedSurface()).toBe(false);
  await ar.end();
});

it('measures rotated semantic object meshes without inventing global, flat, or invalid sizes', () => {
  const angle = Math.PI / 3, matrix = new Float32Array([Math.cos(angle), 0, Math.sin(angle), 0, 0, 1, 0, 0, -Math.sin(angle), 0, Math.cos(angle), 0, 30, 2, 40, 1]);
  const pose = transform({ x: 30, y: 2, z: 40 }, matrix);
  const bounds = observedMeshBounds(boxVertices(), 'desk', pose)!;
  expect(bounds.label).toBe('desk'); expect(bounds.width).toBeCloseTo(2); expect(bounds.height).toBeCloseTo(.8); expect(bounds.length).toBeCloseTo(1);
  for (const label of [undefined, 'global', 'global-mesh', 'wall', 'floor', 'other', 'not-a-known-object']) expect(observedMeshBounds(boxVertices(), label, pose)).toBeNull();
  expect(observedMeshBounds(boxVertices(31), 'desk', pose)).toBeNull();
  expect(observedMeshBounds(boxVertices(2, 0), 'desk', pose)).toBeNull();
  expect(observedMeshBounds(new Float32Array(60003), 'desk', pose)).toBeNull();
  const invalid = boxVertices(); invalid[0] = NaN;
  expect(observedMeshBounds(invalid, 'desk', pose)).toBeNull();
});

it('publishes stable object bounds and clears missing or untracked observations', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const r = runtime(); const ar = await startWorldAR(r.options);
  const mesh = nativeMesh(), global = nativeMesh('global');
  global.vertices = new Float32Array(60000);
  const frame = detectedFrame([], [global, mesh]);
  r.tickFrame(frame);
  vi.mocked(performance.now).mockReturnValue(250); r.tickFrame(frame);
  expect(r.states.at(-1)?.detectedObjects).toBeUndefined();
  vi.mocked(performance.now).mockReturnValue(600); r.tickFrame(frame);
  expect(r.states.at(-1)?.detectedObjects).toEqual([{ label: 'desk', width: 2, length: 1, height: .8 }]);
  mesh.vertices = boxVertices(3); mesh.lastChangedTime++;
  r.tickFrame(frame); expect(r.states.at(-1)?.detectedObjects).toBeUndefined();
  for (const time of [850, 1200]) { vi.mocked(performance.now).mockReturnValue(time); r.tickFrame(frame); }
  expect(r.states.at(-1)?.detectedObjects?.[0].width).toBe(3);
  r.tickFrame({ ...frame, getViewerPose: () => null }); expect(r.states.at(-1)?.detectedObjects).toBeUndefined();
  for (const time of [1300, 1550, 1900]) { vi.mocked(performance.now).mockReturnValue(time); r.tickFrame(frame); }
  r.tickFrame(detectedFrame()); expect(r.states.at(-1)?.detectedObjects).toBeUndefined();
  await ar.end();
});

it('expires automatic observations when tracking frames silently stop', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  const r = runtime(); const ar = await startWorldAR(r.options);
  const frame = detectedFrame([nativePlane()], [nativeMesh()]);
  r.tickFrame(frame); vi.advanceTimersByTime(250); r.tickFrame(frame); vi.advanceTimersByTime(350); r.tickFrame(frame);
  expect(r.states.at(-1)?.detectedSurface?.label).toBe('surface'); expect(r.states.at(-1)?.detectedObjects).toHaveLength(1);
  vi.advanceTimersByTime(2000);
  expect(r.states.at(-1)).toMatchObject({ phase: 'tracking-lost', canSelect: false });
  expect(r.states.at(-1)?.detectedSurface).toBeUndefined(); expect(r.states.at(-1)?.detectedObjects).toBeUndefined();
  expect(ar.useDetectedSurface()).toBe(false);
  await ar.end();
});

it('limits native object work and reports at most three current observations', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const r = runtime(); const ar = await startWorldAR(r.options);
  const meshes = ['desk', 'bed', 'table', 'chair'].map((label, index) => ({ ...nativeMesh(label), vertices: boxVertices(index + 1) }));
  const frame = detectedFrame([], meshes);
  for (const time of [0, 250, 600]) { vi.mocked(performance.now).mockReturnValue(time); r.tickFrame(frame); }
  expect(r.states.at(-1)?.detectedObjects?.map(item => item.label)).toEqual(['chair', 'table', 'bed']);
  const invalidPose = new Float32Array(identity); invalidPose[4] = NaN;
  r.tickFrame(detectedFrame([], meshes, invalidPose)); expect(r.states.at(-1)?.detectedObjects).toBeUndefined();
  const oversized = nativeMesh(); oversized.vertices = new Float32Array(60003);
  for (const time of [700, 950, 1300]) { vi.mocked(performance.now).mockReturnValue(time); r.tickFrame(detectedFrame([], [oversized])); }
  expect(r.states.at(-1)?.detectedObjects).toBeUndefined();
  expect(r.states.at(-1)?.phase).not.toBe('ended');
  await ar.end();
});
