import { useEffect, useRef, useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import PhotoActions from '../PhotoActions';
import { GOALS } from '../missions/types';
import { navigate, useRoute } from '../navigation';
import { connectGuidedTask } from './context';
import { getDeviceSpace } from './store';
import { discardTaskCapture, getTaskCapture, localTaskPhoto, saveTaskCapture } from './taskCapture';
import type { TaskCapture } from './taskCapture';
import { recordStudyEvent } from '../study/events';

const blank=():TaskCapture=>({kind:'task-capture',id:crypto.randomUUID(),goal:GOALS[0].goal,constraints:'',photo:null,updatedAt:new Date().toISOString()});
export default function PrepareSpace({active=true}:{active?:boolean}){
  const route=useRoute(),reset=route.params.get('reset');
  return active?<Capture key={reset??'new'} reset={reset}/>:null;
}
function Capture({reset}:{reset:string|null}){
  const [draft,setDraft]=useState<TaskCapture>(blank),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const latest=useRef(draft),pending=useRef(Promise.resolve());
  useEffect(()=>{let live=true;void (async()=>{
    if(reset){const saved=await getTaskCapture(reset);if(saved?.sourceSetupId===reset&&saved.reference)return saved;const space=await getDeviceSpace(reset);if(!space?.photo)throw new Error('Add a reference photo to this setup before resetting it.');return {...blank(),sourceSetupId:reset,goal:'Return this space to my saved setup. Suggest only changes visible between the reference and today’s photo.',constraints:space.notes,reference:{name:space.name,image_url:space.photo,steps:space.steps.map(s=>s.text)}};}
    return await getTaskCapture()??blank();
  })().then(value=>{if(live){latest.current=value;setDraft(value);}}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[reset]);
  function edit(update:Partial<TaskCapture>){
    const next={...latest.current,...update,id:crypto.randomUUID(),missionId:undefined,routineId:undefined,updatedAt:new Date().toISOString()};latest.current=next;setDraft(next);
    pending.current=pending.current.catch(()=>{}).then(()=>saveTaskCapture(next));void pending.current.catch(e=>setError(e.message));
  }
  async function photo(file:File){setBusy(true);setError('');try{edit({photo:await localTaskPhoto(file),id:crypto.randomUUID()});recordStudyEvent('capture_ready');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function begin(){setBusy(true);setError('');try{await pending.current;await saveTaskCapture(latest.current);recordStudyEvent('guidance_requested');connectGuidedTask(latest.current.missionId);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function restart(){setBusy(true);setError('');try{
    await pending.current;await discardTaskCapture(latest.current);
    const next=reset?{...blank(),sourceSetupId:reset,goal:latest.current.goal,constraints:latest.current.constraints,reference:latest.current.reference}:blank();
    await saveTaskCapture(next);latest.current=next;setDraft(next);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  if(loading)return <div className="consumer" role="status">Opening your starting point…</div>;
  return <div className="consumer prepare-space">
    <span className="eyebrow">PHOTO · STEPS · CHECK</span><h1>{draft.reference?`Reset ${draft.reference.name}`:'Get my space ready'}</h1>
    <p>{draft.reference?'Show your space today. We’ll compare it with your saved setup and help with what changed.':'Choose what you want to do, then show your space. Get a few practical steps using what you already have.'}</p>
    {error&&<p role="alert" className="simple-alert">{error}</p>}
    {draft.missionId&&<button className="primary" onClick={()=>connectGuidedTask(draft.missionId)}><RotateCcw size={18}/>Continue my saved task</button>}
    {(draft.photo||draft.missionId)&&<button className="text-button" disabled={busy} onClick={()=>void restart()}>{reset?'Start a new reset with a fresh photo':'Discard this draft and start a new task'}</button>}
    {!draft.reference&&<fieldset className="prepare-goals"><legend>What’s next?</legend>{GOALS.map(g=><button key={g.id} aria-pressed={draft.goal===g.goal} onClick={()=>edit({goal:g.goal,id:crypto.randomUUID()})}><strong>{g.title}</strong><span>{g.detail}</span></button>)}</fieldset>}
    <div className="prepare-photos">{draft.reference&&<figure><img src={draft.reference.image_url} alt="Your preferred setup"/><figcaption>Your saved setup</figcaption></figure>}<section>{draft.photo&&<img src={draft.photo.image_url} alt="Your starting photograph"/>}<PhotoActions label={draft.photo?'Choose another photo':'Choose a photo'} cameraLabel={draft.reference?'Take today’s photo':'Take a photo'} disabled={busy} onPhoto={photo}/><p className="quiet">Include the whole surface in good light.</p></section></div>
    <details open={draft.constraints.length>600?true:undefined}><summary>Goal and things that should stay</summary><label>My goal<textarea aria-label="My goal" maxLength={500} value={draft.goal} onChange={e=>edit({goal:e.target.value})}/></label><label>Keep in place or keep in mind<textarea aria-label="Keep in place or keep in mind" maxLength={600} value={draft.constraints} onChange={e=>edit({constraints:e.target.value})}/></label>{draft.constraints.length>600&&<p role="alert">Your saved notes have {draft.constraints.length} characters. Shorten them to 600 or fewer for this guided task. Your original setup keeps its full notes.</p>}</details>
    <button className="primary" disabled={busy||!draft.photo||draft.goal.trim().length<3||draft.constraints.length>600} onClick={()=>void begin()}>{busy?'Saving your photo…':'Continue to guided steps'}<ArrowRight size={18}/></button>
    <p className="quiet">Your draft stays on this device. Continuing connects to your private workspace; AI guidance sends your selected photos and goal to the connected service.</p>
    <button className="text-button" onClick={()=>navigate('mission')}>Create a photo checklist on this device</button>
  </div>;
}
