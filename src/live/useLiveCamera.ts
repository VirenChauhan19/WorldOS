import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { analyzeAI } from '../api';
import type { AIAnalysis, SceneImage } from '../types';

export type CameraStatus = 'idle' | 'starting' | 'live' | 'error';
const SAMPLE_MS = 200;
const STEADY_MS = 800;
const RECOGNITION_INTERVAL_MS = 12000;

// A conservative image-change guard, not world tracking or a metric measurement.
function changed(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  let total = 0, substantial = 0;
  const pixels = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const difference = Math.abs((a[i] + a[i + 1] + a[i + 2] - b[i] - b[i + 1] - b[i + 2]) / 3);
    total += difference;
    if (difference > 18) substantial++;
  }
  return total / pixels > 4 || substantial / pixels > .08;
}

function cameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was not allowed. Enable camera permission for this site, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable camera was found. Connect a camera or try this page on your phone.';
  if (name === 'NotReadableError') return 'The camera is busy. Close other apps using it, then try again.';
  return 'The camera could not start. Check its permission and try again.';
}

export function useLiveCamera({ active, autoAnalyze, videoRef }: {
  active: boolean;
  autoAnalyze: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [analysisFrame, setAnalysisFrame] = useState<SceneImage | null>(null);
  const [steady, setSteady] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
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
  const inFlight = useRef(false), failedRecognition = useRef(false);

  const invalidate = useCallback(() => {
    scene.current++;
    anchor.current = null;
    if (mounted.current) { setAnalysis(null); setAnalysisFrame(null); setSteady(false); }
  }, []);

  const stop = useCallback(() => {
    session.current++;
    invalidate();
    previous.current = null;
    stableSince.current = 0;
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
    detachTracks.current?.();
    detachTracks.current = null;
    const old = stream.current;
    stream.current = null;
    old?.getTracks().forEach(track => track.stop());
    const video = videoRef.current;
    if (video && video.srcObject === old) { video.pause(); video.srcObject = null; }
    stateRef.current = 'idle';
    if (mounted.current) { setStatus('idle'); setAnalyzing(false); }
  }, [invalidate, videoRef]);

  const retry = useCallback(() => {
    failedRecognition.current = false;
    lastRequest.current = -Infinity;
    stableSince.current = performance.now();
    invalidate();
    setError('');
  }, [invalidate]);

  const start = useCallback(async () => {
    if (!activeRef.current || !mounted.current || stateRef.current === 'starting' || stateRef.current === 'live') return;
    if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
      stateRef.current = 'error';
      setStatus('error');
      setError('Live camera needs HTTPS and a browser with camera access. Open the secure website on your phone.');
      return;
    }
    const currentSession = ++session.current;
    stateRef.current = 'starting';
    setStatus('starting'); setError('');
    failedRecognition.current = false;
    lastRequest.current = -Infinity;
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!mounted.current || !activeRef.current || currentSession !== session.current || document.visibilityState === 'hidden') {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = next;
      const video = videoRef.current;
      if (!video) throw new Error('Video view unavailable.');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = next;
      await video.play();
      if (!mounted.current || !activeRef.current || currentSession !== session.current) {
        next.getTracks().forEach(track => track.stop());
        return;
      }
      const onEnded = () => {
        if (currentSession !== session.current) return;
        stop(); setError('Camera access ended. Start the camera again when you are ready.');
      };
      next.getTracks().forEach(track => track.addEventListener('ended', onEnded));
      detachTracks.current = () => next.getTracks().forEach(track => track.removeEventListener('ended', onEnded));
      stateRef.current = 'live';
      setStatus('live');
      stableSince.current = performance.now();
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 32; sampleCanvas.height = 24;
      const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
      const frameCanvas = document.createElement('canvas');
      const frameContext = frameCanvas.getContext('2d');
      if (!sampleContext || !frameContext) throw new Error('Camera frame capture unavailable.');

      timer.current = setInterval(() => {
        if (currentSession !== session.current || !activeRef.current || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        let pixels: Uint8ClampedArray;
        try {
          sampleContext.drawImage(video, 0, 0, 32, 24);
          pixels = sampleContext.getImageData(0, 0, 32, 24).data;
        } catch {
          invalidate();
          return;
        }
        const now = performance.now();
        const moving = !!previous.current && changed(pixels, previous.current) || !!anchor.current && changed(pixels, anchor.current);
        previous.current = pixels;
        if (moving) { stableSince.current = now; invalidate(); return; }
        if (now - stableSince.current < STEADY_MS) return;
        setSteady(true);
        if (!autoRef.current || inFlight.current || failedRecognition.current || now - lastRequest.current < RECOGNITION_INTERVAL_MS) return;
        const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
        frameCanvas.width = Math.round(video.videoWidth * scale);
        frameCanvas.height = Math.round(video.videoHeight * scale);
        let frame: SceneImage;
        try {
          frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
          frame = { image_url: frameCanvas.toDataURL('image/jpeg', .72), width: frameCanvas.width, height: frameCanvas.height, name: 'Live camera frame' };
        } catch {
          failedRecognition.current = true;
          setError('This camera frame could not be read. Try recognition again.');
          return;
        }
        anchor.current = pixels;
        const currentScene = scene.current;
        lastRequest.current = now;
        inFlight.current = true;
        setAnalyzing(true);
        void analyzeAI(frame.image_url, []).then(result => {
          if (!mounted.current || currentSession !== session.current || currentScene !== scene.current || !autoRef.current || !activeRef.current) return;
          setAnalysis(result); setAnalysisFrame(frame); setError('');
        }).catch(reason => {
          if (!mounted.current || currentSession !== session.current || !autoRef.current || !activeRef.current) return;
          // Failed providers are retried only through an explicit retry/toggle.
          failedRecognition.current = true;
          invalidate();
          setError(reason instanceof Error ? `Recognition paused: ${reason.message}` : 'Recognition paused. Try again when your connection is ready.');
        }).finally(() => {
          inFlight.current = false;
          if (mounted.current) setAnalyzing(false);
        });
      }, SAMPLE_MS);
    } catch (reason) {
      if (!mounted.current || currentSession !== session.current) return;
      stop();
      stateRef.current = 'error';
      setStatus('error'); setError(cameraError(reason));
    }
  }, [invalidate, stop, videoRef]);

  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  useEffect(() => {
    invalidate();
    if (autoAnalyze) { failedRecognition.current = false; lastRequest.current = -Infinity; if (stateRef.current !== 'error') setError(''); }
  }, [autoAnalyze, invalidate]);
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

  return { status, error, analysis, analysisFrame, steady, analyzing, start, stop, retry };
}
