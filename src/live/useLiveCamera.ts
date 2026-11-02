import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { analyzeAI } from '../api';
import type { AIAnalysis, SceneImage } from '../types';

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error';
export type RecognitionStatus = 'off' | 'waiting' | 'stabilizing' | 'analyzing' | 'ready' | 'retrying' | 'error';
export type CameraScan = { analysis: AIAnalysis; frame: SceneImage; capturedAt: number };
const SAMPLE_MS = 200;
const STEADY_MS = 800;
const MIN_REQUEST_GAP_MS = 1500;
const RETRY_DELAYS = [3000, 8000];
const pageHidden = () => document.visibilityState === 'hidden';

// An image-change guard, not world tracking or a metric measurement. Compare
// channels separately so a colour change with equal brightness is not missed.
function changed(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  let total = 0, substantial = 0;
  const pixels = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const difference = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    total += difference;
    if (difference > 18) substantial++;
  }
  return total / pixels > 4 || substantial / pixels > .08;
}

function cameraError(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was not allowed. Enable camera permission for this site, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable camera was found. Connect a camera or try this page on your phone.';
  if (name === 'NotReadableError') return 'The camera is busy. Close other apps using it, then try again.';
  if (name === 'PlaybackError') return 'The camera opened but its preview could not play. Start the camera again.';
  if (name === 'CaptureError') return 'This browser could not read the camera frames. Try another browser or use a saved photo.';
  return 'The camera could not start. Check its permission and try again.';
}

function retryDelay(error: unknown, attempt: number): number | null {
  if (attempt >= RETRY_DELAYS.length) return null;
  const message = error instanceof Error ? error.message : '';
  const code = typeof error === 'object' && error !== null && 'errorCode' in error ? String(error.errorCode) : '';
  if (['missing_credentials', 'invalid_credentials', 'insufficient_credits', 'unsupported_model_access', 'malformed_response'].includes(code)) return null;
  const transientCode = ['rate_limited', 'timeout', 'network_error', 'provider_error'].includes(code);
  // Older backends report access failures as 502/503 with a safe message.
  // Retrying cannot repair credentials, credits or model entitlement.
  if (!transientCode && /credential|not configured|model.*(?:access|unavailable)|permissions|billing|credits|contract|invalid.*(?:response|output)|malformed|session expired|sign in/i.test(message)) return null;
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0;
  if (status && ![408, 429, 500, 502, 503, 504].includes(status)) return null;
  if (!status && !transientCode && !/network|offline|connection|cannot reach|timed? ?out|timeout|temporar|unavailable|fetch/i.test(message)) return null;
  const requested = typeof error === 'object' && error !== null && 'retryAfterMs' in error ? Number(error.retryAfterMs) : 0;
  if (Number.isFinite(requested) && requested > 60000) return null;
  return Math.max(RETRY_DELAYS[attempt], Number.isFinite(requested) ? requested : 0);
}

type RecognitionRequest = { controller: AbortController; session: number; scene: number };

