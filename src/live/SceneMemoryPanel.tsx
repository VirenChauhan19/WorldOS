import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Crosshair, LoaderCircle, MapPin, Search, Trash2 } from 'lucide-react';
import { createMission } from '../missions/api';
import { navigate } from '../navigation';
import type { MemorySnapshot } from './sceneMemory';
import { useDeviceWorkspace } from '../device/context';
import { saveDeviceSpace } from '../device/store';

export default function SceneMemoryPanel({memory,findingId,onFind,onRename,onClear,onLeave,active}:{
  memory:MemorySnapshot;findingId:string|null;onFind:(id:string|null)=>void;
  onRename:(id:string,name:string)=>void;onClear:()=>void;onLeave:()=>void;active:boolean;
}) {
  const device=useDeviceWorkspace();
  const [query,setQuery]=useState(''),[selectedPlace,setSelectedPlace]=useState<string|null>(null);
  const [goal,setGoal]=useState('Help me tidy this area using what is already here.');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<AbortController|null>(null),creationId=useRef(crypto.randomUUID());
  const target=memory.items.find(item=>item.object.id===findingId);
  const place=memory.places.find(value=>value.id===(target?.placeId??selectedPlace??memory.location?.placeId))??memory.places.at(-1);
  const frame=target?.frame??place?.frame;
  const filtered=memory.items.filter(item=>`${item.object.label} ${item.detail} ${memory.places.find(p=>p.id===item.placeId)?.name??''}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(()=>{if(!active){pending.current?.abort();pending.current=null;setBusy(false);}return()=>{pending.current?.abort();pending.current=null;};},[active]);
  useEffect(()=>{creationId.current=crypto.randomUUID();},[frame?.image_url,goal]);
  async function help(){
    if(!frame||!goal.trim()||pending.current||!active)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
    try{
      if(device){
        const id=creationId.current;
        await saveDeviceSpace({id,name:(place?.name??'My camera view').slice(0,120),notes:goal.trim(),photo:frame.image_url,after:'',steps:[],updatedAt:new Date().toISOString()});
        if(!controller.signal.aborted){onLeave();navigate('mission',{device:id});}
        return;
      }
      const task=await createMission({id:creationId.current,goal:goal.trim(),constraints:'',image_url:frame.image_url},controller.signal);
      if(controller.signal.aborted)return;
      onLeave();navigate('mission',{id:task.id,observe:'1'});
    }catch(reason){if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Could not start your task. Try again.');}
    finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
  }
  return <section className="scene-memory" aria-label="Remembered space">
    <div className="memory-heading"><MapPin size={19}/><div><h2>Your space, remembered</h2><p>{memory.places.length?`${memory.places.length} views · ${memory.items.length} item observations`:'Look around slowly to build your memory.'}</p></div></div>
    <p className="memory-explanation">Look away and come back. Recognizable views recover their last known spots. Memory stays until you clear it or close this page.</p>
    {memory.full&&<p role="status">Memory is full. Known views still update. Start a new scan to remember another space.</p>}
    {!!memory.places.length&&<>
      <div className="memory-places" role="group" aria-label="Remembered views">{memory.places.map(value=><button key={value.id} disabled={busy} aria-pressed={place?.id===value.id} onClick={()=>{onFind(null);setSelectedPlace(value.id);}}><img src={value.frame.image_url} alt=""/><span>{value.name}<small>{memory.location?.placeId===value.id?'View recognized':'Remembered view'}</small></span></button>)}</div>
      <label className="memory-search"><Search size={17}/><input aria-label="Find a remembered item" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find a phone, keys, a book…"/></label>
      <div className="memory-items" role="group" aria-label="Remembered items">{filtered.map(item=><button key={item.object.id} disabled={busy} aria-label={`Find ${item.object.label}, last seen in ${memory.places.find(p=>p.id===item.placeId)?.name??'a captured view'}`} aria-pressed={findingId===item.object.id} onClick={()=>onFind(findingId===item.object.id?null:item.object.id)}><Crosshair size={16}/><span><strong>{item.object.label}</strong><small>Last seen in {memory.places.find(p=>p.id===item.placeId)?.name??'a captured view'}</small></span><ArrowRight size={15}/></button>)}</div>
      {!filtered.length&&<p>No remembered items match. Try the item name or scan another part of the space.</p>}
      {place&&<div className="memory-place-detail">
        <label>Name this area<input key={place.id+place.name} aria-label="Name this remembered area" maxLength={60} defaultValue={place.name} disabled={busy} onBlur={event=>onRename(place.id,event.target.value)} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/></label>
        <figure><div><img src={frame?.image_url} alt={target?`Last seen view of ${target.object.label}`:`Remembered view of ${place.name}`}/>{target&&<span className="memory-target-box" style={{left:`${target.object.box.x*100}%`,top:`${target.object.box.y*100}%`,width:`${target.object.box.width*100}%`,height:`${target.object.box.height*100}%`}}/>}</div><figcaption>{target?`${target.object.label} · last seen ${new Date(target.capturedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:place.summary}</figcaption></figure>
        {target&&<p role="status">{memory.location?.placeId===target.placeId?'This view is recognized. Check the remembered spot; the item may have moved.':'Point the camera back toward this view. I will highlight the last known spot when the view matches.'}</p>}
        <label>What would you like help with?<textarea aria-label="Goal for this remembered area" value={goal} onFocus={()=>{if(place)setSelectedPlace(place.id);}} disabled={busy} maxLength={600} onChange={event=>setGoal(event.target.value)}/></label>
        <div className="memory-goals"><button disabled={busy} onClick={()=>setGoal('Help me tidy this area using what is already here.')}>Tidy up</button><button disabled={busy} onClick={()=>setGoal('Help me prepare this space for focused work using what I already have.')}>Get ready to work</button></div>
        <button className="live-primary" disabled={busy||!goal.trim()||!active} onClick={()=>void help()}>{busy?<LoaderCircle size={17} className="spin"/>:<ArrowRight size={17}/>} {device?'Save this area on my device':'Help me with this area'}</button>
        <small>{device?'Keeps this photo and your goal in My Spaces, where you can add your own steps.':'Uses the captured view above to start a guided task. You can update the photo as you work.'}</small>
        {error&&<p role="alert">{error}</p>}
      </div>}
      <button className="memory-clear" disabled={busy} onClick={()=>{onFind(null);setSelectedPlace(null);onClear();}}><Trash2 size={15}/>Clear memory & start a new scan</button>
    </>}
  </section>;
}
