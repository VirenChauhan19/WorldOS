import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Crosshair, LoaderCircle, MessageCircle, X } from 'lucide-react';
import { askScene } from '../api';
import type { AIAnalysis, SceneAnswer, SceneImage } from '../types';

const prompts = ['What could work better here?', 'How can I make room?', 'What should I measure?'];
const actions = { measure: 'Check the dimensions', room: 'Open Room Studio', inspect: 'Save a reference setup', none: '' };

export default function AskScene({frame,analysis,active,onSelect,onAction}:{
  frame:SceneImage|null; analysis:AIAnalysis|null; active:boolean;
  onSelect:(id:string)=>void; onAction:(action:SceneAnswer['next_action'])=>void;
}) {
  const [question,setQuestion]=useState(''),[asked,setAsked]=useState(''),[answer,setAnswer]=useState<SceneAnswer|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<AbortController|null>(null),epoch=useRef(0);
  // Each answer belongs to one captured image. Do not carry it into a newer scan.
  useEffect(()=>{
    epoch.current++;pending.current?.abort();pending.current=null;
    setAnswer(null);setAsked('');setError('');setBusy(false);
    return()=>{epoch.current++;pending.current?.abort();pending.current=null;};
  },[frame?.image_url,active]);

  async function submit(value:string) {
    const clean=value.trim();
    if(!frame||!analysis||!active||pending.current||clean.length<3||clean.length>600)return;
    const request=++epoch.current,controller=new AbortController();pending.current=controller;
    setBusy(true);setError('');setAsked(clean);setAnswer(null);setQuestion(clean);
    try {
      const result=await askScene(frame.image_url,analysis.objects,clean,controller.signal);
      if(request!==epoch.current)return;
      setAnswer(result);setQuestion('');
    } catch(reason) {
      if(request===epoch.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'That question could not be answered. Try again.');
    } finally {
      if(request===epoch.current){pending.current=null;setBusy(false);}
    }
  }
  function cancel(){epoch.current++;pending.current?.abort();pending.current=null;setBusy(false);setAsked('');}
  const ready=!!frame&&!!analysis;
  return <section className="ask-scene" aria-label="Ask your space">
    <div className="ask-heading"><span className="live-kicker"><MessageCircle size={14}/> A LITTLE UNDERSTANDING GOES A LONG WAY</span><h2>Ask this view.</h2><p>{ready?'Ideas grounded in the things right in front of you.':'Once your first scan is ready, ask a question about what is in view.'}</p></div>
    {ready&&<figure className="ask-captured"><img src={frame.image_url} alt="Captured frame used for your question"/><figcaption><strong>THIS IS THE VIEW I WILL USE</strong><span>{analysis.objects.length} located {analysis.objects.length===1?'item':'items'} · Updates with each scan</span></figcaption></figure>}
    {ready&&<div className="ask-suggestions">{prompts.map(prompt=><button key={prompt} disabled={busy} onClick={()=>void submit(prompt)}>{prompt}<ArrowUp size={12}/></button>)}</div>}
    <form onSubmit={event=>{event.preventDefault();void submit(question);}}>
      <label htmlFor="scene-question" className="sr-only">Question about this view</label>
      <textarea id="scene-question" value={question} maxLength={600} rows={2} disabled={!ready||busy} placeholder="What would you like to do with this space?" onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void submit(question);}}}/>
      <div className="ask-composer-footer"><span>{ready?'Uses your captured frame':'Waiting for a scan'}</span><button type="submit" disabled={!ready||busy||question.trim().length<3} aria-label="Ask about this view"><ArrowUp size={18}/></button></div>
    </form>
    {busy&&<div className="ask-working" role="status"><LoaderCircle size={16} className="spin"/><span>Looking closely at your space…</span><button aria-label="Cancel question" onClick={cancel}><X size={15}/></button></div>}
    {error&&<p className="ask-error" role="alert">{error}</p>}
    {answer&&<div className="ask-answer" aria-live="polite"><span className="ask-question">{asked}</span><p>{answer.answer}</p>
      {!!answer.observations.length&&<ul>{answer.observations.map((observation,index)=><li key={index}>{observation}</li>)}</ul>}
      {!!answer.object_ids.length&&<div className="ask-evidence"><span>IN THIS VIEW</span>{answer.object_ids.map(id=>{const object=analysis?.objects.find(item=>item.id===id);return object?<button key={id} onClick={()=>onSelect(id)}><Crosshair size={12}/>{object.label}</button>:null;})}</div>}
      {answer.limitation&&<p className="ask-limitation">{answer.limitation}</p>}
      {answer.next_action!=='none'&&<button className="ask-next" onClick={()=>onAction(answer.next_action)}>{actions[answer.next_action]}<ArrowRight size={16}/></button>}
      <small>{answer.live_request===false?'Test response · ':''}{answer.model} · Captured view</small>
    </div>}
  </section>;
}
