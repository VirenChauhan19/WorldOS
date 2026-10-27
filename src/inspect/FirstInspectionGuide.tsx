import type { EvaluationTrial } from './types';

const answer=(value:boolean|null|undefined)=>value==null?'Not measured':value?'Yes':'No';
export default function FirstInspectionGuide({trial}:{trial?:EvaluationTrial|null}) {
  const result=trial?.first_inspection;
  return <section className="panel inspection-section first-inspection-guide" aria-label="First physical inspection guide">
    <span className="section-kicker">YOUR FIRST REAL INSPECTION</span><h2>Move one phone. Check the evidence.</h2>
    <p>Use a second camera to photograph the phone, mouse, notebook, and mug. Keep the camera and lighting fixed; mark the phone’s reference position. Give each object room so its box does not overlap another.</p>
    <ol>
      <li><strong>Save the reference.</strong> Arrange all four objects correctly. Take a reference photo, enter “smartphone, mouse, notebook, mug” as concepts, and choose Identify with Meta AI. Review every box; add missed objects manually and save. Manual changes remain labeled.</li>
      <li><strong>Move only the phone.</strong> Choose Record this physical test. Take a separate inspection photo. Align stationary background features, record the actual phone displacement in the independent labels, and freeze the photo before running Inspect.</li>
      <li><strong>Review and correct.</strong> Check that only the phone is reported misplaced. Resolve uncertain identities and confirm the full inventory before generating a correction plan. Follow an instruction only if its arrow points to the marked reference position. Record whether it was correct.</li>
      <li><strong>Take a fresh verification photo.</strong> Move the phone back physically. Capture another photo; do not reuse the reference. Record the actual positions, freeze the evidence, then verify. Review unresolved detections. A missing result or uncertain match is not success.</li>
    </ol>
    <p>Export the trial with photographs before leaving: Free hosting can lose saved work. No result below is measured until the real steps are recorded.</p>
    {result&&<><h3>Recorded results</h3><dl className="first-inspection-results">
      <dt>Recorded AI provenance</dt><dd>{result.recorded_ai_provenance==='live'?'Live provider responses':result.recorded_ai_provenance==='test'?'Test responses — no live AI':'Live provenance unavailable'}</dd>
      <dt>Phone detected automatically in reference</dt><dd>{answer(result.phone_detected_automatically)}</dd>
      <dt>Only the moved phone identified automatically</dt><dd>{answer(result.correct_phone_discrepancy_identified_automatically)}</dd>
      <dt>Manual annotation used</dt><dd>{answer(result.manual_annotation_used)}</dd>
      <dt>Human identity review used</dt><dd>{answer(result.human_identity_review_used)}</dd>
      <dt>Movement instruction correct (your report)</dt><dd>{answer(result.movement_instruction_correct_operator_report)}</dd>
      <dt>Fresh-photo verification succeeded</dt><dd>{answer(result.verification_succeeded)}{result.verification_evidence_mode?` · ${result.verification_evidence_mode.replaceAll('_',' ')}`:''}</dd>
      <dt>Recorded processing time</dt><dd>{result.recorded_processing_ms===null?'Not measured':`${(result.recorded_processing_ms/1000).toFixed(1)} seconds`}</dd>
      <dt>Failed or interrupted scans</dt><dd>{result.failed_scan_attempts}</dd>
    </dl><p>{result.processing_scope}</p></>}
  </section>;
}
