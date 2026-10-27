import type { InspectionFacts, InspectionObject } from '../inspect/types';
import type { Movement } from '../types';

export function finding(row:InspectionObject):string {
  switch(row.status){
    case 'correct':return `${row.label} is in place.`;
    case 'misplaced':case 'protected_moved':return `Your ${row.label} has moved.`;
    case 'confirmed_missing':return `The ${row.label} is missing (confirmed by you).`;
    case 'suspected_missing':return `We couldn't find the ${row.label}. Is it still there?`;
    case 'unexpected':return `There's an extra ${row.label}.`;
    case 'optional_absent':return `The optional ${row.label} isn't here.`;
    case 'optional_unseen':return `The optional ${row.label} wasn't found.`;
    default:return `We need your help checking the ${row.label}.`;
  }
}
export function resultTitle(facts:InspectionFacts,manual:boolean,verification:boolean){
  if(facts.passed)return manual?'Your review says everything is in place.':verification?'Everything is back in place.':'Everything looks right.';
  if(facts.review_required)return 'A few things need a closer look.';
  const changed=[...facts.objects,...facts.additional_objects].filter(o=>!['correct','optional_absent','optional_unseen'].includes(o.status));
  return changed.length===1?finding(changed[0]):'Here’s what changed.';
}
export function movementText(move:Movement){
  const dx=move.destination.x-move.source.x,dy=move.destination.y-move.source.y;
  const direction=[...(Math.abs(dx)>.005?[dx>0?'right':'left']:[]),...(Math.abs(dy)>.005?[dy>0?'down':'up']:[])].join(' and ');
  return `Lift your ${move.label} and move it ${direction?direction+' ':''}back to the outlined spot. Keep it facing the same way.`;
}
export function friendlyError(error:unknown){
  const value=error instanceof Error?error.message:'';
  if(/20 unfinished|draft limit/i.test(value))return 'You have too many unfinished checks. Open My Spaces and remove a draft you no longer need, then try again.';
  if(/session|sign.in|unauthoriz/i.test(value))return 'Please sign in again. Your photo stays here so you can retry.';
  if(/fresh|reused|separately captured/i.test(value))return 'Take a new photo after moving your things. An earlier photo cannot show whether anything changed.';
  if(/model|credential|provider|API.key|AI|concept|schema|JSON/i.test(value))return 'Automatic checking isn’t available right now. Your photo is still here. You can check the items yourself.';
  if(/timeout|timed out|network|reach|offline|fetch/i.test(value))return 'That took too long or the connection was lost. Your photo is still here. Try again when you’re connected.';
  if(/overlap|footprint|clearance|boundary/i.test(value))return 'Some marked items overlap or go outside the photo. Adjust their outlines before continuing.';
  if(/alignment|coverage/i.test(value))return 'We couldn’t line up these photos safely. Take another from the same spot, with the whole setup visible.';
  if(/changed|revision|conflict/i.test(value))return 'This saved check changed in another tab. Reopen it from My Spaces to use the latest version.';
  return 'We couldn’t finish that step. Your photo is still here. Try again, or return to My Spaces.';
}
