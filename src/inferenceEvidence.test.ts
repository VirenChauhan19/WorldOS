import {expect,it} from 'vitest';
import {inferenceEvidence} from './inferenceEvidence';

it('never infers live provenance from cache status or model labels',()=>{
  expect(inferenceEvidence({})).toContain('provenance unavailable');
  expect(inferenceEvidence({live_request:false,inference_cache:{status:'hit',age_ms:10}})).toBe('Cached · Test response — no live inference');
  expect(inferenceEvidence({live_request:true,inference_cache:{status:'shared',age_ms:0}})).toBe('Shared · Live provider response');
});
