import { useState } from 'react';
import { inferenceEvidence } from './inferenceEvidence';
import type { AIAnalysis, Plan, Reasoning, SceneImage, Verification, VisualVerification } from './types';

export const DEMO_STEPS = ['Scan', 'Understand', 'Plan', 'Guide', 'Verify', 'Adapt'] as const;
export interface DemoEvidence { analysis?: AIAnalysis; reasoning?: Reasoning; imageUrl: string; historical?: boolean }
interface Props {
  step: number; onStep: (step: number) => void; busy: boolean; sample: boolean;
  plan: Plan | null; verification: Verification | null; visual: VisualVerification | null; stale: boolean;
  evidence: DemoEvidence | null; before: SceneImage; after: SceneImage | null;
  activeMove: number; onMove: (index: number) => void; revisionReasons: string[];
}
const prompts = [
  'Upload a real, overhead photo. Keep the camera fixed for the after-photo. Uploading prepares the image locally.',
  'Run AI Analysis, inspect the Meta SAM 3.1 boxes and confidence, then correct the complete inventory. Ask Muse Spark to interpret your goal and review its constraints.',
  'Draw a target, lock protected objects, and generate a spatial plan. Destinations are checked against occupied footprints in movement order.',
  'Follow each numbered lift-and-place instruction in order. The animation illustrates the instruction; it does not track physical execution.',
  'Take and upload a separate after-photo. Compare both images, confirm camera framing and inventory, then run Automatic Verify. Unresolved identities require review.',
  'For an incomplete result, locate and confirm every current identity, then Replan from Current State. Restore displaced protected objects first. Verify a new after-photo to close the loop.',
];

export default function DemoMode(props: Props) {
  const [intro, setIntro] = useState(true);
  const { step, plan, verification, evidence } = props;
  const source = verification?.source === 'sam_after_photo' ? 'Automatic SAM evidence with scene confirmations'
    : verification ? 'User-reviewed annotation evidence' : 'No final verification yet';
  return <section className="demo-panel panel" aria-label="WorldOS Demo Mode">
    <div className="demo-heading"><span className="section-kicker">WORLDOS V1.1 · DEMO MODE</span><span className="subtle-badge">{props.sample ? 'ILLUSTRATED SAMPLE · MANUAL BOXES' : 'YOUR PHOTO · EXPLICIT AI ACTIONS'}</span></div>
    {intro ? <div className="demo-intro"><h2>A photo becomes a plan you can act on.</h2><p>WorldOS uses Meta AI to understand objects and goals, computes spatial movements, and checks a real after-photo. You review uncertainty and adapt the plan when reality changes.</p><p>Success appears only after verification. Model results below come from explicit inference requests; the sample illustration has manual annotations.</p><button className="primary" disabled={props.busy} onClick={() => { setIntro(false); props.onStep(0); }}>Begin walkthrough</button></div> : <>
      <nav className="demo-sequence" aria-label="Demo sequence">{DEMO_STEPS.map((label, index) => <button key={label} aria-current={step === index ? 'step' : undefined} disabled={props.busy} onClick={() => props.onStep(index)}><span>{index + 1}</span>{label}</button>)}</nav>
      <div className="demo-content"><div><h2>{String(step+1).padStart(2, '0')} / {DEMO_STEPS[step]}</h2><p>{prompts[step]}</p>
        {step === 2 && plan && <p role="status">{plan.message} Protected objects: {plan.locked_ids.length}. Planned movements: {plan.movements.length}.</p>}
        {step === 3 && (plan?.movements.length ? <div className="demo-move"><strong>Movement {props.activeMove+1} of {plan.movements.length}: {plan.movements[props.activeMove]?.label}</strong><p>{plan.movements[props.activeMove]?.instruction}</p><button className="secondary" disabled={props.busy || props.activeMove === 0} onClick={() => props.onMove(props.activeMove-1)}>Previous movement</button><button className="secondary" disabled={props.busy || props.activeMove >= plan.movements.length-1} onClick={() => props.onMove(props.activeMove+1)}>Next movement</button></div> : <p>Generate a feasible movement plan to show instructions.</p>)}
        {step === 5 && props.revisionReasons.length > 0 && <ul>{props.revisionReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
        <div className="demo-controls"><button className="text-button" disabled={props.busy || step === 0} onClick={() => props.onStep(step-1)}>Previous stage</button><button className="secondary" disabled={props.busy || step === 5} onClick={() => props.onStep(step+1)}>Next stage</button></div>
      </div><aside className="demo-evidence"><strong>Meta AI inference evidence</strong>{evidence?.historical && <p>Historical inference: scene or goal was edited. Current planning uses the reviewed annotations and constraints.</p>}
        {evidence?.analysis ? <><p>{evidence.analysis.provider} / {evidence.analysis.model} · {evidence.analysis.objects.length} detections · {inferenceEvidence(evidence.analysis)}</p><p>{evidence.analysis.summary}</p><details><summary>Inspect SAM outputs</summary><ul>{evidence.analysis.objects.map(o => <li key={o.id}>{o.label}: {o.confidence == null ? 'confidence unavailable' : `${(o.confidence*100).toFixed(1)}%`} · box {[o.box.x, o.box.y, o.box.width, o.box.height].map(n => `${(n*100).toFixed(1)}%`).join(', ')}</li>)}</ul></details></> : <p>No scene-analysis result in this session. Use AI Analysis under Understand.</p>}
        {evidence?.reasoning && <p>{evidence.reasoning.model}: {evidence.reasoning.constraints.summary}</p>}
        {props.visual && <p>After-photo SAM: {props.stale ? 'Historical evidence; review changes' : props.visual.status} · {props.visual.matched_count}/{props.visual.objects.length} placements match · {(props.visual.latency_ms/1000).toFixed(1)}s · {inferenceEvidence(props.visual)}</p>}
      </aside></div>
      {(step === 4 || step === 5) && props.after && <div className="demo-comparison"><figure><img src={props.before.image_url} alt="Demo original before photograph"/><figcaption>Before · {props.before.name}</figcaption></figure><figure><img src={props.after.image_url} alt="Demo actual after photograph"/><figcaption>After · {props.after.name}</figcaption></figure></div>}
      <div className={`demo-summary ${verification?.passed ? 'is-verified' : ''}`} role="status"><strong>{verification?.passed ? 'Task verified' : props.visual?.review_required && !props.stale ? 'Identity / scene review required' : 'Task awaiting verification'}</strong><span>{verification ? `${verification.matched_count}/${verification.objects.length} original placements match. ${verification.message}` : 'No completed physical actions are assumed.'} {source}.</span></div>
    </>}
  </section>;
}
