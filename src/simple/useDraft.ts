import { useEffect, useMemo, useState } from 'react';
import { saveDraft } from '../inspect/api';
import type { WizardState } from './types';

/** Photos stay on the authenticated server, never in local/session storage. */
export function useDraft(id:string,revision:number,loaded:string,state:WizardState,enabled:boolean){
  const [status,setStatus]=useState(''),[error,setError]=useState('');
  const context=useMemo(()=>({id,revision,last:loaded,latest:state,pending:null as Promise<void>|null,alive:true}),[id]);
  context.latest=state;
  async function flush(photoSnapshot?:WizardState):Promise<void>{
    if((!enabled&&!photoSnapshot)||!id)return;
    if(context.pending){await context.pending;return flush(photoSnapshot);}
    const snapshot=photoSnapshot??context.latest,serial=JSON.stringify(snapshot);
    if(serial===context.last)return;
    setStatus('Saving your place…');setError('');
    context.pending=(async()=>{
      try{const result=await saveDraft(context.id,context.revision,snapshot);context.revision=result.revision;context.last=serial;if(context.alive)setStatus('Saved. You can come back to this check.');}
      catch(e){if(context.alive){setStatus('');setError(e instanceof Error?e.message:'Your place could not be saved.');}throw e;}
      finally{context.pending=null;}
    })();
    await context.pending;
    if(!photoSnapshot&&context.latest!==snapshot)await flush();
  }
  useEffect(()=>{context.alive=true;setError('');setStatus(context.last?'Your saved check is ready to continue.':'');return()=>{context.alive=false;};},[context]);
  useEffect(()=>{
    if(!enabled||!id||(!state.reference&&!state.template_id))return;
    if(JSON.stringify(state)===context.last)return;
    setStatus('Saving your place…');
    const timer=window.setTimeout(()=>{void flush().catch(()=>{});},600);
    return()=>window.clearTimeout(timer);
  },[state,context,enabled]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if((state.reference||state.template_id)&&JSON.stringify(context.latest)!==context.last){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[context,enabled,!!state.reference,state.template_id]);
  return {flush,status,error,dirty:enabled&&JSON.stringify(state)!==context.last};
}