export function useLiveCamera({ active, autoAnalyze, videoRef }: {
  active: boolean;
  autoAnalyze: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [analysisFrame, setAnalysisFrame] = useState<SceneImage | null>(null);
  const [lastScan, setLastScan] = useState<CameraScan | null>(null);
  const [steady, setSteady] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [recognitionStatus, setRecognitionStatus] = useState<RecognitionStatus>(autoAnalyze ? 'waiting' : 'off');
  const [retryInSeconds, setRetryInSeconds] = useState(0);
  const [lastRecognizedAt, setLastRecognizedAt] = useState<number | null>(null);
  const mounted = useRef(true);
  const activeRef = useRef(active), autoRef = useRef(autoAnalyze);
  activeRef.current = active;
  autoRef.current = autoAnalyze;
  const stream = useRef<MediaStream | null>(null);
  const stateRef = useRef<CameraStatus>('idle');
  const session = useRef(0), scene = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const detachTracks = useRef<(() => void) | null>(null);
  const previous = useRef<Uint8ClampedArray | null>(null);
  const anchor = useRef<Uint8ClampedArray | null>(null);
  const stableSince = useRef(0), lastRequest = useRef(-Infinity);
  const request = useRef<RecognitionRequest | null>(null);
  const completedScene = useRef<number | null>(null);
  const failedRecognition = useRef(false), retryCount = useRef(0), retryAt = useRef(0);

  const invalidate = useCallback(() => {
    scene.current++;
    anchor.current = null;
    completedScene.current = null;
    if (mounted.current) { setAnalysis(null); setAnalysisFrame(null); setSteady(false); setLastRecognizedAt(null); }
  }, []);

  const cancelRecognition = useCallback(() => {
    const old = request.current;
    request.current = null;
    old?.controller.abort();
    if (mounted.current) setAnalyzing(false);
  }, []);

  const resetFailures = useCallback(() => {
    failedRecognition.current = false;
    retryCount.current = 0;
    retryAt.current = 0;
    if (mounted.current) { setError(''); setRetryInSeconds(0); }
  }, []);

  const stop = useCallback(() => {
    session.current++;
    cancelRecognition();
    invalidate();
    resetFailures();
    previous.current = null;
    stableSince.current = 0;
    lastRequest.current = -Infinity;
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    detachTracks.current?.();
    detachTracks.current = null;
    const old = stream.current;
    stream.current = null;
    old?.getTracks().forEach(track => track.stop());
    const video = videoRef.current;
    if (video && old && video.srcObject === old) { video.pause(); video.srcObject = null; }
    stateRef.current = 'idle';
    if (mounted.current) { setStatus('idle'); setLastScan(null); setRecognitionStatus(autoRef.current ? 'waiting' : 'off'); }
  }, [cancelRecognition, invalidate, resetFailures, videoRef]);

  const retry = useCallback(() => {
    cancelRecognition();
    resetFailures();
    lastRequest.current = -Infinity;
    stableSince.current = performance.now();
    invalidate();
    setRecognitionStatus(autoRef.current ? stateRef.current === 'live' ? 'stabilizing' : 'waiting' : 'off');
  }, [cancelRecognition, invalidate, resetFailures]);

  const start = useCallback(async () => {
    if (!activeRef.current || !mounted.current || pageHidden() || stateRef.current === 'starting' || stateRef.current === 'live') return;
    if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
      stateRef.current = 'error';
      setStatus('error'); setRecognitionStatus('error');
      setError('Live camera needs HTTPS and a browser with camera access. Open the secure website on your phone.');
      return;
    }
    const currentSession = ++session.current;
    stateRef.current = 'starting';
    setStatus('starting'); setRecognitionStatus(autoRef.current ? 'waiting' : 'off');
    resetFailures();
    previous.current = null;
    lastRequest.current = -Infinity;
    try {
      let next: MediaStream;
      try {
        next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      } catch (reason) {
        if (!(reason instanceof Error || reason instanceof DOMException) || reason.name !== 'OverconstrainedError' || currentSession !== session.current || !activeRef.current) throw reason;
        next = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
      if (!mounted.current || !activeRef.current || currentSession !== session.current || pageHidden()) {
        next.getTracks().forEach(track => track.stop());
        if (mounted.current && currentSession === session.current) stop();
        return;
      }
      stream.current = next;
      const video = videoRef.current;
      if (!video) throw new Error('Video view unavailable.');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = next;
      const onEnded = () => {
        if (currentSession !== session.current) return;
        stop(); setError('Camera access ended. Start the camera again when you are ready.');
      };
      next.getTracks().forEach(track => track.addEventListener('ended', onEnded));
      detachTracks.current = () => next.getTracks().forEach(track => track.removeEventListener('ended', onEnded));
      try { await video.play(); } catch { throw new DOMException('Camera preview could not play.', 'PlaybackError'); }
      if (!mounted.current || !activeRef.current || currentSession !== session.current) return;

      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 64; sampleCanvas.height = 48;
      const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
      const frameCanvas = document.createElement('canvas');
      const frameContext = frameCanvas.getContext('2d');
      if (!sampleContext || !frameContext) throw new DOMException('Camera frame capture unavailable.', 'CaptureError');
      stateRef.current = 'live';
      setStatus('live'); setRecognitionStatus(autoRef.current ? 'stabilizing' : 'off');
      stableSince.current = performance.now();

      timer.current = setInterval(() => {
        if (currentSession !== session.current || !activeRef.current) return;
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
          stableSince.current = performance.now();
          previous.current = null;
          invalidate();
          return;
        }
        let pixels: Uint8ClampedArray;
        try {
          sampleContext.drawImage(video, 0, 0, 64, 48);
          pixels = sampleContext.getImageData(0, 0, 64, 48).data;
        } catch {
          invalidate();
          stableSince.current = performance.now();
          failedRecognition.current = true;
          setRecognitionStatus(autoRef.current ? 'error' : 'off');
          setError('This camera frame could not be read. Try recognition again.');
          return;
        }
        const now = performance.now();
        const moving = !!previous.current && changed(pixels, previous.current) || !!anchor.current && changed(pixels, anchor.current);
        previous.current = pixels;
        if (moving) {
          stableSince.current = now;
          invalidate();
          if (autoRef.current && !failedRecognition.current && !retryAt.current) setRecognitionStatus('stabilizing');
        }
        if (retryAt.current) setRetryInSeconds(Math.max(0, Math.ceil((retryAt.current - now) / 1000)));
        if (moving || now - stableSince.current < STEADY_MS) return;
        setSteady(true);
        if (!autoRef.current || failedRecognition.current || request.current || completedScene.current === scene.current || now < retryAt.current || now - lastRequest.current < MIN_REQUEST_GAP_MS) return;
        const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
        frameCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        frameCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        let frame: SceneImage;
        try {
          frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
          const image_url = frameCanvas.toDataURL('image/jpeg', .82);
          if (!image_url.startsWith('data:image/')) throw new Error('Empty camera frame.');
          frame = { image_url, width: frameCanvas.width, height: frameCanvas.height, name: 'Live camera frame' };
        } catch {
          failedRecognition.current = true;
          setRecognitionStatus('error');
          setError('This camera frame could not be read. Try recognition again.');
          return;
        }
        anchor.current = pixels;
        const current: RecognitionRequest = { controller: new AbortController(), session: currentSession, scene: scene.current };
        const capturedAt = Date.now();
        request.current = current;
        lastRequest.current = now;
        retryAt.current = 0;
        setRetryInSeconds(0); setError('');
        setAnalyzing(true); setRecognitionStatus('analyzing');
        const sameSession = () => mounted.current && request.current === current && current.session === session.current && autoRef.current && activeRef.current;
        const isCurrent = () => sameSession() && current.scene === scene.current;
        void analyzeAI(frame.image_url, [], current.controller.signal, 'live').then(result => {
          // Slow cloud inference can complete after the phone has moved. Keep
          // the exact captured photo and its result available for review, but
          // never project those old boxes over the changed live video.
          if (sameSession()) {
            setLastScan({ analysis: result, frame, capturedAt });
            retryCount.current = 0;
          }
          if (!isCurrent()) return;
          completedScene.current = current.scene;
          retryCount.current = 0;
          setAnalysis(result); setAnalysisFrame(frame); setError('');
          setLastRecognizedAt(Date.now()); setRecognitionStatus('ready');
        }).catch(reason => {
          // Provider failures apply to this session even if the camera moved.
          // Otherwise motion can bypass backoff or repeatedly call a blocked model.
          if (!sameSession() || current.controller.signal.aborted) return;
          const delay = retryDelay(reason, retryCount.current);
          if (delay !== null) {
            retryCount.current++;
            retryAt.current = performance.now() + delay;
            setRetryInSeconds(Math.ceil(delay / 1000)); setRecognitionStatus('retrying');
            setError('Recognition is temporarily unavailable. Retrying automatically.');
          } else {
            failedRecognition.current = true;
            setRecognitionStatus('error');
            setError(reason instanceof Error ? `Recognition paused: ${reason.message}` : 'Recognition paused. Try again when your connection is ready.');
          }
        }).finally(() => {
          // A stopped camera may already own a new request. Older callbacks
          // must never clear its lock, status, or error.
          if (request.current !== current) return;
          request.current = null;
          if (mounted.current) setAnalyzing(false);
        });
      }, SAMPLE_MS);
    } catch (reason) {
      if (!mounted.current || currentSession !== session.current) return;
      stop();
      stateRef.current = 'error';
      setStatus('error'); setRecognitionStatus('error'); setError(cameraError(reason));
    }
  }, [invalidate, resetFailures, stop, videoRef]);

  useEffect(() => { if (!active) stop(); }, [active, stop]);
  useEffect(() => {
    cancelRecognition();
    invalidate();
    setLastScan(null);
    if (stateRef.current !== 'error') resetFailures();
    lastRequest.current = -Infinity;
    stableSince.current = performance.now();
    setRecognitionStatus(autoAnalyze ? stateRef.current === 'live' ? 'stabilizing' : stateRef.current === 'error' ? 'error' : 'waiting' : 'off');
  }, [autoAnalyze, cancelRecognition, invalidate, resetFailures]);
  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => { if (document.visibilityState === 'hidden') stop(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stop);
    window.addEventListener('worldos:session-expired', stop);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('worldos:session-expired', stop);
      stop();
    };
  }, [stop]);

  return { status, error, analysis, analysisFrame, lastScan, steady, analyzing, recognitionStatus, retryInSeconds, lastRecognizedAt, start, stop, retry };
}
