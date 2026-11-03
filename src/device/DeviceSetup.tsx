import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Plus, Save, Trash2 } from 'lucide-react';
import { navigate, replaceRoute, useRoute } from '../navigation';
import PhotoActions from '../PhotoActions';
import { exportJSON } from '../exportFile';
import { openPrivateWorkspace } from './context';
import { getDeviceSpace, readPhoto, saveDeviceSpace } from './store';
import type { DeviceSpace } from './store';

const starter = () => ({id:crypto.randomUUID(),name:'My space',notes:'',photo:'',after:'',steps:[
  'Choose what you want to use this space for.',
  'Put away things you do not need for that activity.',
  'Arrange what you need within easy reach.',
].map(text=>({id:crypto.randomUUID(),text,done:false})),updatedAt:new Date().toISOString()});
const savedShape=(value:DeviceSpace):DeviceSpace=>({...value,name:value.name.trim()||'Untitled setup',steps:value.steps.filter(s=>s.text.trim()),updatedAt:new Date().toISOString()});

export default function DeviceSetup({active=true}:{active?:boolean}) {
  const route=useRoute();
  const id=route.params.get('device'),key=useRef(id??crypto.randomUUID()),previous=useRef(id);
  if(previous.current!==id){previous.current=id;if(id!==key.current)key.current=id??crypto.randomUUID();}
  return active?<Setup key={key.current} initialId={key.current} id={id}/>:null;
}

function Setup({id,initialId}:{id:string|null;initialId:string}) {
  const [space,setSpace]=useState<DeviceSpace>(()=>({...starter(),id:initialId})),[loading,setLoading]=useState(!!id),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[saved,setSaved]=useState(false),[missing,setMissing]=useState(false);
  const lock=useRef(false),latest=useRef(space),changed=useRef(false),mounted=useRef(true),serial=useRef(0),loaded=useRef(!id);
  const saveRef=useRef<(value:DeviceSpace,announce?:boolean)=>Promise<void>>(async()=>{});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(changed.current)void saveRef.current(latest.current,false);};},[]);
  useEffect(()=>{
    if(!id||loaded.current)return;
    let live=true;
    void getDeviceSpace(id).then(value=>{if(!live)return;if(!value)throw new Error('This setup is no longer on this device. Open My Spaces or restore a backup.');latest.current=value;loaded.current=true;setSpace(value);setSaved(true);}).catch(reason=>{if(live){setError(reason.message);setMissing(true);}}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[id]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  async function persist(value:DeviceSpace,announce=true){
    const version=serial.current,next=savedShape(value);
    try{await saveDeviceSpace(next);if(mounted.current&&version===serial.current){changed.current=false;setDirty(false);setSaved(true);setError('');if(announce&&!id)replaceRoute('mission',{device:next.id});}}
    catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Could not save this setup. Export it before leaving.');}
  }
  saveRef.current=persist;
  useEffect(()=>{if(!dirty)return;const timer=window.setTimeout(()=>void persist(latest.current),450);return()=>window.clearTimeout(timer);},[space,dirty]);
  function edit(update:Partial<DeviceSpace>){const next={...latest.current,...update};latest.current=next;changed.current=true;serial.current++;setSpace(next);setDirty(true);setSaved(false);}
  async function save() {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{await persist(latest.current);}finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function photo(file:File,after=false){const value=await readPhoto(file),update=after?{after:value}:{photo:value};if(mounted.current)edit(update);else{latest.current={...latest.current,...update};serial.current++;await persist(latest.current,false);}}
  if(loading)return <div className="consumer" role="status">Opening setup…</div>;
  if(missing)return <div className="consumer"><h1>Setup not found</h1><p role="alert">{error}</p><div className="device-actions"><button className="primary" onClick={()=>navigate('history')}>Open My Spaces</button><button className="secondary" onClick={()=>navigate('mission')}>Create a new setup</button></div></div>;
  return <div className="consumer device-setup">
    <button className="text-button" aria-label="Back to My Spaces" onClick={()=>navigate('history')}><ArrowLeft size={17}/>My Spaces</button>
    <header><span className="eyebrow">ON THIS DEVICE</span><h1>Save a setup</h1><p>Keep reference photos, notes, and a checklist. Changes save automatically on this device.</p></header>
    {error&&<p className="simple-alert" role="alert">{error}</p>}
    <fieldset disabled={busy} className="device-fields">
      <label>Setup name<input aria-label="Setup name" value={space.name} maxLength={120} onChange={e=>edit({name:e.target.value})}/></label>
      <div className="device-photos"><section><h2>Reference photo</h2>{space.photo&&<img src={space.photo} alt="Your saved reference setup"/>}<PhotoActions label={space.photo?'Change reference photo':'Choose reference photo'} disabled={busy} onPhoto={file=>photo(file)}/></section><section><h2>Progress photo</h2>{space.after?<img src={space.after} alt="Your progress photo"/>:<p>Add a second photo to compare changes.</p>}<PhotoActions label="Choose progress photo" cameraLabel="Take progress photo" disabled={busy} onPhoto={file=>photo(file,true)}/></section></div>
      <section><h2>Checklist</h2><p className="quiet">Customize the starter checklist for this setup.</p><div className="device-checklist">{space.steps.map((step,index)=><div key={step.id}><input type="checkbox" aria-label={`Complete step ${index+1}`} checked={step.done} onChange={e=>edit({steps:space.steps.map(s=>s.id===step.id?{...s,done:e.target.checked}:s)})}/><textarea aria-label={`Step ${index+1}`} rows={2} value={step.text} maxLength={500} onChange={e=>edit({steps:space.steps.map(s=>s.id===step.id?{...s,text:e.target.value}:s)})}/><button aria-label={`Remove step ${index+1}`} onClick={()=>edit({steps:space.steps.filter(s=>s.id!==step.id)})}><Trash2 size={17}/></button></div>)}</div><button className="text-button" disabled={space.steps.length>=30} onClick={()=>edit({steps:[...space.steps,{id:crypto.randomUUID(),text:'My next step',done:false}]})}><Plus size={16}/>Add a step</button></section>
      <label>Notes<textarea aria-label="Setup notes" rows={3} maxLength={4000} placeholder="Measurements, placement details, or notes for next time." value={space.notes} onChange={e=>edit({notes:e.target.value})}/></label>
    </fieldset>
    <div className="device-save"><div className="device-actions"><button className="primary" disabled={busy||!space.name.trim()||space.steps.some(s=>!s.text.trim())} onClick={()=>void save()}><Save size={18}/>{busy?'Saving…':'Save on this device'}</button><button className="secondary" disabled={busy} onClick={()=>void exportJSON({format:'worldos-device-space-v1',space:savedShape(space)},`worldos-setup-${space.id}.json`).catch(()=>setError('Export failed. Try again.'))}><Download size={18}/>Export backup</button></div><p role="status">{saved&&!dirty?'Saved on this device. You can come back after reloading.':dirty?'Saving your changes…':'Changes save automatically on this device.'}</p></div>
    {space.photo&&<button className="primary" onClick={()=>navigate('prepare',{reset:space.id})}>Reset this space from a new photo</button>}
    <details className="device-cloud"><summary>Cloud AI tools</summary><p>Use the optional private workspace to create a checklist from a photo or compare progress with AI.</p><button className="secondary" onClick={openPrivateWorkspace}>Open private workspace</button></details>
  </div>;
}
