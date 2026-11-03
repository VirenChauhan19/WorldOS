import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Copy, Download, Plus, Save, Trash2 } from 'lucide-react';
import { DeviceWorkspaceContext } from '../device/context';
import { getRoomProject, initialRoomProject, newRoomProject, recoverRoomProject, restoreRoom, RoomConflict, RoomDeleted, saveRoomProject, snapshotRoom } from '../device/roomProjects';
import type { RoomProject, RoomSnapshot } from '../device/roomProjects';
import type { RoomDraft } from '../device/roomDraft';
import type { RoomReference } from './photoPlane';
import { navigate, useRoute } from '../navigation';
import { exportJSON } from '../exportFile';
import Dialog from '../ui/Dialog';
import RoomPreview from './RoomPreview';
import { planRoom } from './layout';
import RoomStudio from './RoomStudio';
import { recordStudyEvent } from '../study/events';
import './workspace.css';

export default function RoomWorkspace({active=true}:{active?:boolean}){
  return <DeviceWorkspaceContext.Provider value={true}><SavedRoomWorkspace active={active}/></DeviceWorkspaceContext.Provider>;
}
function SavedRoomWorkspace({active}:{active:boolean}){
  const route=useRoute(),id=route.params.get('project');
  const [project,setProject]=useState<RoomProject|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    const invalidate=(deletedId:string)=>{if(deletedId===project?.id){setProject(null);setError(new RoomDeleted().message);}};
    const removed=(event:Event)=>invalidate((event as CustomEvent<string>).detail);
    window.addEventListener('worldos:room-deleted',removed);
    const channel=typeof window.BroadcastChannel==='function'?new BroadcastChannel('worldos-rooms'):null;
    if(channel)channel.onmessage=event=>{if(event.data?.type==='room-deleted')invalidate(event.data.id);};
    return()=>{window.removeEventListener('worldos:room-deleted',removed);channel?.close();};
  },[project?.id]);
  useEffect(()=>{
    if(!active)return;let live=true;setError('');setProject(null);
    void (id?getRoomProject(id):initialRoomProject()).then(value=>{
      if(!live)return;if(!value)throw new Error('This room was not found. Open My Spaces or restore a backup.');
      setProject(value);try{localStorage.setItem('worldos.active-room',value.id);}catch{/* Storage is optional for selection. */}
    }).catch(e=>{if(live)setError(e.message);});
    return()=>{live=false;};
  },[id,active]);
  if(!project)return error?<div className="consumer"><p role="alert">{error}</p><button onClick={()=>navigate('history')}>Open My Spaces</button></div>:<div className="consumer" role="status">Opening your room…</div>;
  return <ProjectEditor key={project.id} initial={project} active={active} recovered={route.params.get('recovered')==='1'}/>;
}

