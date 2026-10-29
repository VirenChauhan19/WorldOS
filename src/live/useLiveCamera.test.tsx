// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLiveCamera } from './useLiveCamera';
import type { AIAnalysis } from '../types';

vi.mock('../api', () => ({ analyzeAI: vi.fn() }));
import { analyzeAI } from '../api';

const response: AIAnalysis = { objects: [{ id: 'cup', label: 'Cup', box: { x: .2, y: .3, width: .1, height: .1 }, locked: false }], concepts: ['cup'], summary: '', message: '', warnings: [], provider: 'fixture', model: 'fixture', live_request: false };
let level = 40;
let getUserMedia: ReturnType<typeof vi.fn>;
function camera() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}
function videoRef() {
  const video = document.createElement('video');
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 }, readyState: { value: 4 } });
  return { current: video };
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date', 'performance'] });
  level = 40;
  getUserMedia = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(32 * 24 * 4).fill(level) }),
  }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function(this: HTMLCanvasElement) { return `data:image/jpeg;base64,fixture-${this.width}x${this.height}`; });
  vi.mocked(analyzeAI).mockResolvedValue(response);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });

it('stops a late permission grant after the user closes the camera', async () => {
  const source = camera(), ref = videoRef();
  let allow!: (stream: MediaStream) => void;
  getUserMedia.mockImplementation(() => new Promise<MediaStream>(resolve => { allow = resolve; }));
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  let opening!: Promise<void>;
  act(() => { opening = result.current.start(); });
  expect(result.current.status).toBe('starting');
  act(() => result.current.stop());
  await act(async () => { allow(source.stream); await opening; });
  expect(source.track.stop).toHaveBeenCalledOnce();
  expect(ref.current.srcObject).toBeUndefined();
  expect(result.current.status).toBe('idle');
  expect(analyzeAI).not.toHaveBeenCalled();
});

it('stops tracks on navigation and does not reopen automatically', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockResolvedValue(source.stream);
  const { result, rerender, unmount } = renderHook(({ active }) => useLiveCamera({ active, autoAnalyze: false, videoRef: ref }), { initialProps: { active: true } });
  await act(async () => result.current.start());
  expect(result.current.status).toBe('live');
  rerender({ active: false });
  expect(source.track.stop).toHaveBeenCalledOnce();
  expect(ref.current.srcObject).toBeNull();
  rerender({ active: true });
  await advance(20000);
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(analyzeAI).not.toHaveBeenCalled();
  unmount();
});

it('waits for a steady frame, bounds its size, and never overlaps recognition', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockResolvedValue(source.stream);
  let complete!: (analysis: AIAnalysis) => void;
  vi.mocked(analyzeAI).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(600);
  expect(analyzeAI).not.toHaveBeenCalled();
  await advance(200);
  expect(analyzeAI).toHaveBeenCalledWith('data:image/jpeg;base64,fixture-960x540', []);
  await advance(25000);
  expect(analyzeAI).toHaveBeenCalledOnce();
  await act(async () => complete(response));
  expect(result.current.analysis).toEqual(response);
  expect(result.current.analysisFrame?.width).toBe(960);
});

it('removes outlines on motion and discards recognition from the earlier view', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockResolvedValue(source.stream);
  let complete!: (analysis: AIAnalysis) => void;
  vi.mocked(analyzeAI).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(800);
  level = 100;
  await advance(200);
  expect(result.current.steady).toBe(false);
  await act(async () => complete(response));
  expect(result.current.analysis).toBeNull();
  expect(result.current.analysisFrame).toBeNull();
  await advance(800);
  expect(result.current.steady).toBe(true);
  expect(analyzeAI).toHaveBeenCalledOnce();
});

it('pauses provider failures until an explicit retry and releases tracks on unmount', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockResolvedValue(source.stream);
  vi.mocked(analyzeAI).mockRejectedValueOnce(new Error('Model unavailable'));
  const { result, unmount } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(800);
  expect(result.current.error).toContain('Recognition paused');
  await advance(60000);
  expect(analyzeAI).toHaveBeenCalledOnce();
  act(() => result.current.retry());
  await advance(800);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
  expect(result.current.analysis).toEqual(response);
  unmount();
  expect(source.track.stop).toHaveBeenCalledOnce();
});

it('stops the camera when the page is hidden and leaves it stopped on return', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockResolvedValue(source.stream);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: false, videoRef: ref }));
  await act(async () => result.current.start());
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(source.track.stop).toHaveBeenCalledOnce();
  expect(result.current.status).toBe('idle');
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(getUserMedia).toHaveBeenCalledOnce();
});

it('releases the camera on session expiry and ignores its outstanding recognition', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockResolvedValue(source.stream);
  let complete!: (analysis: AIAnalysis) => void;
  vi.mocked(analyzeAI).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(800);
  act(() => window.dispatchEvent(new Event('worldos:session-expired')));
  expect(source.track.stop).toHaveBeenCalledOnce();
  await act(async () => complete(response));
  expect(result.current.status).toBe('idle');
  expect(result.current.analysis).toBeNull();
});
