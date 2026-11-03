import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, Plus, Trash2, Upload } from 'lucide-react';
import WorldIcon from '../ui/WorldIcon';
import { navigate } from '../navigation';
import { exportJSON } from '../exportFile';
import Dialog from '../ui/Dialog';
import { deleteDeviceSpace, listDeviceSpaces, loadRoomReference, parseDeviceBackup, saveDeviceSpace } from './store';
import { loadRoomDraft } from './roomDraft';
import type { DeviceSpace } from './store';
import { deleteLegacyRoomPlan, deleteRoomProject, hasRoomProjectHistory, listRoomProjects, parseRoomProjectBackup, saveRoomProject } from './roomProjects';
import type { RoomProject } from './roomProjects';
import { getTaskCapture } from './taskCapture';
import { connectGuidedTask } from './context';
import { deleteScene, loadScene, SCENE_STORAGE_KEY } from '../ar/scene';
import type { DesignScene } from '../ar/scene';
import './saved-spaces.css';

export default function DeviceSpaces({active=true,compact=false}:{active?:boolean;compact?:boolean}) {
  const [spaces,setSpaces] = useState<DeviceSpace[]>([]), [error,setError] = useState(''), [busy,setBusy] = useState(false), [revision,setRevision] = useState(0);
  const [remove,setRemove] = useState<DeviceSpace|null>(null);
  const [removeRoom,setRemoveRoom]=useState<RoomProject|null>(null),[removeLegacy,setRemoveLegacy]=useState(false),[removeDesign,setRemoveDesign]=useState<DesignScene|null>(null),[removeError,setRemoveError]=useState('');
  const [scene,setScene]=useState(loadScene);
  const [legacyRoom,setRoom]=useState<{photo:string;count:number;width:string;depth:string}|null>(null),[roomHistory,setRoomHistory]=useState(false);
  const room=roomHistory?null:legacyRoom;
  const [projects,setProjects]=useState<RoomProject[]>([]),[taskId,setTaskId]=useState('');
  const [loading,setLoading]=useState(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(()=>{const refresh=()=>setRevision(n=>n+1);window.addEventListener('worldos:device-saved',refresh);const channel=typeof window.BroadcastChannel==='function'?new BroadcastChannel('worldos-rooms'):null;if(channel)channel.onmessage=refresh;return()=>{window.removeEventListener('worldos:device-saved',refresh);channel?.close();};},[]);
  useEffect(()=>{
    const refresh=()=>setScene(loadScene());
    const storage=(event:StorageEvent)=>{if(event.key===SCENE_STORAGE_KEY||event.key===null)refresh();};
    window.addEventListener('worldos:design-saved',refresh);window.addEventListener('worldos:design-deleted',refresh);window.addEventListener('storage',storage);
    if(active)refresh();
    return()=>{window.removeEventListener('worldos:design-saved',refresh);window.removeEventListener('worldos:design-deleted',refresh);window.removeEventListener('storage',storage);};
  },[active]);
  useEffect(() => {
    if (!active) return;
    let live=true;
    setLoading(true);setError('');
    const spacesRequest=listDeviceSpaces().then(value=>{if(live)setSpaces(value);}).catch(reason=>{if(live)setError(reason.message);});
    const projectsRequest=Promise.all([listRoomProjects(),hasRoomProjectHistory()]).then(([value,history])=>{if(live){setProjects(value);setRoomHistory(history);}}).catch(reason=>{if(live)setError(`Room projects could not be opened. ${reason.message}`);});
    void getTaskCapture().then(value=>{if(live)setTaskId(value?.missionId??'');}).catch(()=>{});
    const draft=loadRoomDraft();
    const roomRequest=loadRoomReference().then(reference=>{if(live){const meaningful=reference||draft&&(draft.items.length>0||draft.roomFields.width||draft.roomFields.depth);setRoom(meaningful?{photo:reference?.image_url??'',count:draft?.items.length??0,width:draft?.roomFields.width??'',depth:draft?.roomFields.depth??''}:null);}}).catch(()=>{if(live&&draft&&(draft.items.length||draft.roomFields.width))setRoom({photo:'',count:draft.items.length,width:draft.roomFields.width,depth:draft.roomFields.depth});});
    void Promise.allSettled([spacesRequest,roomRequest,projectsRequest]).then(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[active,revision]);
  async function restore(file:File) {
    setBusy(true);setError('');
    try {
      if(file.size>120*1024*1024)throw new Error('Choose a setup backup smaller than 120 MB.');
      const parsed=JSON.parse(await file.text());if(parsed?.format==='worldos-room-project-v1')await saveRoomProject(parseRoomProjectBackup(parsed));else await saveDeviceSpace(parseDeviceBackup(parsed));setRevision(n=>n+1);
    } catch(reason) { setError(reason instanceof SyntaxError?'This file is not a valid setup backup.':reason instanceof Error?reason.message:'Could not restore this setup.'); }
    finally { setBusy(false); }
  }
  if(compact&&!spaces.length&&!room&&!projects.length&&!scene&&!taskId&&!error)return null;
  return <section className={`consumer device-spaces ${compact?'device-compact':''}`} aria-label="Setups saved on this device">
    <header><span className="eyebrow">ON THIS DEVICE</span>{compact?<h2>Recent setups</h2>:<h1>My Spaces</h1>}<p>{compact?'Continue a saved room plan or setup.':'Room plans, reference photos, and checklists saved in this browser.'}</p></header>
    {taskId&&<button className="space-row" onClick={()=>connectGuidedTask(taskId)}><span>Continue my guided task<small>Your photo and completed steps are saved.</small></span><ArrowRight size={18}/></button>}
    {projects.filter(p=>!p.archived).slice(0,compact?3:projects.length).map(project=><div className="saved-room-row" key={project.id}><button className="saved-room-card" onClick={()=>navigate('room',{project:project.id})}>{project.reference&&<img src={project.reference.image_url} alt=""/>}<span><small>ROOM PROJECT</small><strong>{project.name||'Untitled room'}</strong><span>{project.draft.items.length} pieces / {project.versions.length} saved alternatives{project.draft.roomJob?' / AI request saved':''}</span></span><ArrowRight size={19}/></button>{!compact&&<button className="saved-space-delete" aria-label={`Delete room ${project.name||'Untitled room'}`} disabled={busy} onClick={()=>{setRemoveError('');setRemoveRoom(project);}}><Trash2 size={17}/>Delete</button>}</div>)}
    {!compact&&projects.some(p=>p.archived)&&<details className="room-versions"><summary>Archived rooms ({projects.filter(p=>p.archived).length})</summary>{projects.filter(p=>p.archived).map(project=><div className="room-version" key={project.id}><span>{project.name}</span><button disabled={busy} onClick={()=>{setBusy(true);void saveRoomProject({...project,archived:false}).then(()=>setRevision(n=>n+1)).catch(reason=>setError(reason.message)).finally(()=>setBusy(false));}}>Restore room</button><button disabled={busy} onClick={()=>void exportJSON({format:'worldos-room-project-v1',project},`worldos-room-${project.id}.json`).catch(reason=>setError(reason.message))}>Export</button><button className="saved-space-delete" aria-label={`Delete archived room ${project.name}`} disabled={busy} onClick={()=>{setRemoveError('');setRemoveRoom(project);}}><Trash2 size={17}/>Delete</button></div>)}</details>}
    {scene&&<div className="saved-room-row"><button className="saved-room-card" onClick={()=>navigate('ar')}><span className="saved-room-art"><WorldIcon name="room" size={30}/></span><span><small>AR DESIGN</small><strong>{scene.name}</strong><span>{scene.objects.length} objects / {scene.room.width} × {scene.room.depth} m</span></span><ArrowRight size={19}/></button>{!compact&&<button className="saved-space-delete" aria-label={`Delete AR design ${scene.name}`} disabled={busy} onClick={()=>{setRemoveError('');setRemoveDesign(structuredClone(scene));}}><Trash2 size={17}/>Delete</button>}</div>}
    {!projects.length&&room&&<div className="saved-room-row"><button className="saved-room-card" aria-label="Continue my room plan" onClick={()=>navigate('room')}>{room.photo?<img src={room.photo} alt="Your saved room"/>:<span className="saved-room-art"><WorldIcon name="room" size={30}/></span>}<span><small>ROOM PLAN</small><strong>Saved room plan</strong><span>{room.count?`${room.count} ${room.count===1?'item':'items'} placed`:'Room layout draft'}{room.width&&room.depth?` · ${room.width} × ${room.depth} m`:''}</span></span><ArrowRight size={19}/></button>{!compact&&<button className="saved-space-delete" aria-label="Delete saved room plan" disabled={busy} onClick={()=>{setRemoveError('');setRemoveLegacy(true);}}><Trash2 size={17}/>Delete</button>}</div>}
    {error&&<p className="simple-alert" role="alert">{error} <button onClick={()=>setRevision(n=>n+1)}>Try again</button></p>}
    {!compact&&loading&&!spaces.length&&!room&&!projects.length&&!scene&&!taskId&&<p className="quiet" role="status">Loading saved work…</p>}
    {!compact&&!loading&&!spaces.length&&!room&&!projects.length&&!scene&&!taskId&&!error&&<div className="simple-empty"><h2>Nothing saved yet</h2><p>Save a camera view or create a room plan to keep it here.</p></div>}
    <div className="simple-list">{spaces.slice(0,compact?3:spaces.length).map(space=><div className="device-space-row" key={space.id}>
      <button className="space-row" onClick={()=>navigate('mission',{device:space.id})}>{space.photo&&<img src={space.photo} alt=""/>}<span>{space.name}<small>{space.steps.filter(s=>s.done).length} of {space.steps.length} steps complete</small></span><ArrowRight size={18}/></button>
      {space.photo&&<button aria-label={`Reset ${space.name}`} onClick={()=>navigate('prepare',{reset:space.id})}>Reset this space</button>}
      {!compact&&<><button aria-label={`Export ${space.name}`} disabled={busy} onClick={()=>{setBusy(true);void exportJSON({format:'worldos-device-space-v1',space},`worldos-setup-${space.id}.json`).catch(()=>setError('Export failed. Your setup is still saved here.')).finally(()=>setBusy(false));}}><Download size={18}/></button><button className="saved-space-delete" aria-label={`Delete setup ${space.name}`} disabled={busy} onClick={()=>{setRemoveError('');setRemove(space);}}><Trash2 size={18}/>Delete</button></>}
    </div>)}</div>
    {compact?<button className="product-text" onClick={()=>navigate('history')}>All saved setups<ArrowRight size={16}/></button>:<>
      <div className="device-actions"><button className="primary" onClick={()=>navigate('mission')}><Plus size={18}/>New setup</button><button className="secondary" disabled={busy} onClick={()=>input.current?.click()}><Upload size={18}/>Restore backup</button>{!room&&<button className="secondary" onClick={()=>navigate('room')}>Open my room layout<ArrowRight size={18}/></button>}</div>
      <input ref={input} type="file" accept="application/json,.json" aria-label="Restore device setup backup" hidden onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void restore(file);}}/>
      <p className="quiet">Saved on this device. Export a backup to move your work. Clearing this site’s data removes local saves.</p>
    </>}
    <Dialog open={!!remove} onClose={()=>{if(!busy)setRemove(null);}} title="Delete this device setup?"><div className="consumer"><p><strong>{remove?.name}</strong></p><p>Its photos, notes, and checklist will be permanently deleted from this browser. Export a backup first if you want to keep a copy.</p>{removeError&&<p role="alert">{removeError}</p>}<div className="device-actions"><button className="primary" disabled={busy} onClick={()=>{if(!remove)return;setBusy(true);setRemoveError('');void deleteDeviceSpace(remove.id).then(()=>{setSpaces(values=>values.filter(value=>value.id!==remove.id));setRemove(null);setRevision(n=>n+1);}).catch(reason=>setRemoveError(reason instanceof Error?reason.message:'This setup could not be deleted. Try again.')).finally(()=>setBusy(false));}}>{busy?'Deleting…':'Delete setup'}</button><button className="secondary" disabled={busy} onClick={()=>setRemove(null)}>Cancel</button></div></div></Dialog>
    <Dialog open={!!removeRoom||removeLegacy} onClose={()=>{if(!busy){setRemoveRoom(null);setRemoveLegacy(false);}}} title="Delete this room?"><div className="consumer"><p><strong>{removeLegacy?'Saved room plan':removeRoom?.name||'Untitled room'}</strong></p><p>This permanently deletes this room’s layout, reference photo, and all saved alternatives from this browser. Export a backup first to keep a copy.</p>{removeError&&<p role="alert">{removeError}</p>}<div className="device-actions"><button className="primary" disabled={busy} onClick={()=>{if(!removeRoom&&!removeLegacy)return;setBusy(true);setRemoveError('');void (removeRoom?deleteRoomProject(removeRoom.id):deleteLegacyRoomPlan()).then(()=>{if(removeRoom)setProjects(values=>values.filter(value=>value.id!==removeRoom.id));setRoom(null);setRemoveRoom(null);setRemoveLegacy(false);setRevision(n=>n+1);}).catch(reason=>setRemoveError(reason instanceof Error?reason.message:'This room could not be deleted. Try again.')).finally(()=>setBusy(false));}}>{busy?'Deleting…':'Delete room'}</button><button className="secondary" disabled={busy} onClick={()=>{setRemoveRoom(null);setRemoveLegacy(false);}}>Cancel</button></div></div></Dialog>
    <Dialog open={!!removeDesign} onClose={()=>{if(!busy)setRemoveDesign(null);}} title="Delete this AR design?"><div className="consumer"><p><strong>{removeDesign?.name}</strong></p><p>This permanently deletes the AR design and all its objects from this browser. Room projects and checklists stay saved.</p>{removeError&&<p role="alert">{removeError}</p>}<div className="device-actions"><button className="primary" disabled={busy} onClick={()=>{if(!removeDesign)return;setRemoveError('');try{const current=loadScene();if(JSON.stringify(current)!==JSON.stringify(removeDesign)){setScene(current);setRemoveError('The saved AR design changed. Close this confirmation and choose Delete again to review the current design.');return;}deleteScene();setScene(null);setRemoveDesign(null);}catch(reason){setRemoveError(reason instanceof Error?reason.message:'This AR design could not be deleted. Try again.');}}}>Delete AR design</button><button className="secondary" disabled={busy} onClick={()=>setRemoveDesign(null)}>Cancel</button></div></div></Dialog>
  </section>;
}
