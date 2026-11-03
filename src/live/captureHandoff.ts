import type { AIAnalysis, SceneImage } from '../types';

export interface HeldView {frame:SceneImage;analysis:AIAnalysis;sample?:boolean}

const lifetime=10*60*1000;
let pending:{token:string;view:HeldView;expiresAt:number}|null=null;
let expiryTimer:ReturnType<typeof setTimeout>|null=null;

function clear(){if(expiryTimer!==null)clearTimeout(expiryTimer);expiryTimer=null;pending=null;}

/** Carry the latest chosen photo through an authentication remount in this tab only. */
export function prepareCaptureHandoff(view:HeldView):string{
  const snapshot=structuredClone(view),token=crypto.randomUUID();
  clear();pending={token,view:snapshot,expiresAt:Date.now()+lifetime};
  expiryTimer=setTimeout(()=>{if(pending?.token===token)clear();},lifetime);
  return token;
}

/** A route gets its own capture once; unrelated or replayed routes cannot take it. */
export function consumeCaptureHandoff(token:string|null):HeldView|null{
  if(!token||!pending)return null;
  if(Date.now()>=pending.expiresAt){clear();return null;}
  if(token!==pending.token)return null;
  const view=structuredClone(pending.view);clear();return view;
}
