// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import VisualVerificationPanel from './VisualVerification';
import type { SceneObject, VisualVerification } from './types';

const original: SceneObject = {id:'cup',label:'Cup',box:{x:.1,y:.1,width:.1,height:.1},locked:true};
const detection: SceneObject = {...original,id:'sam-0',source:'sam_3_1',confidence:.81};
function result(): VisualVerification {
  return {passed:false,status:'needs_review',review_required:true,message:'Review uncertain identities.',matched_count:0,
    objects:[{object_id:'cup',label:'Cup',detection_id:'sam-0',candidate_ids:['sam-0'],certainty:'uncertain',provider_confidence:.81,appearance_similarity:null,reasons:['Repeated label'],status:'uncertain',matched:false,edge_error:0,tolerance:.01,protected:true}],
    steps:[{number:1,object_id:'cup',status:'uncertain'}],issues:[],unexpected_movements:[],uncertain_ids:['cup'],detections:[detection],observed_objects:[original],latency_ms:1200,confidence:'uncertain'};
}
afterEach(cleanup);
it('does not infer on mount and displays actual provider confidence and uncertainty', () => {
  const verify=vi.fn();
  render(<VisualVerificationPanel result={result()} originals={[original]} busy={false} stale={false} onVerify={verify} onApply={vi.fn()}/>);
  expect(verify).not.toHaveBeenCalled();
  expect(screen.getByText('SAM confidence: 81.0%')).toBeTruthy();
  expect(screen.getByText('Repeated label')).toBeTruthy();
  expect((screen.getByLabelText('Movement completion') as HTMLProgressElement).value).toBe(0);
  fireEvent.click(screen.getByRole('button',{name:'Automatic Verify'}));
  expect(verify).toHaveBeenCalledTimes(1);
});
it('retains a missing identity as an explicit manual editing placeholder', () => {
  const apply=vi.fn();
  const value=result(); value.detections=[]; value.objects[0].detection_id=null;
  render(<VisualVerificationPanel result={value} originals={[original]} busy={false} stale={false} onVerify={vi.fn()} onApply={apply}/>);
  fireEvent.click(screen.getByRole('button',{name:'Apply identity choices for review'}));
  expect(apply).toHaveBeenCalledWith([{...original,source:'manual',confidence:null}]);
});
it('prevents assigning one detection to two identities', () => {
  const value=result(); value.objects.push({...value.objects[0],object_id:'cup2'});
  render(<VisualVerificationPanel result={value} originals={[original,{...original,id:'cup2'}]} busy={false} stale={false} onVerify={vi.fn()} onApply={vi.fn()}/>);
  expect(screen.getByRole('alert').textContent).toContain('only one identity');
  expect((screen.getByRole('button',{name:'Apply identity choices for review'}) as HTMLButtonElement).disabled).toBe(true);
});
it('includes unmatched detections as obstacles unless explicitly excluded after review', () => {
  const value=result(); value.detections.push({...detection,id:'extra',label:'Book'});
  const apply=vi.fn();
  render(<VisualVerificationPanel result={value} originals={[original]} busy={false} stale={false} onVerify={vi.fn()} onApply={apply}/>);
  fireEvent.click(screen.getByRole('button',{name:'Apply identity choices for review'}));
  expect(apply.mock.calls[0][0]).toHaveLength(2);
  fireEvent.click(screen.getByLabelText('Include unmatched Book (extra) as obstacle'));
  fireEvent.click(screen.getByRole('button',{name:'Apply identity choices for review'}));
  expect(apply.mock.calls[1][0]).toHaveLength(1);
});
it('invalidates displayed success and progress when annotations change', () => {
  const value=result(); value.passed=true; value.steps[0].status='completed';
  render(<VisualVerificationPanel result={value} originals={[original]} busy={false} stale={true} onVerify={vi.fn()} onApply={vi.fn()}/>);
  expect(screen.getByRole('status').textContent).toContain('historical');
  expect((screen.getByLabelText('Movement completion') as HTMLProgressElement).value).toBe(0);
});