function ProjectEditor({initial,active,recovered}:{initial:RoomProject;active:boolean;recovered:boolean}){
  const [project,setProject]=useState(initial),[error,setError]=useState(''),[saved,setSaved]=useState(true);
  const [versionName,setVersionName]=useState(''),[compare,setCompare]=useState(''),[epoch,setEpoch]=useState(0),[working,setWorking]=useState(false);
  const [removed,setRemoved]=useState<RoomSnapshot|null>(null);
  const [deleted,setDeleted]=useState(false),deletedRef=useRef(false);
  const latest=useRef(initial),revision=useRef(initial.revision??0),dirty=useRef(false),mounted=useRef(true),recovering=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),tail=useRef<Promise<void>>(Promise.resolve());
  const fail=useCallback((reason:unknown)=>{if(reason instanceof RoomDeleted){deletedRef.current=true;dirty.current=false;if(mounted.current)setDeleted(true);}if(mounted.current)setError(reason instanceof Error?reason.message:'Your changes could not be saved. Export this room before leaving.');},[]);
  const flush=useCallback(()=>{
    if(timer.current){clearTimeout(timer.current);timer.current=null;}
    const operation=tail.current.catch(()=>{}).then(async()=>{
      if(deletedRef.current)return;
      if(recovering.current)throw new RoomConflict();
      if(!dirty.current)return;
      const current=latest.current,snapshot={...current,revision:revision.current};
      try{
        const value=await saveRoomProject(snapshot);revision.current=value.revision!;
        if(latest.current===current){latest.current=value;dirty.current=false;if(mounted.current){setProject(value);setSaved(true);setError('');}}
        else latest.current={...latest.current,revision:value.revision};
      }catch(reason){
        if(reason instanceof RoomDeleted){deletedRef.current=true;dirty.current=false;if(mounted.current)setDeleted(true);throw reason;}
        if(reason instanceof RoomConflict){
          recovering.current=true;
          try{const copy=await recoverRoomProject(latest.current);dirty.current=false;
            if(mounted.current&&window.location.hash.startsWith('#/room'))navigate('room',{project:copy.id,recovered:'1'});
          }catch(error){recovering.current=false;throw error;}
        }
        throw reason;
      }
    });
    tail.current=operation;return operation;
  },[]);
  const schedule=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>void flush().catch(fail),400);},[flush,fail]);
  const update=useCallback((value:RoomProject)=>{
    if(deletedRef.current)return;
    latest.current={...value,revision:revision.current,updatedAt:new Date().toISOString()};dirty.current=true;setProject(latest.current);setSaved(false);schedule();
  },[schedule]);
  const changed=useCallback((draft:RoomDraft,reference:RoomReference|null)=>{
    const current=latest.current;
    if(current.reference===reference&&Object.entries(draft).every(([key,value])=>Object.is(value,current.draft[key as keyof RoomDraft])))return;
    update({...current,draft,reference});
  },[update]);
  const checkpoint=useCallback(async(draft:RoomDraft,reference:RoomReference|null)=>{changed(draft,reference);await flush();},[changed,flush]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void flush().catch(()=>{});};},[flush]);
  useEffect(()=>{if(!active)void flush().catch(fail);},[active,flush,fail]);
  useEffect(()=>{
    const hide=()=>{if(document.hidden)void flush().catch(fail);};
    document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);
  },[flush,fail]);
  useEffect(()=>{if(saved)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[saved]);
  async function act(work:()=>Promise<void>,clearError=true){if(working)return;setWorking(true);if(clearError)setError('');try{await work();}catch(reason){fail(reason);}finally{if(mounted.current)setWorking(false);}}
  async function create(duplicate=false){await flush();const value=await newRoomProject(duplicate?`${latest.current.name} copy`:'Untitled room',duplicate?latest.current:undefined);navigate('room',{project:value.id});}
  async function saveVersion(){await flush();update(snapshotRoom(latest.current,versionName));await flush();setVersionName('');}
  async function restore(version:string){
    await flush();
    if(latest.current.versions.length>=12){const selected=latest.current.versions.find(v=>v.id===version)!;const copy=await newRoomProject(selected.name,{...latest.current,draft:selected.draft,reference:selected.reference});navigate('room',{project:copy.id});return;}
    update(restoreRoom(latest.current,version));await flush();setEpoch(n=>n+1);setCompare('');recordStudyEvent('room_reused');
  }
  async function removeVersion(version:RoomSnapshot){await flush();update({...latest.current,versions:latest.current.versions.filter(v=>v.id!==version.id)});await flush();setRemoved(version);}
  async function undoRemove(){if(!removed)return;await flush();if(latest.current.versions.length>=12)throw new Error('Remove another alternative before restoring this one.');update({...latest.current,versions:[...latest.current.versions,removed]});await flush();setRemoved(null);}
  const alternative=project.versions.find(v=>v.id===compare);
  if(deleted)return <div className="consumer"><p role="alert">{new RoomDeleted().message}</p><button onClick={()=>navigate('history')}>Open My Spaces</button></div>;
  return <div className="room-project">
    {recovered&&<p className="consumer simple-alert" role="status">This room changed in another tab. Your edits were saved in this recovered room; the other version is still in My Spaces.</p>}
    <section className="room-project-toolbar" aria-label="Room project">
      <label>Room name<input maxLength={80} value={project.name} onChange={e=>update({...latest.current,name:e.target.value})}/></label>
      <span role="status">{error&&!saved?'Changes not saved':saved?'Saved on this device':'Saving changes…'}</span>
      <button disabled={working} onClick={()=>void act(()=>create())}><Plus size={16}/>New room</button>
      <button disabled={working} onClick={()=>void act(()=>create(true))}><Copy size={16}/>Duplicate room</button>
      <button disabled={working} onClick={()=>void act(async()=>{await exportJSON({format:'worldos-room-project-v1',project:latest.current},`worldos-room-${project.id}.json`);},false)}><Download size={16}/>Export room</button>
      <button disabled={working||!!project.draft.roomJob} onClick={()=>void act(async()=>{await flush();update({...latest.current,archived:true});await flush();navigate('history');})}><Archive size={16}/>Archive room</button>
      <details className="room-versions"><summary>Saved alternatives ({project.versions.length})</summary>
        <div><label>Layout name<input maxLength={80} value={versionName} placeholder="Reading corner" onChange={e=>setVersionName(e.target.value)}/></label><button disabled={working||!!project.draft.roomJob||project.versions.length>=12} onClick={()=>void act(saveVersion)}><Save size={16}/>Save this layout</button></div>
        <p>Restoring keeps a copy of your current arrangement. Up to 12 alternatives per room.</p>
        {project.versions.map(v=><div className="room-version" key={v.id}><span>{v.name}<small>{new Date(v.createdAt).toLocaleDateString()}</small></span><button onClick={()=>setCompare(v.id)}>Compare</button><button disabled={working||!!project.draft.roomJob} onClick={()=>void act(()=>restore(v.id))}>{project.versions.length>=12?'Use as new room':'Restore'}</button><button aria-label={`Remove alternative ${v.name}`} disabled={working} onClick={()=>void act(()=>removeVersion(v))}><Trash2 size={16}/></button></div>)}
        {removed&&<p role="status">Removed {removed.name}. <button disabled={working} onClick={()=>void act(undoRemove)}>Undo removal</button></p>}
      </details>
    </section>
    {error&&<p className="consumer simple-alert" role="alert">{error} <button onClick={()=>void act(flush)}>Retry save</button></p>}
    <RoomStudio key={`${project.id}:${epoch}`} active={active} initialProject={project} onProjectChange={changed} onBeforeJob={checkpoint}/>
    <Dialog open={!!alternative} onClose={()=>setCompare('')} title="Compare room layouts"><div className="room-version-comparison">{alternative&&[{name:'Current arrangement',draft:project.draft},{name:alternative.name,draft:alternative.draft}].map((value,index)=>{
      const d=value.draft,width=Number(d.roomFields.width),depth=Number(d.roomFields.depth),room={width,depth};const placements=d.manual??planRoom(room,d.items,Number(d.gap),d.zones??[]).placements;
      return <section key={index}><h3>{value.name}</h3>{width>0&&depth>0?<RoomPreview room={room} items={d.items} placements={placements} selectedId="" onSelect={()=>{}} showWalls/>:<p>Add room dimensions or a photo estimate to preview this layout.</p>}<p>{d.items.length} pieces · {d.source==='photo'?'Estimated dimensions':'Entered layout'}</p><ul>{d.items.map(item=><li key={item.id}>{item.label}: {item.width} × {item.depth} m</li>)}</ul></section>;
    })}</div>{project.draft.roomJob&&<p>Wait for the room request to finish or cancel it before restoring an alternative.</p>}{alternative&&<button className="primary" disabled={working||!!project.draft.roomJob} onClick={()=>void act(()=>restore(alternative.id))}>{project.versions.length>=12?'Create room from':'Use'} {alternative.name}</button>}</Dialog>
  </div>;
}
