import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Box as BoxIcon, Check, CheckCheck, ChevronRight, CircleHelp, Crosshair, Download, Eye, EyeOff, Focus, ImagePlus, Layers3, LoaderCircle, LockKeyhole, Maximize, MousePointer2, Plus, RotateCcw, ScanLine, ShieldCheck, Sparkles, SquareDashed, Trash2, UnlockKeyhole, X } from 'lucide-react';
import Canvas from './Canvas';
import OperationStatus from './ui/OperationStatus';
import Dialog from './ui/Dialog';
import PhotoActions from './PhotoActions';
import { exportJSON } from './exportFile';
import AIPanel from './AIPanel';
import VisualVerificationPanel from './VisualVerification';
import DemoMode from './DemoMode';
import type { DemoEvidence } from './DemoMode';
import { analyze, automaticVerify, health, planScene, replanScene, verifyReviewed, verifyScene } from './api';
import { clamp } from './geometry';
import { SAMPLE_IMAGE, SAMPLE_OBJECTS, SAMPLE_TARGET } from './sample';
import { FULL } from './types';
import type { AICapabilities, Box, Plan, PlanRequest, PlanningConstraints, SceneImage, SceneObject, Tool, Verification, VisualVerification, ReplanResult } from './types';

type Stage = 'annotate' | 'plan' | 'verify';
const STAGES: Stage[] = ['annotate', 'plan', 'verify'];
const labels = ['Understand', 'Make a plan', 'Verify results'];
const copyObjects = () => structuredClone(SAMPLE_OBJECTS);
const getError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export default function App({active=true}:{active?:boolean}) {
  const [image, setImage] = useState<SceneImage>(SAMPLE_IMAGE);
  const [objects, setObjects] = useState<SceneObject[]>(copyObjects);
  const [target, setTarget] = useState<Box | null>(SAMPLE_TARGET);
  const [workspace, setWorkspace] = useState<Box>(FULL);
  const [goal, setGoal] = useState('Make room for my laptop without moving my coffee.');
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>('notebook');
  const [stage, setStage] = useState<Stage>('annotate');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [snapshot, setSnapshot] = useState<PlanRequest | null>(null);
  const [finalImage, setFinalImage] = useState<SceneImage | null>(null);
  const [observed, setObserved] = useState<SceneObject[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [visualResult, setVisualResult] = useState<VisualVerification | null>(null);
  const [visualStale, setVisualStale] = useState(false);
  const [originalSnapshot, setOriginalSnapshot] = useState<PlanRequest | null>(null);
  const [originalImage, setOriginalImage] = useState<SceneImage | null>(null);
  const [revision, setRevision] = useState<ReplanResult | null>(null);
  const [framingConfirmed, setFramingConfirmed] = useState(false);
  const [inventoryConfirmed, setInventoryConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [aiCapabilities, setAICapabilities] = useState<AICapabilities>();
  const [constraints, setConstraints] = useState<PlanningConstraints | null>(null);
  const [aiReviewed, setAIReviewed] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [compare, setCompare] = useState<'before' | 'after' | 'split'>('after');
  const [help, setHelp] = useState(false);
  const [demo, setDemo] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [activeMove, setActiveMove] = useState(0);
  const [evidence, setEvidence] = useState<DemoEvidence | null>(null);
  const requestLock=useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const afterInput = useRef<HTMLInputElement>(null);
  const feasible = !!plan && ['ready', 'already_clear'].includes(plan.status);
  const activeObjects = stage === 'verify' ? observed : objects;
  const activeObject = activeObjects.find(obj => obj.id === selected);
  const lockedCount = plan ? plan.locked_ids.length : objects.filter(obj => obj.locked).length;
  const isSample = image.image_url === SAMPLE_IMAGE.image_url;
  const hasAIObjects = objects.some(obj => obj.source && obj.source !== 'manual');

  useEffect(()=>{if(!active)setHelp(false);},[active]);

  useEffect(() => {
    if(!active)return;
    let mounted = true;
    const ping = () => health().then(result => { if (mounted) { setOnline(true); setAICapabilities(result.ai); } }).catch(() => { if (mounted) setOnline(false); });
    void ping(); const interval = window.setInterval(()=>{if(document.visibilityState!=='hidden')void ping();}, 15000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [active]);

  function invalidate() {
    setEvidence(previous => previous ? { ...previous, historical: true } : null); setActiveMove(0);
    setPlan(null); setSnapshot(null); setFinalImage(null); setObserved([]); setReviewed([]); setVerification(null); setError(null);
    setConstraints(null); setAIReviewed(false);
    setVisualResult(null); setVisualStale(false); setOriginalSnapshot(null); setOriginalImage(null); setRevision(null); setFramingConfirmed(false); setInventoryConfirmed(false);
  }
  function updateObjects(next: SceneObject[]) {
    if (stage === 'verify') {
      const changed = observed.filter(obj => JSON.stringify(obj.box) !== JSON.stringify(next.find(n => n.id === obj.id)?.box)).map(obj => obj.id);
      setObserved(next.map(obj => changed.includes(obj.id) ? { ...obj, source: 'ai_corrected', confidence: null } : obj)); setReviewed(reviewed.filter(id => !changed.includes(id))); setVerification(null); setVisualStale(true); setInventoryConfirmed(false); setError(null);
    } else {
      next = next.map(obj => {
        const original = objects.find(old => old.id === obj.id);
        return original?.source && original.source !== 'manual' && (original.label !== obj.label || JSON.stringify(original.box) !== JSON.stringify(obj.box))
          ? { ...obj, source: 'ai_corrected' as const, confidence: null } : obj;
      });
      invalidate(); setObjects(next);
    }
  }
  function addObject(box: Box) {
    if (stage === 'verify') {
      if (observed.length >= 12) { setError('The planner supports up to 12 current obstacles.'); return; }
      const id = crypto.randomUUID();
      applyObservations([...observed, { id, label: `Obstacle ${observed.length + 1}`, box, locked: false, source: 'manual', confidence: null }]);
      setSelected(id); setTool('select'); setInventoryConfirmed(false); return;
    }
    if (objects.length >= 12) { setError('The MVP supports up to 12 objects. Remove an annotation to add another.'); return; }
    const id = crypto.randomUUID();
    updateObjects([...objects, { id, label: `Object ${objects.length + 1}`, box, locked: false }]);
    setSelected(id); setTool('select');
  }
  function updateCoordinate(key: keyof Box, value: number) {
    if (!activeObject || !Number.isFinite(value)) return;
    const box = { ...activeObject.box };
    if (key === 'x') box.x = clamp(value / 100, 0, 1 - box.width);
    if (key === 'y') box.y = clamp(value / 100, 0, 1 - box.height);
    if (key === 'width') box.width = clamp(value / 100, 0.015, 1 - box.x);
    if (key === 'height') box.height = clamp(value / 100, 0.015, 1 - box.y);
    updateObjects(activeObjects.map(obj => obj.id === selected ? { ...obj, box } : obj));
  }
  async function upload(file: File | undefined, after = false) {
    if (!file || busy || requestLock.current) return;
    requestLock.current=true;
    setBusy(after ? 'Preparing final photo…' : 'Preparing your scene…'); setError(null);
    try {
      const result = await analyze(file);
      const next = { image_url: result.image_url, width: result.width, height: result.height, name: file.name };
      if (after) {
        if (Math.abs((next.width / next.height) / (image.width / image.height) - 1) > 0.02) throw new Error('Use a final photo with the same aspect ratio and camera framing as the original. Retake or crop the photo first.');
        setFinalImage(next); setObserved(structuredClone(snapshot!.objects).map(obj => ({ ...obj, source: 'manual', confidence: null }))); setReviewed([]); setVerification(null); setCompare('after'); setSelected(snapshot!.objects[0]?.id ?? null);
        setVisualResult(null); setVisualStale(false); setFramingConfirmed(false); setInventoryConfirmed(false);
      } else {
        invalidate(); setEvidence(null); setImage(next); setObjects([]); setTarget(null); setWorkspace(FULL); setSelected(null); setStage('annotate'); setTool('object');
      }
      setOnline(true);
    } catch (error) { setError(getError(error)); }
    finally { requestLock.current=false;setBusy(null); }
  }
  async function generate() {
    if (!target || !objects.length || !goal.trim()) { setError('Add at least one object, draw a target region, and describe your goal.'); return; }
    if (objects.some(obj => !obj.label.trim())) { setError('Give every object a label.'); return; }
    if (hasAIObjects && !aiReviewed) { setError('Review AI annotations, add missed obstacles, then confirm the scene before planning.'); return; }
    const req: PlanRequest = { objects: structuredClone(objects), target: { ...target }, workspace: { ...workspace }, goal: goal.trim(), clearance: 0.008, ...(constraints ? { constraints: structuredClone(constraints) } : {}) };
    if(busy||requestLock.current)return;requestLock.current=true;
    setBusy('Finding a safe layout…'); setError(null);
    try {
      const result = await planScene(req);
      setPlan(result); setSnapshot(req); setFinalImage(null); setObserved([]); setReviewed([]); setVerification(null); setStage('plan'); setTool('select'); setOnline(true);
      setOriginalSnapshot(req); setOriginalImage(image); setRevision(null); setVisualResult(null); setVisualStale(false);
      setActiveMove(0); if (demo) setDemoStep(2);
    } catch (error) { setError(getError(error)); }
    finally { requestLock.current=false;setBusy(null); }
  }
  async function verify() {
    if (!snapshot || !finalImage || reviewed.length !== observed.length) return;
    if(busy||requestLock.current)return;requestLock.current=true;
    setBusy('Checking placements…'); setError(null);
    try { setVerification(visualResult || revision || observed.length !== snapshot.objects.length ? await verifyReviewed(reviewedState()) : await verifyScene(snapshot, observed)); setOnline(true); }
    catch (error) { setError(getError(error)); }
    finally { requestLock.current=false;setBusy(null); }
  }
  function reviewedState() {
    return { original_request: originalSnapshot ?? snapshot!, plan_request: snapshot!, observed_objects: observed, reviewed_ids: reviewed, framing_confirmed: framingConfirmed, inventory_confirmed: inventoryConfirmed };
  }
  function applyObservations(next: SceneObject[]) {
    if (next.length > 12 && next.length >= observed.length) { setError('The planner supports 12 objects. Review duplicate detections before applying.'); return; }
    setObserved(next); setReviewed([]); setVerification(null); setVisualStale(true); setInventoryConfirmed(false); setSelected(next[0]?.id ?? null); setCompare('after'); setShowBoxes(true);
  }
  async function automaticVerification() {
    if (!snapshot || !finalImage) return;
    if(busy||requestLock.current)return;requestLock.current=true;
    setBusy('SAM is detecting final positions and checking identities…'); setError(null); setVerification(null); setVisualResult(null);
    try {
      const manualExtras = observed.filter(o => !snapshot.objects.some(original => original.id === o.id) && !o.id.startsWith('extra:'));
      const result = await automaticVerify({ plan_request: snapshot, original_request: originalSnapshot ?? snapshot, image_url: finalImage.image_url, before_image_url: image.image_url.startsWith('data:') ? image.image_url : undefined, framing_confirmed: framingConfirmed, inventory_confirmed: inventoryConfirmed && !manualExtras.length });
      setVisualResult(result); setVisualStale(false); if (result.review_required) setInventoryConfirmed(false);
      const mapped = snapshot.objects.map(original => result.observed_objects.find(o => o.id === original.id) ?? { ...original, source: 'manual' as const, confidence: null });
      const extras = result.observed_objects.filter(o => !snapshot.objects.some(original => original.id === o.id));
      setObserved([...mapped, ...extras, ...manualExtras]); setReviewed([]); setCompare('after'); setShowBoxes(true);
      if (result.passed) setVerification({ source: result.source ?? 'sam_after_photo', passed: true, message: result.message, matched_count: result.matched_count, issues: result.issues, objects: result.objects.map(row => ({ ...row, edge_error: row.edge_error ?? 1 })) });
    } catch (error) { setError(getError(error)); }
    finally { requestLock.current=false;setBusy(null); }
  }
  async function replan() {
    if (!snapshot || !finalImage) return;
    if(busy||requestLock.current)return;requestLock.current=true;
    setBusy('Replanning from reviewed current positions…'); setError(null);
    try {
      const result = await replanScene(reviewedState()); setRevision(result);
      if (result.revised_plan && result.plan_request) {
        setPlan(result.revised_plan); setSnapshot(result.plan_request); setObjects(result.plan_request.objects); setImage(finalImage);
        setFinalImage(null); setObserved([]); setReviewed([]); setVerification(null); setVisualResult(null); setVisualStale(false); setStage('plan');
        setActiveMove(0); if (demo) setDemoStep(3);
      }
    } catch (error) { setError(getError(error)); }
    finally { requestLock.current=false;setBusy(null); }
  }
  function reset() {
    invalidate(); setEvidence(null); setDemoStep(0); setImage(SAMPLE_IMAGE); setObjects(copyObjects()); setTarget(SAMPLE_TARGET); setWorkspace(FULL); setGoal('Make room for my laptop without moving my coffee.'); setSelected('notebook'); setStage('annotate'); setTool('select'); setShowBoxes(true);
  }
  function exportPlan() {
    void exportJSON({ app: 'WorldOS', version: '0.6.0', annotation_source: hasAIObjects ? 'ai_and_user_review' : 'manual', original_request: originalSnapshot, request: snapshot, plan, revision, verification, visual_verification: visualResult, visual_result_stale: visualStale, observed_objects: finalImage ? observed : null, reviewed_ids: reviewed, framing_confirmed: framingConfirmed, inventory_confirmed: inventoryConfirmed, inference_evidence: evidence ? { analysis: evidence.analysis, reasoning: evidence.reasoning, historical: evidence.historical } : null }, 'worldos-plan.json').catch(error=>setError(getError(error)));
  }
  function nav(next: Stage) { if (busy) return; setStage(next); setTool('select'); setError(null); }
  function demoNavigate(next: number) {
    setDemoStep(next);
    if (next <= 1) nav('annotate');
    else if (next <= 3 && plan) nav('plan');
    else if (next >= 4 && feasible) { nav('verify'); setCompare('split'); }
  }
  function canvas(final = false, readonly = false) {
    return <Canvas disabled={!!busy} image={final ? finalImage! : image} objects={final ? observed : objects} target={target} workspace={workspace} tool={tool} selected={selected} onSelect={setSelected} onObjects={updateObjects} onTarget={box => { invalidate(); setTarget(box); setTool('select'); }} onWorkspace={box => { invalidate(); setWorkspace(box); setTool('select'); }} onAdd={addObject} plan={readonly ? null : plan} mode={readonly ? 'plan' : final ? 'final' : stage === 'plan' ? 'plan' : 'annotate'} showBoxes={showBoxes} activeMovement={demo && demoStep === 3 ? activeMove + 1 : undefined} placementStatuses={final ? Object.fromEntries(verification ? verification.objects.map(row => [row.object_id, row.matched ? 'completed' : 'incomplete']) : visualResult && !visualStale ? visualResult.objects.map(row => [row.object_id, row.status]) : []) : {}}/>;
  }

  return <div className="app-shell">
    <aside className="rail" aria-label="Main navigation">
      <a className="logo-mark" href="#" aria-label="WorldOS home" onClick={event => { event.preventDefault(); nav('annotate'); }}><Layers3 size={26}/></a>
      <div className="rail-line"/>
      <button className="rail-button active" title="Spatial workspace" aria-label="Spatial workspace" onClick={() => nav('annotate')}><ScanLine size={21}/></button>
      <button className="rail-button" title="How WorldOS works" aria-label="How WorldOS works" onClick={() => setHelp(true)}><CircleHelp size={21}/></button>
      <div className="rail-bottom"><span className="version-vertical">V0.6</span><div className="avatar">W</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><a href="#" className="wordmark" onClick={e => { e.preventDefault(); nav('annotate'); }}>world<span>os</span><span className="beta">LABS</span></a><div className="breadcrumbs"><span>Personal workspace</span><ChevronRight size={13}/><strong>Spatial studio</strong></div><div className={`api-status ${online === false ? 'offline' : ''}`}><i/>{online === null ? 'Connecting' : online ? 'Local engine online' : 'API offline'}</div><button className="top-help demo-toggle" aria-pressed={demo} disabled={!!busy} onClick={() => setDemo(!demo)}>{demo ? 'Exit Demo Mode' : 'Demo Mode'}</button><button className="top-help" onClick={() => setHelp(true)}>Quick guide <ArrowUpRight size={13}/></button></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span/> THE SPATIAL INTELLIGENCE WORKSPACE</div><h1>Your space, reimagined<span>.</span></h1><p>A photo. A goal. A clear way forward.</p></div><button className="secondary reset" onClick={reset} disabled={!!busy}><RotateCcw size={15}/> Reset sample</button></div>
        <div className="workflow" aria-label="Workflow steps">{STAGES.map((s, i) => <button key={s} className={`workflow-step ${stage === s ? 'current' : ''} ${i < STAGES.indexOf(stage) ? 'complete' : ''}`} disabled={!!busy || (s === 'plan' && !plan) || (s === 'verify' && !feasible)} onClick={() => nav(s)}><span className="step-number">{i < STAGES.indexOf(stage) ? <Check size={14}/> : `0${i + 1}`}</span><span>{labels[i]}</span>{i < 2 && <ChevronRight className="step-chevron" size={15}/>}</button>)}<div className="workflow-note"><ShieldCheck size={14}/> You stay in control</div></div>
        {demo && <DemoMode step={demoStep} onStep={demoNavigate} busy={!!busy} sample={isSample && !revision} plan={plan} verification={verification} visual={visualResult} stale={visualStale} evidence={evidence} before={originalImage ?? image} after={finalImage ?? (revision && originalImage?.image_url !== image.image_url ? image : null)} activeMove={activeMove} onMove={setActiveMove} revisionReasons={revision?.reasons ?? []}/>}
        {error && <div className="error-banner" role="alert"><CircleHelp size={18}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={16}/></button></div>}
        {online === false && <div className="connection-note">Start the backend to upload photos, plan, and verify. <code>.venv\Scripts\python.exe -m uvicorn backend.main:app --reload</code></div>}
        <div className="studio-grid">
          <section className="scene-column">
            <div className="panel scene-panel">
              <div className="panel-title"><div className="flex items-center gap-3"><span className="tiny-icon"><ScanLine size={17}/></span><h2>{stage === 'verify' ? 'Compare your results' : 'Scene workspace'}</h2><span className="subtle-badge">{stage === 'verify' && visualResult ? 'SAM FINAL POSITIONS' : stage === 'plan' ? 'MOVEMENT PLAN' : hasAIObjects && stage !== 'verify' ? 'AI ANNOTATIONS · REVIEW' : 'MANUAL ANNOTATION'}</span></div><button className="icon-button" aria-label={showBoxes ? 'Hide annotations' : 'Show annotations'} title={showBoxes ? 'Hide annotations' : 'Show annotations'} onClick={() => setShowBoxes(!showBoxes)}>{showBoxes ? <Eye size={16}/> : <EyeOff size={16}/>}</button></div>
              <div className="canvas-toolbar"><div className="tool-group">{stage === 'annotate' ? <>
                <button aria-label="Select and move annotations" title="Select and drag a box; use its bottom-right handle to resize" className={tool === 'select' ? 'selected' : ''} disabled={!!busy} onClick={() => { setTool('select'); setShowBoxes(true); }}><MousePointer2 size={16}/><span>Select</span></button>
                <button aria-label="Draw object" className={tool === 'object' ? 'selected' : ''} disabled={!!busy} onClick={() => { setTool('object'); setShowBoxes(true); }}><BoxIcon size={16}/><span>Object</span></button><span className="tool-divider"/>
                <button aria-label="Draw target region" className={tool === 'target' ? 'selected' : ''} disabled={!!busy} onClick={() => setTool('target')}><Focus size={16}/><span>Target</span></button>
                <button aria-label="Draw workspace boundary" title="Restrict placements to a flat usable surface" className={tool === 'workspace' ? 'selected' : ''} disabled={!!busy} onClick={() => setTool('workspace')}><SquareDashed size={16}/><span>Surface</span></button>
              </> : stage === 'verify' && finalImage ? <><button aria-label="Draw final obstacle" className={tool === 'object' ? 'selected' : ''} disabled={!!busy} onClick={() => { setTool(tool === 'object' ? 'select' : 'object'); setCompare('after'); setShowBoxes(true); }}><Plus size={14}/>Obstacle</button><div className="comparison-controls">{(['before', 'after', 'split'] as const).map(value => <button key={value} className={compare === value ? 'selected' : ''} onClick={() => setCompare(value)}>{value === 'split' ? 'Side by side' : value === 'before' ? 'Before' : 'After'}</button>)}</div></> : <span className="toolbar-caption"><Crosshair size={15}/>{stage === 'plan' ? 'Follow the numbered arrows' : 'Upload a final photo to compare'}</span>}</div>
              <PhotoActions label={stage==='verify'?'Final photo':'Upload photo'} cameraLabel={stage==='verify'?'Take final photo':'Take scene photo'} disabled={!!busy||stage==='plan'} onPhoto={file=>upload(file,stage==='verify')}/></div>
              <div className={`canvas-area ${busy ? 'is-busy' : ''}`} onDragOver={e => { if (stage !== 'plan' && !busy) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!busy && stage !== 'plan') void upload(e.dataTransfer.files[0], stage === 'verify'); }}>
                {stage === 'verify' ? finalImage ? compare === 'split' ? <div className="split-scenes"><div><span className="image-tag">BEFORE</span>{canvas(false, true)}</div><div><span className="image-tag">AFTER · EDIT BOXES</span>{canvas(true)}</div></div> : <>{canvas(compare === 'after', compare === 'before')}<span className="image-tag">{compare === 'after' ? 'AFTER · REVIEW FINAL POSITIONS' : 'BEFORE'}</span></> : <div className="final-empty"><div className="upload-symbol"><ImagePlus size={32}/></div><h3>Let’s see what changed.</h3><p>Take a photo after following the plan.<br/>Use the same camera angle and framing.</p><PhotoActions label="Upload final photo" cameraLabel="Take final photo" disabled={!!busy} onPhoto={file=>upload(file,true)}/><span>JPEG, PNG or WebP · optimized for mobile</span></div> : <>{canvas()}<span className="image-tag">{isSample ? 'ILLUSTRATED SAMPLE' : 'YOUR SCENE'}</span></>}
                {busy && <div className="loading-overlay"><OperationStatus key={busy} message={busy}/></div>}
              </div>
              <div className="canvas-footer"><div className="flex items-center gap-2"><span className="file-dot"/>{stage === 'verify' && finalImage ? finalImage.name : image.name}<span className="image-dimensions">{image.width} × {image.height}</span></div><div className="legend"><span><i className="blue"/>Object</span><span><i className="amber"/>Locked</span><span><i className="lime"/>Target</span></div></div>
            </div>
            <div className="canvas-tip"><MousePointer2 size={14}/>{stage === 'annotate' ? tool === 'select' ? 'Drag a box to reposition it. Resize from its bottom-right corner. Locks protect objects during planning.' : `Click and drag on the image to draw ${tool === 'object' ? 'an object box' : tool === 'target' ? 'the area you want to clear' : 'the usable surface'}.` : stage === 'plan' ? 'Arrows show lift-and-place movements. Dashed boxes mark destinations; the photo remains your original.' : 'Adjust each box to the observed object in your final photo, then confirm every annotation.'}</div>
            <section className="panel goal-panel"><div className="section-kicker"><Sparkles size={16}/> THE INTENTION</div><label htmlFor="goal">What would you like to make space for?</label><div className="goal-input"><textarea id="goal" aria-label="Your spatial goal" value={goal} maxLength={1000} disabled={stage !== 'annotate' || !!busy} onChange={e => { invalidate(); setGoal(e.target.value); }} rows={2}/><span><ArrowUpRight size={20}/></span></div><div className="goal-footer"><span><LockKeyhole size={12}/> Mention “without moving” + an object’s exact label to protect it.</span><span>{goal.length}/1000</span></div><div className="goal-explanation">The target box sets the space to clear. {constraints ? 'Reviewed Muse Spark constraints are applied. Editing the scene or goal clears them.' : 'Use deterministic label matching or review a Muse Spark interpretation in AI assistance.'}</div></section>
            <div className="trust-strip"><span><ShieldCheck size={15}/> Collision-aware placement</span><span><LockKeyhole size={14}/> Locked objects respected</span><span><Maximize size={14}/> Resize-safe coordinates</span></div>
          </section>
          <aside className="details-column">
            {revision && stage === 'plan' && <section className="panel visual-body"><h2>Original plan versus revised plan</h2><p>Original plan: {revision.original_plan.movements.length} moves / Revised plan: {revision.revised_plan?.movements.length ?? 0} moves / {revision.status}</p><ul>{revision.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul><details><summary>Compare movement sequences</summary><p>Original</p><ol>{revision.original_plan.movements.map(s => <li key={s.number}>{s.instruction}</li>)}</ol><p>Revised</p><ol>{revision.revised_plan?.movements.map(s => <li key={s.number}>{s.instruction}</li>)}</ol>{originalImage && <img src={originalImage.image_url} alt="Original scene before any replanning" className="revision-original"/>}</details><p>The canvas shows updated arrows from the latest reviewed scene. Original goal and protective anchors are retained.</p></section>}
            {stage === 'annotate' && <><AIPanel onInference={next => setEvidence(previous => ({ ...(previous?.imageUrl === next.imageUrl ? previous : {}), ...next, historical: false }))} image={image} isSample={isSample} objects={objects} target={target} goal={goal} busy={busy} capabilities={aiCapabilities} constraints={constraints} onBusy={setBusy} onError={setError} onAnnotations={next => { updateObjects(next); setSelected(next[0]?.id ?? null); setTool('select'); setShowBoxes(true); }} onConstraints={value => { setPlan(null); setSnapshot(null); setConstraints(value); setError(null); }}/>{hasAIObjects && <label className="ai-scene-review"><input type="checkbox" aria-label="I reviewed all AI annotations and added missed obstacles" disabled={!!busy} checked={aiReviewed} onChange={e => setAIReviewed(e.target.checked)}/>I reviewed all AI annotations, corrected boxes and labels, and added missed obstacles.</label>}</>}
            {stage === 'annotate' ? <>
              <section className="panel objects-panel"><div className="panel-title"><div className="flex items-center gap-2"><h2>Scene objects</h2><span className="count-badge">{objects.length.toString().padStart(2, '0')}</span></div><button className="icon-button" title="Draw a new object" aria-label="Add object" disabled={!!busy || objects.length >= 12} onClick={() => { setTool('object'); setShowBoxes(true); }}><Plus size={17}/></button></div><div className="manual-note"><span className="status-dot"/> {hasAIObjects ? 'AI + user annotations' : 'Manually annotated'} <span>{hasAIObjects ? 'Review required' : 'Manual mode'}</span></div>
                <fieldset disabled={!!busy} className="object-list">{objects.length === 0 ? <div className="empty-objects"><BoxIcon size={24}/><p>Every object starts with a box.</p><span>Draw tight, non-overlapping rectangles around objects on your surface. Include everything that could obstruct a move.</span></div> : objects.map((obj, i) => <div key={obj.id} className={`object-row ${selected === obj.id ? 'chosen' : ''}`}><button className="object-select" onClick={() => { setSelected(obj.id); setTool('select'); setShowBoxes(true); }}><span className={`object-number ${obj.locked ? 'protected' : ''}`}>{`0${i + 1}`}</span><span className="object-copy"><strong>{obj.label || 'Unnamed object'}</strong><small>{obj.source === 'sam_3_1' ? `SAM 3.1 · ${obj.confidence == null ? 'confidence unavailable' : `${(obj.confidence * 100).toFixed(1)}%`}` : obj.source === 'ai_corrected' ? 'User corrected · confidence cleared' : obj.locked ? 'Protected from movement' : 'Available to move'}</small></span></button><button aria-label={`${obj.locked ? 'Unlock' : 'Lock'} ${obj.label}`} title={obj.locked ? 'Unlock object for planning' : 'Protect object from movement'} className={`lock-button ${obj.locked ? 'locked' : ''}`} onClick={() => updateObjects(objects.map(o => o.id === obj.id ? { ...o, locked: !o.locked } : o))}>{obj.locked ? <LockKeyhole size={15}/> : <UnlockKeyhole size={15}/>}</button></div>)}</fieldset>
                {activeObject && <fieldset className="object-editor" disabled={!!busy}><div className="editor-heading"><span>EDIT ANNOTATION</span><button className="icon-button danger" aria-label={`Delete ${activeObject.label}`} onClick={() => { updateObjects(objects.filter(o => o.id !== selected)); setSelected(null); }}><Trash2 size={14}/></button></div><label htmlFor="object-label">Object label</label><input id="object-label" value={activeObject.label} maxLength={80} onChange={e => updateObjects(objects.map(o => o.id === selected ? { ...o, label: e.target.value } : o))}/><div className="coordinate-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key === 'x' ? 'Left' : key === 'y' ? 'Top' : key === 'width' ? 'Width' : 'Height'}<div><input aria-label={`${key} percent`} type="number" step="0.1" min="0" max="100" value={Number((activeObject.box[key] * 100).toFixed(2))} onChange={e => updateCoordinate(key, Number(e.target.value))}/><span>%</span></div></label>)}</div></fieldset>}
                <div className="objects-footnote"><ScanLine size={13}/> {objects.length}/12 objects · {lockedCount} locked</div>
              </section>
              <section className={`panel target-panel ${target ? 'has-target' : ''}`}><div className="target-icon"><Focus size={22}/></div><div><h3>{target ? 'A space for what’s next' : 'Where should we make room?'}</h3><p>{target ? `${Math.round(target.width * 100)}% wide × ${Math.round(target.height * 100)}% tall · target region` : 'Draw the area you want to keep clear.'}</p><button disabled={!!busy} onClick={() => setTool('target')}>{target ? 'Redraw target' : 'Select target'} <ArrowRight size={12}/></button></div></section>
              <div className="surface-note"><SquareDashed size={14}/><span>{workspace.width === 1 && workspace.height === 1 ? 'Full image is the usable surface.' : 'Custom surface boundary selected.'} <button disabled={!!busy} onClick={() => { invalidate(); setWorkspace(FULL); }}>Reset surface</button></span></div>
              <button className="primary generate" disabled={!!busy || !target || !objects.length || !goal.trim() || (hasAIObjects && !aiReviewed)} onClick={() => void generate()}>{busy ? <LoaderCircle className="spin" size={17}/> : <Sparkles size={17}/>} Generate spatial plan <ArrowRight size={17}/></button><p className="action-note">A real plan, calculated from your annotations.</p>
            </> : stage === 'plan' && plan ? <>
              <section className="panel plan-panel"><div className="panel-title"><div className="flex items-center gap-2"><h2>Your movement plan</h2><span className="count-badge">{plan.movements.length.toString().padStart(2, '0')}</span></div><button className="icon-button" title="Export plan JSON" aria-label="Export plan" onClick={exportPlan}><ArrowDownToLine size={16}/></button></div><div className={`plan-status ${feasible ? 'success' : 'failure'}`}><span>{feasible ? <CheckCheck size={20}/> : <CircleHelp size={20}/>}</span><div><strong>{plan.status === 'already_clear' ? 'You already have room' : feasible ? 'Room for your next idea' : plan.status === 'impossible' ? 'This layout is impossible' : 'No layout found yet'}</strong><p>{plan.message}</p></div></div><ol className="movement-list">{plan.movements.map(move => <li key={move.number}><span className="movement-number">{move.number}</span><div><h3>Move {move.label}</h3><p>{move.instruction}</p><span className="movement-coords">{Math.round(move.source.x * 100)}%, {Math.round(move.source.y * 100)}% <ArrowRight size={12}/> {Math.round(move.destination.x * 100)}%, {Math.round(move.destination.y * 100)}%</span></div></li>)}</ol><div className="plan-locks"><LockKeyhole size={14}/>{plan.locked_ids.length ? `Protected: ${objects.filter(o => plan.locked_ids.includes(o.id)).map(o => o.label).join(', ')}` : 'No objects are locked'}</div></section>
              <section className="panel model-note"><ShieldCheck size={21}/><div><h3>Move with a little care.</h3><p>Lift each object, then place it in its numbered box. This plan checks 2D footprints; it cannot assess height, balance, or a safe travel path.</p></div></section><button className="primary generate" disabled={!feasible || !!busy} onClick={() => nav('verify')}>I’ve made the moves <ArrowRight size={17}/></button><button className="text-button" onClick={() => nav('annotate')}><ArrowLeft size={14}/> Adjust scene & goal</button><div className="engine-meta">Deterministic engine · {plan.explored_states} search states<br/>{snapshot?.constraints ? 'Reviewed Muse Spark constraints' : 'Deterministic goal rules'} · {hasAIObjects ? 'SAM annotations, user reviewed' : 'Manual annotations'}</div>
            </> : <>
              {finalImage && <VisualVerificationPanel key={finalImage.image_url} result={visualResult} originals={snapshot!.objects} busy={!!busy} stale={visualStale} onVerify={() => void automaticVerification()} onApply={next => applyObservations([...next, ...observed.filter(o => !snapshot!.objects.some(original => original.id === o.id) && !o.id.startsWith('extra:') && !next.some(n => n.id === o.id))])}/>}
              <section className="panel verify-panel"><div className="panel-title"><h2>Check the result</h2><span className="subtle-badge">REVIEWED EVIDENCE</span></div><div className="verify-intro"><ShieldCheck size={24}/><h3>Real changes. Measured.</h3><p>Upload your final photo. Run Automatic Verify or locate each object manually. Starting boxes are editing placeholders until detected or confirmed.</p></div>{finalImage && <><fieldset disabled={!!busy} className="review-list">{observed.map(obj => <div className={`review-row ${selected === obj.id ? 'chosen' : ''}`} key={obj.id}><button className="review-select" onClick={() => { setSelected(obj.id); setCompare('after'); setShowBoxes(true); }}>{obj.label}{verification && <small className={verification.objects.find(o => o.object_id === obj.id)?.matched ? 'match' : 'mismatch'}>{verification.objects.find(o => o.object_id === obj.id)?.matched ? 'Matched' : 'Adjust position'}</small>}</button><input type="checkbox" aria-label={`Confirm final ${obj.label} position`} checked={reviewed.includes(obj.id)} onChange={e => { setReviewed(e.target.checked ? [...reviewed, obj.id] : reviewed.filter(id => id !== obj.id)); setVerification(null); setVisualStale(true); }}/></div>)}</fieldset>{activeObject && <fieldset className="final-coordinate-editor" disabled={!!busy}><span className="editor-heading">{activeObject.label} · FINAL POSITION</span><div className="coordinate-fields">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{key}<div><input type="number" aria-label={`Final ${key} percent`} step="0.1" min="0" max="100" value={Number((activeObject.box[key] * 100).toFixed(2))} onChange={e => updateCoordinate(key, Number(e.target.value))}/><span>%</span></div></label>)}</div></fieldset>}<p className="review-count">{reviewed.length} of {observed.length} final annotations confirmed</p></>}</section>
              {finalImage && <section className="panel visual-body"><label className="visual-check"><input type="checkbox" aria-label="Same camera framing confirmed" checked={framingConfirmed} disabled={!!busy} onChange={e => { setFramingConfirmed(e.target.checked); setVisualStale(true); setVerification(null); }}/>I checked the same camera angle, scale, and framing.</label><label className="visual-check"><input type="checkbox" aria-label="Complete current obstacle inventory confirmed" checked={inventoryConfirmed} disabled={!!busy} onChange={e => { setInventoryConfirmed(e.target.checked); setVisualStale(true); setVerification(null); }}/>I checked all obstacles, corrected missing boxes, and reviewed unmatched detections.</label><p>Camera motion is not automatically registered. For manual fallback, locate every original identity before confirming. Remove added false positives below; draw missed obstacles with the Obstacle tool above the after-photo.</p>{observed.filter(o => !snapshot!.objects.some(original => original.id === o.id)).map(o => <button className="text-button" key={o.id} disabled={!!busy} onClick={() => { applyObservations(observed.filter(item => item.id !== o.id)); setInventoryConfirmed(false); }}>Remove false-positive obstacle: {o.label}</button>)}</section>}
              {revision?.status === 'blocked' && <div className="verification-result needs-work" role="status">{revision.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>}
              {verification && <section className={`verification-result ${verification.passed ? 'passed' : 'needs-work'}`} role="status"><div>{verification.passed ? <CheckCheck size={23}/> : <Focus size={23}/>}<h3>{verification.passed ? 'Space, successfully made.' : 'A few things need adjusting.'}</h3></div><p>{verification.message}</p><span>{verification.matched_count}/{snapshot?.objects.length} objects match · {visualResult && !visualStale && !reviewed.length ? 'SAM detection evidence' : 'reviewed annotation evidence'}</span>{verification.issues.length > 0 && <ul>{verification.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}</section>}
              <button className="primary generate" disabled={!!busy || !finalImage || reviewed.length !== observed.length} onClick={() => void verify()}>{busy ? <LoaderCircle className="spin" size={17}/> : <ShieldCheck size={17}/>} Verify placements <ArrowRight size={17}/></button>{finalImage && <button className="secondary full-width" disabled={!!busy || reviewed.length !== observed.length || !framingConfirmed || !inventoryConfirmed} onClick={() => void replan()}>Replan from Current State</button>}{verification && <button className="secondary full-width" onClick={exportPlan}><Download size={15}/> Download result</button>}<button className="text-button" onClick={() => nav('plan')}><ArrowLeft size={14}/> Back to movement plan</button><div className="engine-meta">Placement tolerance: 2.5% of image edges.<br/>Locked objects: 1%. Use matching camera framing.<br/>SAM checks photo pixels; manual mode checks reviewed boxes. Identity thresholds are conservative heuristics.</div>
            </>}
          </aside>
        </div>
        <footer className="page-footer"><span className="footer-wordmark"><Layers3 size={14}/> WORLDOS <span>Think spatially. Act intentionally.</span></span><span>Built for the Meta Global AI Developer Hackathon 2026 <span className="footer-dot">·</span> Indie Developer Track</span></footer>
      </main>
    </div>
    <input className="hidden" ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload scene image" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }}/>
    <input className="hidden" ref={afterInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload final image" onChange={e => { void upload(e.target.files?.[0], true); e.target.value = ''; }}/>
    <Dialog open={help} onClose={()=>setHelp(false)} title="Quick guide"><div className="guide-content"><span className="section-kicker"><Layers3 size={18}/> WORLDOS QUICK GUIDE</span><h2 id="guide-title">From clutter to clarity.</h2><ol><li><strong>Understand your space.</strong> Upload a photo of a flat surface. Draw non-overlapping object boxes, label every obstacle, and lock anything that should stay. Draw a surface boundary if the full image isn’t usable.</li><li><strong>Make room.</strong> Draw the target area and describe your goal. Generate a plan, then follow the numbered lift-and-place movements. Check goal-inferred locks in the plan.</li><li><strong>Close the loop.</strong> Take a final photo from the same angle. Run Automatic Verify or locate objects manually. Review uncertain identities and final boxes, then verify placements or replan from the current state. Protected objects keep their original anchors.</li></ol><p>The included desk is a hand-annotated illustration for exploring the real planner. AI assistance is opt-in and uses configured providers. SAM requires object concepts; Muse Spark can discover them. Check AI assistance for configuration status. Manual mode makes no model calls.</p><button className="primary full-width" onClick={() => setHelp(false)}>Let’s make some space <ArrowRight size={16}/></button></div></Dialog>
  </div>;
}
