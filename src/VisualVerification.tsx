import { useState } from 'react';
import { ScanLine } from 'lucide-react';
import type { SceneObject, VisualVerification as Result } from './types';

interface Props {
  result: Result | null; originals: SceneObject[]; busy: boolean; stale: boolean;
  onVerify: () => void; onApply: (objects: SceneObject[]) => void;
}

export default function VisualVerification({ result, originals, busy, stale, onVerify, onApply }: Props) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [ignored, setIgnored] = useState<string[]>([]);
  function assign(id: string, detection: string) {
    setAssignments(previous => ({ ...previous, [id]: detection }));
  }
  function selected(id: string) { return assignments[id] ?? result?.objects.find(o => o.object_id === id)?.detection_id ?? ''; }
  const used = originals.map(o => selected(o.id)).filter(Boolean);
  const duplicate = new Set(used).size !== used.length;
  function apply() {
    if (!result || duplicate) return;
    const objects = originals.map(original => {
      const detection = result.detections.find(d => d.id === selected(original.id));
      return detection ? { ...detection, id: original.id, label: original.label, locked: original.locked, source: 'ai_corrected' as const, confidence: null } : { ...original, source: 'manual' as const, confidence: null };
    });
    const reserved = new Set(objects.map(o => o.id));
    const extras = result.detections.filter(d => !used.includes(d.id) && !ignored.includes(d.id)).map(d => {
      let id = `extra:${d.id}`;
      while (reserved.has(id)) id += ':new';
      reserved.add(id);
      return { ...d, id };
    });
    onApply([...objects, ...extras]);
  }
  return <section className="panel visual-verification">
    <div className="panel-title"><h2>Visual verification</h2><span className="subtle-badge">SAM 3.1</span></div>
    <div className="visual-body">
      <p>One explicit scan per click. Check camera framing and scene coverage below. Missing and ambiguous identities require review.</p>
      <button className="secondary full-width" disabled={busy} onClick={() => { setAssignments({}); setIgnored([]); onVerify(); }}><ScanLine size={16}/> Automatic Verify</button>
      {result && <>
        <p role="status" className={result.passed && !stale ? 'match' : 'mismatch'}>{stale ? 'Annotations changed — scan results are historical. Verify reviewed placements again.' : result.message}</p>
        <p>Evidence: {result.confidence.replaceAll('_', ' ')} · {(result.latency_ms / 1000).toFixed(1)}s</p>
        <progress aria-label="Movement completion" max={Math.max(1, result.steps.length)} value={stale ? 0 : !result.steps.length && result.passed ? 1 : result.steps.filter(s => s.status === 'completed').length}/>
        <p>{stale ? 'Recheck progress after corrections' : !result.steps.length ? 'No movement steps in this plan' : `${result.steps.filter(s => s.status === 'completed').length}/${result.steps.length} planned steps completed`}</p>
        <ul className="visual-matches">{result.objects.map(row => <li key={row.object_id}>
          <strong>{row.label} {row.protected ? '· protected' : ''}</strong>
          <span className={row.matched && !stale ? 'match' : 'mismatch'}>{stale ? 'Needs recheck' : row.status}</span>
          <small>SAM confidence: {row.provider_confidence === null ? 'unavailable' : `${(row.provider_confidence * 100).toFixed(1)}%`}</small>
          {row.evidence_score != null && <small>Matching evidence: {row.evidence_score.toFixed(2)} / support threshold 0.72. Heuristic score, not an identity probability.</small>}
          {!!row.candidate_evidence?.length && <details><summary>Candidate matching evidence</summary><ul>{row.candidate_evidence.map(candidate => <li key={candidate.detection_id}>{candidate.detection_id}: score {candidate.score.toFixed(2)}, label {candidate.label_similarity.toFixed(2)}, footprint {candidate.footprint_similarity.toFixed(2)}, anchor error {candidate.spatial_context_error == null ? 'unavailable' : candidate.spatial_context_error.toFixed(3)}</li>)}</ul></details>}
          {row.reasons.map(reason => <small key={reason}>{reason}</small>)}
          <label>Identity assignment<select aria-label={`Detection for ${row.label} (${row.object_id})`} disabled={busy} value={selected(row.object_id)} onChange={e => assign(row.object_id, e.target.value)}>
            <option value="">Locate manually in after-photo</option>
            {result.detections.map(d => <option value={d.id} key={d.id}>{d.label} · {d.id} · x {(d.box.x*100).toFixed(1)}%, y {(d.box.y*100).toFixed(1)}%</option>)}
          </select></label>
        </li>)}</ul>
        {result.detections.filter(d => !used.includes(d.id)).map(d => <label className="visual-check" key={d.id}><input type="checkbox" checked={!ignored.includes(d.id)} disabled={busy} onChange={e => setIgnored(e.target.checked ? ignored.filter(id => id !== d.id) : [...ignored, d.id])}/>Include unmatched {d.label} ({d.id}) as obstacle</label>)}
        {duplicate && <p role="alert">Each detection can belong to only one identity.</p>}
        <button className="secondary full-width" disabled={busy || duplicate} onClick={apply}>Apply identity choices for review</button>
        <p>Unlocated objects retain starting boxes as editing placeholders. Locate them manually and confirm every position. Exclude unmatched detections only after checking the photograph.</p>
        {result.issues.length > 0 && <ul>{result.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
      </>}
    </div>
  </section>;
}
