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
  expect(analyzeAI).toHaveBeenCalledWith('data:image/jpeg;base64,fixture-1280x720', [], expect.any(AbortSignal), 'live');
  await advance(25000);
  expect(analyzeAI).toHaveBeenCalledOnce();
  await act(async () => complete(response));
  expect(result.current.analysis).toEqual(response);
  expect(result.current.analysisFrame?.width).toBe(1280);
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
  await advance(1400);
  expect(result.current.steady).toBe(true);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
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

it('keeps a completed scan attached to its captured photo when the live camera has moved', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockResolvedValue(source.stream);
  let complete!: (analysis: AIAnalysis) => void;
  vi.mocked(analyzeAI).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(800);
  level = 100;
  await advance(30000);
  expect(analyzeAI).toHaveBeenCalledOnce();
  await act(async () => complete(response));
  expect(result.current.analysis).toBeNull();
  expect(result.current.lastScan?.analysis).toEqual(response);
  expect(result.current.lastScan?.frame.image_url).toContain('1280x720');
  expect(result.current.lastScan?.capturedAt).toBeLessThan(Date.now());
  await advance(200);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
  expect(result.current.lastScan?.analysis).toEqual(response);
  act(() => result.current.stop());
  expect(result.current.lastScan).toBeNull();
});

it('does not bill repeatedly for an unchanged scene and clears current outlines on motion', async () => {
  getUserMedia.mockResolvedValue(camera().stream);
  const ref = videoRef();
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(800);
  expect(result.current.recognitionStatus).toBe('ready');
  expect(result.current.lastRecognizedAt).not.toBeNull();
  await advance(60000);
  expect(analyzeAI).toHaveBeenCalledOnce();
  level = 130;
  await advance(200);
  expect(result.current.analysis).toBeNull();
  expect(result.current.lastRecognizedAt).toBeNull();
  await advance(800);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
});

it('aborts stopped sessions and prevents an older rejection from unlocking a newer request', async () => {
  const first = camera(), next = camera(), ref = videoRef();
  getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(next.stream);
  let rejectOld!: (reason: Error) => void, resolveNew!: (value: AIAnalysis) => void;
  vi.mocked(analyzeAI).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(800);
  const signal = vi.mocked(analyzeAI).mock.calls[0][2]!;
  act(() => result.current.stop());
  expect(signal.aborted).toBe(true);
  await act(async () => result.current.start());
  await advance(800);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
  await act(async () => rejectOld(new Error('Old connection failed')));
  expect(result.current.analyzing).toBe(true);
  expect(result.current.error).toBe('');
  await advance(10000);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
  await act(async () => resolveNew(response));
  expect(result.current.analysis).toEqual(response);
  expect(first.track.stop).toHaveBeenCalledOnce();
  expect(next.track.stop).not.toHaveBeenCalled();
});

it('retries temporary failures with backoff, then stops after two retries', async () => {
  getUserMedia.mockResolvedValue(camera().stream);
  vi.mocked(analyzeAI).mockRejectedValue(new Error('Cannot reach WorldOS. Check your connection.'));
  const ref = videoRef();
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(800);
  expect(result.current.recognitionStatus).toBe('retrying');
  expect(result.current.retryInSeconds).toBe(3);
  await advance(2800);
  expect(analyzeAI).toHaveBeenCalledOnce();
  await advance(200);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
  expect(result.current.retryInSeconds).toBe(8);
  await advance(8000);
  expect(analyzeAI).toHaveBeenCalledTimes(3);
  expect(result.current.recognitionStatus).toBe('error');
  await advance(120000);
  expect(analyzeAI).toHaveBeenCalledTimes(3);
});

it('honors rate-limit timing and does not retry permanent model access errors', async () => {
  getUserMedia.mockResolvedValue(camera().stream);
  vi.mocked(analyzeAI).mockRejectedValueOnce(Object.assign(new Error('Rate limit'), { status: 429, retryAfterMs: 10000 }))
    .mockRejectedValueOnce(Object.assign(new Error('Provider unavailable'), { status: 502, errorCode: 'unsupported_model_access' }));
  const ref = videoRef();
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(800);
  expect(result.current.retryInSeconds).toBe(10);
  await advance(9800);
  expect(analyzeAI).toHaveBeenCalledOnce();
  await advance(200);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
  expect(result.current.recognitionStatus).toBe('error');
  await advance(120000);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
});

it('honors provider backoff after motion and then recognizes the new steady view', async () => {
  getUserMedia.mockResolvedValue(camera().stream);
  let reject!: (reason: Error) => void;
  vi.mocked(analyzeAI).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const ref = videoRef();
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  await advance(800);
  level = 110;
  await advance(200);
  await act(async () => reject(new Error('Provider unavailable')));
  expect(result.current.recognitionStatus).toBe('retrying');
  await advance(2800);
  expect(analyzeAI).toHaveBeenCalledOnce();
  await advance(200);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
  expect(result.current.analysis).toEqual(response);
});

it('does not bypass permanent provider errors when the phone moves during inference',async()=>{
  getUserMedia.mockResolvedValue(camera().stream);
  let reject!: (reason: Error) => void;
  vi.mocked(analyzeAI).mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail;}));
  const ref=videoRef();
  const {result}=renderHook(()=>useLiveCamera({active:true,autoAnalyze:true,videoRef:ref}));
  await act(async()=>result.current.start());
  await advance(800);
  level=140;
  await advance(200);
  await act(async()=>reject(Object.assign(new Error('Model unavailable'),{errorCode:'unsupported_model_access',status:502})));
  await advance(60000);
  expect(analyzeAI).toHaveBeenCalledOnce();
  expect(result.current.recognitionStatus).toBe('error');
});

it('turning recognition off cancels its request without stopping the camera', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockResolvedValue(source.stream);
  let complete!: (analysis: AIAnalysis) => void;
  vi.mocked(analyzeAI).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const { result, rerender } = renderHook(({ autoAnalyze }) => useLiveCamera({ active: true, autoAnalyze, videoRef: ref }), { initialProps: { autoAnalyze: true } });
  await act(async () => result.current.start());
  await advance(800);
  const signal = vi.mocked(analyzeAI).mock.calls[0][2]!;
  rerender({ autoAnalyze: false });
  expect(signal.aborted).toBe(true);
  await act(async () => complete(response));
  expect(result.current.status).toBe('live');
  expect(result.current.recognitionStatus).toBe('off');
  expect(result.current.analysis).toBeNull();
  expect(result.current.lastScan).toBeNull();
  expect(source.track.stop).not.toHaveBeenCalled();
  rerender({ autoAnalyze: true });
  await advance(800);
  expect(analyzeAI).toHaveBeenCalledTimes(2);
});

it('releases camera tracks when video playback fails and explains the failure', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockResolvedValue(source.stream);
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: true, videoRef: ref }));
  await act(async () => result.current.start());
  expect(source.track.stop).toHaveBeenCalledOnce();
  expect(ref.current.srcObject).toBeNull();
  expect(result.current.error).toContain('preview could not play');
  expect(result.current.status).toBe('error');
});

it('retries unsupported camera constraints without requesting audio', async () => {
  const source = camera(), ref = videoRef();
  getUserMedia.mockRejectedValueOnce(new DOMException('Unsupported', 'OverconstrainedError')).mockResolvedValueOnce(source.stream);
  const { result } = renderHook(() => useLiveCamera({ active: true, autoAnalyze: false, videoRef: ref }));
  await act(async () => result.current.start());
  expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: false, video: true });
  expect(result.current.status).toBe('live');
});
