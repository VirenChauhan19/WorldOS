// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { consumeCaptureHandoff, prepareCaptureHandoff } from './captureHandoff';
import type { HeldView } from './captureHandoff';

const capture=():HeldView=>({
  frame:{image_url:'data:image/jpeg;base64,cGhvdG8=',width:1280,height:720,name:'Chosen photo'},
  analysis:{objects:[{id:'object-1',label:'My tablet',box:{x:.1,y:.2,width:.3,height:.4},locked:false,source:'ai_corrected',confidence:null}],concepts:['tablet'],summary:'A corrected captured view',message:'',warnings:[],provider:'on_device',model:'EfficientDet Lite0',details:{'object-1':'On the left'}},
  sample:false,
});

beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));});
afterEach(()=>{vi.runOnlyPendingTimers();vi.useRealTimers();vi.restoreAllMocks();});

it('transfers the matching photo and corrected labels exactly once without browser storage',()=>{
  const storage=vi.spyOn(Storage.prototype,'setItem'),view=capture(),token=prepareCaptureHandoff(view);
  expect(token).toBeTruthy();expect(token).not.toContain(view.frame.image_url);
  expect(consumeCaptureHandoff(token)).toEqual(view);expect(consumeCaptureHandoff(token)).toBeNull();expect(storage).not.toHaveBeenCalled();
});

it('preserves the matching capture after an absent or mismatched token',()=>{
  const view=capture(),token=prepareCaptureHandoff(view);
  expect(consumeCaptureHandoff(null)).toBeNull();expect(consumeCaptureHandoff('another-route')).toBeNull();
  expect(consumeCaptureHandoff(token)).toEqual(view);
});

it('expires after ten minutes, including when background timers have not run',()=>{
  const token=prepareCaptureHandoff(capture());vi.setSystemTime(Date.now()+10*60*1000);
  expect(consumeCaptureHandoff(token)).toBeNull();
});

it('retains the capture just before expiry and releases it when the expiry timer runs',()=>{
  const first=prepareCaptureHandoff(capture());vi.advanceTimersByTime(10*60*1000-1);expect(consumeCaptureHandoff(first)).not.toBeNull();
  const expired=prepareCaptureHandoff(capture());vi.advanceTimersByTime(10*60*1000);expect(consumeCaptureHandoff(expired)).toBeNull();
});

it('isolates nested photo, label and box edits on both sides of the transfer',()=>{
  const view=capture(),expected=structuredClone(view),token=prepareCaptureHandoff(view);
  view.frame.name='Changed after preparing';view.analysis.objects[0].label='Wrong label';view.analysis.objects[0].box.x=.5;view.analysis.details!['object-1']='Changed detail';
  const transferred=consumeCaptureHandoff(token)!;expect(transferred).toEqual(expected);
  transferred.frame.name='Changed after consuming';transferred.analysis.objects[0].label='Another edit';transferred.analysis.objects[0].box.x=.7;
  expect(view.frame.name).toBe('Changed after preparing');expect(view.analysis.objects[0].label).toBe('Wrong label');expect(view.analysis.objects[0].box.x).toBe(.5);
});

it('keeps only the latest prepared capture and its expiry',()=>{
  const old=prepareCaptureHandoff(capture());vi.advanceTimersByTime(5*60*1000);
  const next=capture();next.sample=true;next.frame.name='Latest capture';const token=prepareCaptureHandoff(next);
  expect(token).not.toBe(old);expect(consumeCaptureHandoff(old)).toBeNull();
  vi.advanceTimersByTime(5*60*1000);expect(consumeCaptureHandoff(token)).toEqual(next);
});
