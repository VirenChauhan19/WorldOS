import type { InferenceMetadata } from './types';

export function inferenceEvidence(value:InferenceMetadata):string {
  const origin=value.live_request===true?'Live provider response':value.live_request===false?'Test response — no live inference':'Recorded response — live provenance unavailable';
  return value.inference_cache?.status==='hit'?`Cached · ${origin}`:value.inference_cache?.status==='shared'?`Shared · ${origin}`:origin;
}
