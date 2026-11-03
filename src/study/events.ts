/** Optional, local usability notes. No photos, prompts, identifiers or network telemetry. */
export type StudyEvent='capture_ready'|'guidance_requested'|'first_step'|'step_done'|'photo_checked'|'routine_saved'|'room_result'|'room_reused';
export function recordStudyEvent(event:StudyEvent){
  try{if(localStorage.getItem('worldos.study.enabled')!=='yes')return;const events=JSON.parse(localStorage.getItem('worldos.study.events')??'[]') as {event:StudyEvent;at:number}[];events.push({event,at:Date.now()});localStorage.setItem('worldos.study.events',JSON.stringify(events.slice(-300)));}catch{/* Optional local notes never block a task. */}
}
