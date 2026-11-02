import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { analyzeAI, observeLive } from '../api';
import type { AIAnalysis, SceneImage, SceneObject } from '../types';
import { ImageTracker, trackingFrame } from './imageTracking';
import { SceneMemory } from './sceneMemory';
import type { MemorySnapshot } from './sceneMemory';
import { LocalDetector, localObjects, mergeLiveObjects, overlap } from './localDetector';
import type { LocalDetectorStatus } from './localDetector';
import { useDeviceWorkspace } from '../device/context';

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

export function useLiveCamera({ active, autoAnalyze, videoRef, mode = 'detailed', pauseRecognition = false, findingId = null }: {
  active: boolean;
  autoAnalyze: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  mode?: 'live' | 'detailed';
  pauseRecognition?: boolean;
  findingId?: string|null;
}) {
  const device=useDeviceWorkspace();
  const cloudEnabled=useRef(!device);cloudEnabled.current=!device;
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
  const [trackedObjects, setTrackedObjects] = useState<SceneObject[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [resultAgeMs, setResultAgeMs] = useState<number | null>(null);
  const tracker = useRef(new ImageTracker());
  const localTracker=useRef(new ImageTracker(1200));
  const localDetector=useRef<LocalDetector|null>(null);
  const localBoxes=useRef<SceneObject[]>([]),cloudBoxes=useRef<SceneObject[]>([]);
  const localEpoch=useRef(0),localPending=useRef(false),localSerial=useRef(0);
  const lastLocalResult=useRef(-Infinity),lastLocalMemory=useRef(-Infinity);
  const cloudAnalysis=useRef<AIAnalysis|null>(null);
  const [localStatus,setLocalStatus]=useState<LocalDetectorStatus>('off');
  const [localLatencyMs,setLocalLatencyMs]=useState<number|null>(null);
  const memoryEngine = useRef(new SceneMemory());
  const [memory,setMemory]=useState<MemorySnapshot>(()=>memoryEngine.current.snapshot());
  const capturedTime = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const pausedRef = useRef(pauseRecognition);
  pausedRef.current = pauseRecognition;
  const findingRef=useRef(findingId);
  findingRef.current=findingId;
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

  const clearTracking = useCallback(() => {
    tracker.current.clear(); capturedTime.current = null;
    localEpoch.current++;localTracker.current.clear();localBoxes.current=[];cloudBoxes.current=[];
    cloudAnalysis.current=null;lastLocalResult.current=-Infinity;lastLocalMemory.current=-Infinity;
    memoryEngine.current.loseLocation();
    if(mounted.current)setMemory(memoryEngine.current.snapshot());
    if (mounted.current) { setTrackedObjects([]); setLatencyMs(null); setResultAgeMs(null); setLocalLatencyMs(null); }
  }, []);

  const forgetMemory=useCallback(()=>{
    request.current?.controller.abort();request.current=null;
    clearTracking();
    memoryEngine.current.clear();
    if(mounted.current){setMemory(memoryEngine.current.snapshot());setTrackedObjects([]);setAnalysis(null);setAnalysisFrame(null);setLastScan(null);setAnalyzing(false);setResultAgeMs(null);setLatencyMs(null);}
  },[clearTracking]);
  const renamePlace=useCallback((id:string,name:string)=>{
    memoryEngine.current.rename(id,name);setMemory(memoryEngine.current.snapshot());
  },[]);

  const cancelRecognition = useCallback(() => {
    localEpoch.current++;
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
    clearTracking();
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
  }, [cancelRecognition, clearTracking, invalidate, resetFailures, videoRef]);

  const retry = useCallback(() => {
    // Do not abort and start overlapping provider work on repeated clicks.
    if (request.current) return;
    cancelRecognition();
    resetFailures();
    lastRequest.current = -Infinity;
    stableSince.current = performance.now();
    invalidate();
    clearTracking();
    setRecognitionStatus(autoRef.current ? stateRef.current === 'live' ? 'stabilizing' : 'waiting' : 'off');
  }, [cancelRecognition, clearTracking, invalidate, resetFailures]);

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
        next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
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
      const localCanvas=document.createElement('canvas');
      const localContext=localCanvas.getContext('2d');
      if (!sampleContext || !frameContext || !localContext) throw new DOMException('Camera frame capture unavailable.', 'CaptureError');
      stateRef.current = 'live';
      setStatus('live'); setRecognitionStatus(autoRef.current ? 'stabilizing' : 'off');
      stableSince.current = performance.now();

      let lastSampleAt = performance.now(), lastMemoryCheck = -Infinity,lastLocalStart=-Infinity;
      timer.current = setInterval(() => {
        if (currentSession !== session.current || !activeRef.current) return;
        const fast = modeRef.current === 'live';
        const now = performance.now();
        if (now - lastSampleAt < (fast ? 75 : SAMPLE_MS)) return;
        lastSampleAt = now;
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
          stableSince.current = performance.now();
          previous.current = null;
          invalidate();
          clearTracking();
          return;
        }
        const sampleWidth = fast ? 128 : 64, sampleHeight = fast ? 96 : 48;
        if (sampleCanvas.width !== sampleWidth) { sampleCanvas.width = sampleWidth; sampleCanvas.height = sampleHeight; previous.current = null; }
        let pixels: Uint8ClampedArray;
        try {
          sampleContext.drawImage(video, 0, 0, sampleWidth, sampleHeight);
          pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
        } catch {
          invalidate();
          clearTracking();
          stableSince.current = performance.now();
          failedRecognition.current = true;
          setRecognitionStatus(autoRef.current ? 'error' : 'off');
          setError('This camera frame could not be read. Try recognition again.');
          return;
        }
        const trackedFrame = fast ? trackingFrame(pixels, sampleWidth, sampleHeight, now) : null;
        if (trackedFrame && autoRef.current) {
          cloudBoxes.current=tracker.current.push(trackedFrame);
          localBoxes.current=localTracker.current.push(trackedFrame);
          setTrackedObjects(mergeLiveObjects(localBoxes.current,cloudBoxes.current));
          // Local place recognition continues even while a cloud request is
          // in flight. No API round trip is needed to recover a known view.
          if(now-lastMemoryCheck>=400){
            lastMemoryCheck=now;
            memoryEngine.current.observe(trackedFrame,findingRef.current);
          }else memoryEngine.current.track(trackedFrame);
          setMemory(memoryEngine.current.snapshot());
          if (capturedTime.current !== null) setResultAgeMs(now - capturedTime.current);
        }
        const detector=localDetector.current;
        if(trackedFrame&&autoRef.current&&!pausedRef.current&&detector?.available&&!localPending.current&&now-lastLocalStart>=120){
          localPending.current=true;lastLocalStart=now;
          const generation=localEpoch.current,capturedAt=Date.now();
          const previousLocal=localBoxes.current,remote=cloudBoxes.current,remoteDetails=cloudAnalysis.current?.details??{};
          const sameLocal=()=>mounted.current&&currentSession===session.current&&generation===localEpoch.current&&activeRef.current&&autoRef.current&&!pausedRef.current&&modeRef.current==='live'&&localDetector.current===detector;
          try{
          const scale=Math.min(1,512/Math.max(video.videoWidth,video.videoHeight));
          localCanvas.width=Math.max(1,Math.round(video.videoWidth*scale));localCanvas.height=Math.max(1,Math.round(video.videoHeight*scale));
          localContext.drawImage(video,0,0,localCanvas.width,localCanvas.height);
          const width=localCanvas.width,height=localCanvas.height;
          const frame:SceneImage={image_url:localCanvas.toDataURL('image/jpeg',.65),width,height,name:'On-device camera frame'};
          void createImageBitmap(localCanvas).then(bitmap=>{
            if(!sameLocal()){bitmap.close();return null;}
            return detector.detect(bitmap,now);
          }).then(result=>{
            if(!result||!sameLocal())return;
            const objects=localObjects(result,width,height,previousLocal,()=>`device-${++localSerial.current}`);
            const details=Object.fromEntries(objects.flatMap(object=>{
              const match=remote.find(old=>old.label.toLowerCase()===object.label.toLowerCase()&&overlap(old,object)>.5);
              return match&&remoteDetails[match.id]?[[object.id,remoteDetails[match.id]]]:[];
            }));
            let observed:AIAnalysis={objects:mergeLiveObjects(objects,remote),details:{...remoteDetails,...details},concepts:objects.map(object=>object.label),summary:cloudEnabled.current?'Common objects recognized on this device. AI adds details in the background.':'Common objects recognized on this device. Tap a label to explore your view.',message:'',warnings:[],provider:'on_device',model:'EfficientDet Lite0',live_request:false};
            // Remember at most once a second, while fresh labels update faster.
            if(now-lastLocalMemory.current>=1000){
              lastLocalMemory.current=now;
              observed=memoryEngine.current.remember(observed,frame,trackedFrame,capturedAt);
              setMemory(memoryEngine.current.snapshot());
            }
            const local=observed.objects.filter(object=>object.source==='on_device');
            localBoxes.current=localTracker.current.seed(local,trackedFrame);
            setTrackedObjects(mergeLiveObjects(localBoxes.current,cloudBoxes.current));
            lastLocalResult.current=performance.now();capturedTime.current=now;
            setLocalLatencyMs(performance.now()-now);setResultAgeMs(performance.now()-now);
            setAnalysis(observed);setAnalysisFrame(frame);setLastScan({analysis:observed,frame,capturedAt});
            setLastRecognizedAt(Date.now());
          }).catch(()=>{
            if(sameLocal()){detector.close();setLocalStatus('unavailable');}
          }).finally(()=>{localPending.current=false;});
          }catch{localPending.current=false;detector.close();setLocalStatus('unavailable');}
        }
        const moving = !!previous.current && changed(pixels, previous.current) || !!anchor.current && changed(pixels, anchor.current);
        previous.current = pixels;
        if (moving) {
          stableSince.current = now;
          if (!fast) invalidate();
          if (autoRef.current && !failedRecognition.current && !retryAt.current) setRecognitionStatus('stabilizing');
        }
        if (retryAt.current) setRetryInSeconds(Math.max(0, Math.ceil((retryAt.current - now) / 1000)));
        if (!fast && (moving || now - stableSince.current < STEADY_MS)) return;
        setSteady(!moving);
        // The camera and local tracking run independently. At most one API
        // frame is in flight; sample the newest frame only when capacity frees.
        // 3.5s also stays below the default 20 requests/minute production budget.
        if (!cloudEnabled.current || !autoRef.current || pausedRef.current || failedRecognition.current || request.current || (!fast && completedScene.current === scene.current) || now < retryAt.current || now - lastRequest.current < (fast ? 3500 : MIN_REQUEST_GAP_MS)) return;
        const scale = Math.min(1, (fast ? 768 : 1280) / Math.max(video.videoWidth, video.videoHeight));
        frameCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        frameCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        let frame: SceneImage;
        try {
          frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
          const image_url = frameCanvas.toDataURL('image/jpeg', fast ? .7 : .82);
          if (!image_url.startsWith('data:image/')) throw new Error('Empty camera frame.');
          frame = { image_url, width: frameCanvas.width, height: frameCanvas.height, name: 'Live camera frame' };
        } catch {
          failedRecognition.current = true;
          setRecognitionStatus('error');
          setError('This camera frame could not be read. Try recognition again.');
          return;
        }
        anchor.current = fast ? null : pixels;
        const current: RecognitionRequest = { controller: new AbortController(), session: currentSession, scene: scene.current };
        const capturedAt = Date.now();
        request.current = current;
        lastRequest.current = now;
        retryAt.current = 0;
        setRetryInSeconds(0); setError('');
        setAnalyzing(true); setRecognitionStatus('analyzing');
        const sameSession = () => mounted.current && request.current === current && current.session === session.current && autoRef.current && activeRef.current;
        const isCurrent = () => sameSession() && current.scene === scene.current;
        void (fast ? observeLive(frame.image_url, current.controller.signal) : analyzeAI(frame.image_url, [], current.controller.signal, 'live')).then(received => {
          if(!sameSession())return;
          const result=fast&&trackedFrame?memoryEngine.current.remember(received,frame,trackedFrame,capturedAt):received;
          if(fast)cloudAnalysis.current=result;
          if(fast)setMemory(memoryEngine.current.snapshot());
          // Slow cloud inference can complete after the phone has moved. Keep
          // the exact captured photo and its result available for review, but
          // never project those old boxes over the changed live video.
          const localIsFresh=fast&&performance.now()-lastLocalResult.current<1200;
          if (sameSession()&&!localIsFresh) {
            setLastScan({ analysis: result, frame, capturedAt });
            retryCount.current = 0;
          }
          if (!isCurrent()) return;
          if (fast && trackedFrame) {
            if(!localIsFresh)capturedTime.current = trackedFrame.at;
            cloudBoxes.current=tracker.current.seed(result.objects, trackedFrame);
            setTrackedObjects(mergeLiveObjects(localBoxes.current,cloudBoxes.current));
            setLatencyMs(performance.now() - now);
            if(!localIsFresh)setResultAgeMs(performance.now() - now);
          }
          completedScene.current = current.scene;
          retryCount.current = 0;
          if(!localIsFresh){setAnalysis(result);setAnalysisFrame(frame);}
          setError('');
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
      }, 40);
    } catch (reason) {
      if (!mounted.current || currentSession !== session.current) return;
      stop();
      stateRef.current = 'error';
      setStatus('error'); setRecognitionStatus('error'); setError(cameraError(reason));
    }
  }, [clearTracking, invalidate, resetFailures, stop, videoRef]);

  useEffect(() => { if (!active) stop(); }, [active, stop]);
  useEffect(()=>{
    if(!active||!autoAnalyze||mode!=='live'){setLocalStatus('off');return;}
    if(typeof Worker==='undefined'||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined'){setLocalStatus('unavailable');return;}
    let detector:LocalDetector;
    try{detector=new LocalDetector(value=>{if(mounted.current)setLocalStatus(value);});localDetector.current=detector;}
    catch{setLocalStatus('unavailable');return;}
    return()=>{detector.close();if(localDetector.current===detector)localDetector.current=null;};
  },[active,autoAnalyze,mode]);
  useEffect(() => {
    if (pauseRecognition) cancelRecognition();
  }, [pauseRecognition, cancelRecognition]);
  useEffect(() => {
    cancelRecognition();
    clearTracking();
    invalidate();
    setLastScan(null);
    if (stateRef.current !== 'error') resetFailures();
    lastRequest.current = -Infinity;
    stableSince.current = performance.now();
    setRecognitionStatus(autoAnalyze ? stateRef.current === 'live' ? 'stabilizing' : stateRef.current === 'error' ? 'error' : 'waiting' : 'off');
  }, [autoAnalyze, mode, cancelRecognition, clearTracking, invalidate, resetFailures]);
  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => { if (document.visibilityState === 'hidden') stop(); };
    const onSessionExpired=()=>{stop();forgetMemory();localDetector.current?.close();};
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stop);
    window.addEventListener('worldos:session-expired', onSessionExpired);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('worldos:session-expired', onSessionExpired);
      stop();
      memoryEngine.current.clear();
    };
  }, [forgetMemory,stop]);

  return { status, error, analysis, analysisFrame, lastScan, steady, analyzing, recognitionStatus, retryInSeconds, lastRecognizedAt, trackedObjects, latencyMs, resultAgeMs, localStatus, localLatencyMs, memory, forgetMemory, renamePlace, start, stop, retry };
}
