import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Crosshair, LoaderCircle, MessageCircle, X } from 'lucide-react';
import { askScene } from '../api';
import { readPhoto } from '../device/store';
import type { AIAnalysis, SceneAnswer, SceneImage } from '../types';

const prompts = ['What could work better here?', 'How can I make room?', 'What should I measure?'];
const explainPrompt = 'Describe everything you can clearly see in this image: the objects, their relative positions, and useful visible details. Recheck the suggested labels. Say what is uncertain or not visible.';
const actions = { measure: 'Check the dimensions', room: 'Open Room Studio', inspect: 'Save a reference setup', none: '' };

export default function AskScene({frame,analysis,active,onSelect,onAction,selectedId=null,example=false,onConnect}:{
  frame:SceneImage|null; analysis:AIAnalysis|null; active:boolean;
  onSelect:(id:string)=>void; onAction:(action:SceneAnswer['next_action'])=>void;
  selectedId?:string|null; example?:boolean; onConnect?:()=>void;
}) {
  const [question,setQuestion]=useState(''),[asked,setAsked]=useState(''),[answer,setAnswer]=useState<SceneAnswer|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<AbortController|null>(null),epoch=useRef(0);
  const objectContext=JSON.stringify(analysis?.objects??[]);
  const selected=analysis?.objects.find(object=>object.id===selectedId);
  // Each answer belongs to one captured image. Do not carry it into a newer scan.
  useEffect(()=>{
    epoch.current++;pending.current?.abort();pending.current=null;
    setAnswer(null);setAsked('');setError('');setBusy(false);
    return()=>{epoch.current++;pending.current?.abort();pending.current=null;};
  },[frame?.image_url,objectContext,active]);

  async function submit(value:string) {
    const clean=value.trim();
    if(!frame||!analysis||!active||pending.current||clean.length<3||clean.length>600)return;
    const request=++epoch.current,controller=new AbortController();pending.current=controller;
    setBusy(true);setError('');setAsked(clean);setAnswer(null);setQuestion(clean);
    try {
      let photo=frame.image_url;
      if(example){
        const response=await fetch('/desk-preview.webp',{signal:controller.signal});
        if(!response.ok)throw new Error('The example photo could not be opened. Try again.');
        photo=await readPhoto(new File([await response.blob()],'example.webp',{type:'image/webp'}));
      }
      if(request!==epoch.current||controller.signal.aborted)return;
      const result=await askScene(photo,analysis.objects.slice(0,12),clean,controller.signal);
      if(request!==epoch.current)return;
      setAnswer(result);setQuestion('');
    } catch(reason) {
      if(request===epoch.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'That question could not be answered. Try again.');
    } finally {
      if(request===epoch.current){pending.current=null;setBusy(false);}
    }
  }
  function cancel(){epoch.current++;pending.current?.abort();pending.current=null;setBusy(false);setAsked('');}
  const ready=!!frame&&!!analysis&&active;
  return <section className="ask-scene" aria-label="Ask your space">
    <div className="ask-heading"><span className="live-kicker"><MessageCircle size={14}/> A CLOSER LOOK</span><h2>Understand this view.</h2><p>{ready?'Get a description, check a label, or explore ways to use this space.':'Hold a camera view to ask about what is visible. Objects do not need a label first.'}</p></div>
    {ready&&<figure className="ask-captured"><img src={frame.image_url} alt="Captured frame used for your question"/><figcaption><strong>{example?'RECORDED EXAMPLE PHOTO':'THIS IS THE VIEW I WILL USE'}</strong><span>{analysis.objects.length} suggested {analysis.objects.length===1?'label':'labels'} · Held for your question</span></figcaption></figure>}
    {ready&&<p className="ask-privacy">Choosing a question sends this {example?'example photo':'held photo'} and its suggested labels to your connected AI service. Live video stays on your device.</p>}
    {ready&&<div className="ask-suggestions"><button className="ask-explain" disabled={busy} onClick={()=>void submit(explainPrompt)}>Explain this view<ArrowUp size={14}/></button>{selected&&<button disabled={busy} onClick={()=>void submit(`Check the object with ID ${selected.id}, suggested label "${selected.label}". What does the photograph actually show in that box? Explain its visible details and any uncertainty; do not assume the label is correct.`)}>Check this label<ArrowUp size={12}/></button>}{prompts.map(prompt=><button key={prompt} disabled={busy} onClick={()=>void submit(prompt)}>{prompt}<ArrowUp size={12}/></button>)}</div>}
    <form onSubmit={event=>{event.preventDefault();void submit(question);}}>
      <label htmlFor="scene-question" className="sr-only">Question about this view</label>
      <textarea id="scene-question" value={question} maxLength={600} rows={2} disabled={!ready||busy} placeholder="What is this object? What could I improve here?" onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void submit(question);}}}/>
      <div className="ask-composer-footer"><span>{ready?'Uses your captured frame':'Waiting for a scan'}</span><button type="submit" disabled={!ready||busy||question.trim().length<3} aria-label="Ask about this view"><ArrowUp size={18}/></button></div>
    </form>
    {busy&&<div className="ask-working" role="status"><LoaderCircle size={16} className="spin"/><span>Looking closely at your space…</span><button aria-label="Cancel question" onClick={cancel}><X size={15}/></button></div>}
    {error&&<div className="ask-error" role="alert"><p>{error}</p>{onConnect&&<button type="button" className="live-link" onClick={onConnect}>Connect AI service</button>}</div>}
    {answer&&<div className="ask-answer" aria-live="polite"><span className="ask-question">{asked}</span><p>{answer.answer}</p>
      {!!answer.observations.length&&<ul>{answer.observations.map((observation,index)=><li key={index}>{observation}</li>)}</ul>}
      {!!answer.object_ids.length&&<div className="ask-evidence"><span>IN THIS VIEW</span>{answer.object_ids.map(id=>{const object=analysis?.objects.find(item=>item.id===id);return object?<button key={id} onClick={()=>onSelect(id)}><Crosshair size={12}/>{object.label}</button>:null;})}</div>}
      {answer.limitation&&<p className="ask-limitation">{answer.limitation}</p>}
      {answer.next_action!=='none'&&<button className="ask-next" onClick={()=>onAction(answer.next_action)}>{actions[answer.next_action]}<ArrowRight size={16}/></button>}
      <small>{answer.live_request===false?'Test response · ':''}{answer.model} · Captured view</small>
    </div>}
  </section>;
}
