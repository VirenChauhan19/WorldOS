import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, Plus, Trash2, Upload, Grid2X2 } from 'lucide-react';
import { navigate } from '../navigation';
import { exportJSON } from '../exportFile';
import Dialog from '../ui/Dialog';
import { deleteDeviceSpace, listDeviceSpaces, loadRoomReference, parseDeviceBackup, saveDeviceSpace } from './store';
import { loadRoomDraft } from './roomDraft';
import type { DeviceSpace } from './store';

export default function DeviceSpaces({active=true,compact=false}:{active?:boolean;compact?:boolean}) {
  const [spaces,setSpaces] = useState<DeviceSpace[]>([]), [error,setError] = useState(''), [busy,setBusy] = useState(false), [revision,setRevision] = useState(0);
  const [remove,setRemove] = useState<DeviceSpace|null>(null);
  const [room,setRoom]=useState<{photo:string;count:number;width:string;depth:string}|null>(null);
  const [loading,setLoading]=useState(true);
  const input = useRef<HTMLInputElement>(null);
  useEffect(()=>{const refresh=()=>setRevision(n=>n+1);window.addEventListener('worldos:device-saved',refresh);return()=>window.removeEventListener('worldos:device-saved',refresh);},[]);
  useEffect(() => {
    if (!active) return;
    let live=true;
    setLoading(true);
    const spacesRequest=listDeviceSpaces().then(value=>{if(live){setSpaces(value);setError('');}}).catch(reason=>{if(live)setError(reason.message);});
    const draft=loadRoomDraft();
    const roomRequest=loadRoomReference().then(reference=>{if(live){const meaningful=reference||draft&&(draft.items.length>0||draft.roomFields.width||draft.roomFields.depth);setRoom(meaningful?{photo:reference?.image_url??'',count:draft?.items.length??0,width:draft?.roomFields.width??'',depth:draft?.roomFields.depth??''}:null);}}).catch(()=>{if(live&&draft&&(draft.items.length||draft.roomFields.width))setRoom({photo:'',count:draft.items.length,width:draft.roomFields.width,depth:draft.roomFields.depth});});
    void Promise.allSettled([spacesRequest,roomRequest]).then(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[active,revision]);
  async function restore(file:File) {
    setBusy(true);setError('');
    try {
      if(file.size>19*1024*1024)throw new Error('Choose a setup backup smaller than 19 MB.');
      await saveDeviceSpace(parseDeviceBackup(JSON.parse(await file.text())));setRevision(n=>n+1);
    } catch(reason) { setError(reason instanceof SyntaxError?'This file is not a valid setup backup.':reason instanceof Error?reason.message:'Could not restore this setup.'); }
    finally { setBusy(false); }
  }
  if(compact&&!spaces.length&&!room&&!error)return null;
  return <section className={`consumer device-spaces ${compact?'device-compact':''}`} aria-label="Setups saved on this device">
    <header><span className="eyebrow">ON THIS DEVICE</span>{compact?<h2>Recent setups</h2>:<h1>My Spaces</h1>}<p>{compact?'Continue a saved room plan or setup.':'Room plans, reference photos, and checklists saved in this browser.'}</p></header>
    {room&&<button className="saved-room-card" aria-label="Continue my room plan" onClick={()=>navigate('room')}>{room.photo?<img src={room.photo} alt="Your saved room"/>:<span className="saved-room-art"><Grid2X2 size={30}/></span>}<span><small>ROOM PLAN</small><strong>Saved room plan</strong><span>{room.count?`${room.count} ${room.count===1?'item':'items'} placed`:'Room layout draft'}{room.width&&room.depth?` · ${room.width} × ${room.depth} m`:''}</span></span><ArrowRight size={19}/></button>}
    {error&&<p className="simple-alert" role="alert">{error} <button onClick={()=>setRevision(n=>n+1)}>Try again</button></p>}
    {!compact&&loading&&!spaces.length&&!room&&<p className="quiet" role="status">Loading saved work…</p>}
    {!compact&&!loading&&!spaces.length&&!room&&!error&&<div className="simple-empty"><h2>Nothing saved yet</h2><p>Save a camera view or create a room plan to keep it here.</p></div>}
    <div className="simple-list">{spaces.slice(0,compact?3:spaces.length).map(space=><div className="device-space-row" key={space.id}>
      <button className="space-row" onClick={()=>navigate('mission',{device:space.id})}>{space.photo&&<img src={space.photo} alt=""/>}<span>{space.name}<small>{space.steps.filter(s=>s.done).length} of {space.steps.length} steps complete</small></span><ArrowRight size={18}/></button>
      {!compact&&<><button aria-label={`Export ${space.name}`} disabled={busy} onClick={()=>{setBusy(true);void exportJSON({format:'worldos-device-space-v1',space},`worldos-setup-${space.id}.json`).catch(()=>setError('Export failed. Your setup is still saved here.')).finally(()=>setBusy(false));}}><Download size={18}/></button><button aria-label={`Remove ${space.name}`} disabled={busy} onClick={()=>setRemove(space)}><Trash2 size={18}/></button></>}
    </div>)}</div>
    {compact?<button className="product-text" onClick={()=>navigate('history')}>All saved setups<ArrowRight size={16}/></button>:<>
      <div className="device-actions"><button className="primary" onClick={()=>navigate('mission')}><Plus size={18}/>New setup</button><button className="secondary" disabled={busy} onClick={()=>input.current?.click()}><Upload size={18}/>Restore backup</button>{!room&&<button className="secondary" onClick={()=>navigate('room')}>Open my room layout<ArrowRight size={18}/></button>}</div>
      <input ref={input} type="file" accept="application/json,.json" aria-label="Restore device setup backup" hidden onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void restore(file);}}/>
      <p className="quiet">Saved on this device. Export a backup to move your work. Clearing this site’s data removes local saves.</p>
    </>}
    <Dialog open={!!remove} onClose={()=>{if(!busy)setRemove(null);}} title="Remove this device setup?"><div className="consumer"><p>{remove?.name}</p><p>Its photos, notes, and checklist will be removed from this browser. Export a backup first if you want to keep a copy.</p><div className="device-actions"><button className="primary" disabled={busy} onClick={()=>{if(!remove)return;setBusy(true);void deleteDeviceSpace(remove.id).then(()=>{setRemove(null);setRevision(n=>n+1);}).catch(reason=>setError(reason.message)).finally(()=>setBusy(false));}}>Remove setup</button><button className="secondary" disabled={busy} onClick={()=>setRemove(null)}>Cancel</button></div></div></Dialog>
  </section>;
}
