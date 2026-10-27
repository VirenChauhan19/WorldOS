import { useEffect, useState } from 'react';
import { Check, LoaderCircle, ScanLine, Sparkles } from 'lucide-react';
import { analyzeAI, reasonAI } from './api';
import ConnectionStatus from './ConnectionStatus';
import type { AICapabilities, AIAnalysis, Box, PlanningConstraints, Reasoning, SceneImage, SceneObject } from './types';

interface Props {
  image: SceneImage; isSample: boolean; objects: SceneObject[]; target: Box | null; goal: string;
  busy: string | null; capabilities?: AICapabilities; constraints: PlanningConstraints | null;
  onBusy: (value: string | null) => void; onError: (value: string | null) => void;
  onAnnotations: (objects: SceneObject[]) => void; onConstraints: (constraints: PlanningConstraints | null) => void;
  onInference?: (result: { analysis?: AIAnalysis; reasoning?: Reasoning; imageUrl: string }) => void;
}
export default function AIPanel({ image, isSample, objects, target, goal, busy, constraints, onBusy, onError, onAnnotations, onConstraints, onInference }: Props) {
  const [concepts, setConcepts] = useState('');
  const [draft, setDraft] = useState<Reasoning | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  useEffect(() => { setDraft(null); setReplace(false); }, [objects, goal, image, target]);
  useEffect(() => { setNotice(null); }, [image]);
  const message = (e: unknown) => e instanceof Error ? e.message : 'AI request failed. Manual mode remains available.';
  async function detect() {
    onBusy(concepts.trim() ? 'SAM is segmenting the requested concepts…' : 'Muse Spark is identifying concepts; SAM will segment each one…'); onError(null); setNotice(null);
    try {
      const phrases = concepts.split(',').map(s => s.trim()).filter(Boolean);
      if (phrases.length > 12) throw new Error('Use at most 12 noun phrases.');
      const result = await analyzeAI(image.image_url, phrases);
      onAnnotations(result.objects);
      onInference?.({ analysis: result, imageUrl: image.image_url });
      setNotice(`${result.message} ${result.warnings.join(' ')}`);
    } catch (e) { onError(message(e)); }
    finally { onBusy(null); }
  }
  async function reason() {
    onBusy('Muse Spark is interpreting your goal…'); onError(null); setDraft(null);
    try { const result = await reasonAI(objects, goal, target, isSample ? undefined : image.image_url); setDraft(result); onInference?.({ reasoning: result, imageUrl: image.image_url }); }
    catch (e) { onError(message(e)); }
    finally { onBusy(null); }
  }
  return <section className="panel ai-panel" aria-label="AI assistance">
    <div className="panel-title"><h2><Sparkles size={15}/> AI assistance</h2><span className="subtle-badge">V1.1 · REVIEW REQUIRED</span></div>
    <div className="ai-body"><ConnectionStatus busy={busy} onBusy={onBusy}/>
      <label htmlFor="sam-concepts">Object concepts <span>optional</span></label><input id="sam-concepts" aria-label="SAM object concepts" placeholder="coffee cup, notebook, headphones" value={concepts} maxLength={900} disabled={!!busy} onChange={e => setConcepts(e.target.value)}/>
      <p className="ai-help">One short noun phrase per comma-separated entry. Leave blank for Muse Spark to discover concepts. SAM sends one request per concept.</p>
      {objects.length > 0 && <label className="ai-replace"><input type="checkbox" aria-label="Replace existing annotations with AI results" checked={replace} disabled={!!busy} onChange={e => setReplace(e.target.checked)}/>Replace existing annotations with AI results</label>}
      <button className="secondary full-width" disabled={!!busy || isSample || (objects.length > 0 && !replace)} onClick={() => void detect()}><ScanLine size={15}/> AI Analysis</button>
      {isSample && <p className="ai-help">Upload a photograph to run segmentation. The illustrated sample uses manual boxes.</p>}
      <div className="ai-divider"/>
      <button className="secondary full-width" disabled={!!busy || !objects.length || !target || !goal.trim()} onClick={() => void reason()}><Sparkles size={15}/> Interpret goal with Muse Spark</button>
      {draft && <div className="ai-constraints"><strong>{draft.provider} / {draft.model} interpretation</strong>{draft.fallback&&<p className="ai-help">Fallback from {draft.fallback.from_provider}: {draft.fallback.reason.replaceAll('_',' ')}. The displayed result came from {draft.provider}.</p>}<p>{draft.constraints.summary}</p><p>Protect: {draft.constraints.protected_object_ids.map(id => objects.find(o => o.id === id)?.label ?? id).join(', ') || 'No additional objects'}</p>{draft.constraints.needs_clarification && <p className="ai-blocked">Clarification needed. Refine the target or goal, then interpret again.</p>}{draft.constraints.unsupported_requirements.length > 0 && <p className="ai-blocked">Unsupported: {draft.constraints.unsupported_requirements.join('; ')}</p>}<p>No calibrated reasoning confidence is provided.</p><button className="primary full-width" disabled={!!busy || draft.constraints.needs_clarification || draft.constraints.unsupported_requirements.length > 0} onClick={() => { onConstraints(draft.constraints); setDraft(null); }}><Check size={14}/> Apply reviewed constraints</button></div>}
      {constraints && <div className="ai-applied"><Check size={14}/><span>Reviewed constraints applied</span><button disabled={!!busy} onClick={() => onConstraints(null)}>Use manual rules</button></div>}
      {busy?.includes('Muse') || busy?.includes('SAM') ? <p className="ai-help" role="status"><LoaderCircle className="spin" size={12}/> {busy}</p> : null}
      {notice && <p className="ai-notice" role="status">{notice}</p>}
      <p className="ai-disclosure">AI actions send the scene/goal to the configured provider and may use credits. Uploads are prepared by your WorldOS backend; only explicit AI actions contact a model provider. Manual annotation is always available.</p>
    </div>
  </section>;
}
