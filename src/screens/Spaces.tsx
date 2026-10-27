import { useEffect, useState } from 'react';
import { ArrowRight, Plus, FolderHeart } from 'lucide-react';
import * as api from '../inspect/api';
import type { TemplateSummary } from '../inspect/types';
import type { DraftSummary } from '../simple/types';
import { navigate } from '../navigation';
import Dialog from '../ui/Dialog';

export default function Spaces({active=true}:{active?:boolean}){
  const [spaces,setSpaces]=useState<TemplateSummary[]>([]),[drafts,setDrafts]=useState<DraftSummary[]>([]),[selected,setSelected]=useState(''),[checks,setChecks]=useState<{id:string;created_at:string}[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[remove,setRemove]=useState<DraftSummary|null>(null);
  useEffect(()=>{if(!active)return;let live=true;setBusy(true);setError('');void Promise.all([api.listTemplates(),api.listDrafts()]).then(([s,d])=>{if(live){setSpaces(s.templates);setDrafts(d.drafts);}}).catch(()=>{if(live)setError('Your saved spaces couldn’t be loaded. Check your connection and try again.');}).finally(()=>{if(live)setBusy(false);});return()=>{live=false;};},[active,revision]);
  async function history(id:string){setSelected(id);setBusy(true);setError('');setChecks([]);try{setChecks((await api.templateHistory(id)).inspections);}catch{setError('Previous checks couldn’t be loaded. Try again.');}finally{setBusy(false);}}
  return <div className="consumer spaces-simple"><header><span className="eyebrow">READY WHEN YOU ARE</span><h1>My Spaces</h1><p>Your saved setups and unfinished checks.</p></header>
    {busy&&<p role="status">Opening your spaces…</p>}{error&&<div className="simple-alert" role="alert">{error}<button className="secondary" onClick={()=>setRevision(n=>n+1)}>Try again</button></div>}
    {!busy&&!error&&!spaces.length&&!drafts.length&&<div className="simple-empty"><FolderHeart size={38}/><h2>A little order starts here.</h2><p>Save a photo of your desk, shelf, or workspace. Next time, you’ll have something to compare it with.</p></div>}
    {!!drafts.length&&<section className="simple-list"><h2>Continue a check</h2>{drafts.map(d=><div className="space-with-action" key={d.id}><button className="space-row" onClick={()=>navigate('inspect',{draft:d.id})}><span>{d.name}<small>{d.step==='result'?'See saved result':'Continue where you left off'}</small></span><ArrowRight size={20}/></button><button className="text-button" aria-label={`Remove draft ${d.name}`} onClick={()=>setRemove(d)}>Remove draft</button></div>)}</section>}
    {!!spaces.length&&<section className="simple-list"><h2>Saved setups</h2>{spaces.map(s=><div className="space-with-action" key={s.id}><button className="space-row" onClick={()=>navigate('inspect',{template:s.id,open:crypto.randomUUID()})}><span>{s.name}<small>Check this space</small></span><ArrowRight size={20}/></button><button className="text-button" disabled={busy} onClick={()=>void history(s.id)}>Previous checks</button></div>)}</section>}
    <button className="primary" onClick={()=>navigate('inspect',{template:'new',open:crypto.randomUUID()})}><Plus size={19}/>Save a new setup</button>
    <p className="quiet">Free hosting can lose saved work after a restart. Keep your original photos on your device.</p>
    <Dialog open={!!selected} onClose={()=>setSelected('')} title="Previous checks"><div className="consumer">{busy?<p role="status">Opening previous checks…</p>:error?<p role="alert">{error}</p>:checks.length?checks.map(c=><button className="space-row" key={c.id} onClick={()=>{setSelected('');navigate('inspect',{inspection:c.id});}}><span>{new Date(c.created_at).toLocaleString()}</span><ArrowRight size={18}/></button>):<p>No checks yet. Your setup is ready whenever you need it.</p>}</div></Dialog>
    <Dialog open={!!remove} onClose={()=>setRemove(null)} title="Remove this unfinished check?"><div className="consumer"><p>This removes the draft and its unfinished photos. Your saved setup and completed inspection records stay available.</p><button className="primary" disabled={busy} onClick={()=>{if(!remove)return;setBusy(true);void api.deleteDraft(remove.id).then(()=>{setRemove(null);setRevision(n=>n+1);}).catch(()=>setError('The draft could not be removed. Try again.')).finally(()=>setBusy(false));}}>Remove draft</button><button className="secondary" onClick={()=>setRemove(null)}>Keep it</button></div></Dialog>
  </div>;
}
