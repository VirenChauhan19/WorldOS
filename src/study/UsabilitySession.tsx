import { useState } from 'react';
import { exportJSON } from '../exportFile';

const notesKey='worldos.study.notes',helpKey='worldos.study.assistance';
function stored(key:string,fallback=''){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}

export default function UsabilitySession(){
  const [enabled,setEnabled]=useState(()=>stored('worldos.study.enabled')==='yes');
  const [notes,setNotes]=useState(()=>stored(notesKey)),[assisted,setAssisted]=useState(()=>stored(helpKey,'unrecorded'));
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  function remember(key:string,value:string){try{localStorage.setItem(key,value);setError('');}catch{setError('Your latest notes could not be saved. Export this session before leaving.');}}
  function toggle(){try{
    const next=!enabled;localStorage.setItem('worldos.study.enabled',next?'yes':'no');
    if(next&&!localStorage.getItem('worldos.study.started'))localStorage.setItem('worldos.study.started',String(Date.now()));
    setEnabled(next);setError('');
  }catch{setError('This browser could not store the session notes.');}}
  async function download(){
    const events=JSON.parse(stored('worldos.study.events','[]')) as {event:string;at:number}[];
    const requested=events.find(e=>e.event==='guidance_requested'),first=events.find(e=>e.event==='first_step'&&(!requested||e.at>=requested.at));
    await exportJSON({format:'worldos-usability-v1',scope:'Local observations from one browser. Not an accuracy benchmark.',startedAt:stored('worldos.study.started'),assistance:assisted,notes,events,secondsToFirstStep:requested&&first?(first.at-requested.at)/1000:null},'worldos-usability-session.json');
  }
  async function exportSession(restart=false){
    if(busy)return;setBusy(true);setError('');
    try{await download();if(restart){
      localStorage.setItem('worldos.study.events','[]');localStorage.setItem('worldos.study.started',String(Date.now()));
      localStorage.setItem(notesKey,'');localStorage.setItem(helpKey,'unrecorded');localStorage.setItem('worldos.study.enabled','yes');
      setNotes('');setAssisted('unrecorded');setEnabled(true);
    }}catch{setError('The session could not be exported or restarted. Your visible notes are still available.');}finally{setBusy(false);}
  }
  return <details className="usability-session"><summary>Try a usability session</summary>
    <p>Ask someone to get a real space ready without coaching, then return tomorrow to reset it. With their agreement, record task milestones locally. No photos, prompts or notes are sent to a telemetry service.</p>
    <button className="secondary" disabled={busy} onClick={toggle}>{enabled?'Pause local recording':'Record task milestones on this device'}</button>
    <p role="status">{enabled?'Recording task milestones locally.':'Local recording is off.'}</p>
    <label htmlFor="study-assistance">Did they need help?</label>
    <select id="study-assistance" disabled={busy} value={assisted} onChange={e=>{setAssisted(e.target.value);remember(helpKey,e.target.value);}}><option value="unrecorded">Not recorded</option><option value="unassisted">Finished without help</option><option value="assisted">Needed coaching</option><option value="unfinished">Did not finish</option></select>
    <label htmlFor="study-notes">What confused them or went wrong?</label>
    <textarea id="study-notes" disabled={busy} rows={3} value={notes} onChange={e=>{setNotes(e.target.value);remember(notesKey,e.target.value);}} maxLength={3000}/>
    <button className="secondary" disabled={busy} onClick={()=>void exportSession()}>Export session observations</button>
    <button className="secondary" disabled={busy} onClick={()=>void exportSession(true)}>Export and start a new session</button>
    {error&&<p role="alert">{error}</p>}
  </details>;
}
