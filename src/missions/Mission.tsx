import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, CircleHelp, Download, LoaderCircle, LockKeyhole, Maximize2, RotateCcw, ScanLine } from 'lucide-react';
import { analyze } from '../api';
import { navigate, replaceRoute, useRoute } from '../navigation';
import PhotoActions from '../PhotoActions';
import Dialog from '../ui/Dialog';
import { exportJSON } from '../exportFile';
import type { SceneImage } from '../types';
import type { Mission as MissionData, MissionStep, Routine } from './types';
import { GOALS } from './types';
import * as api from './api';
import './missions.css';

export default function Mission({active=true}:{active?:boolean}) {
  const route=useRoute();
  return active?<MissionScreen key={route.params.get('id')??route.params.get('routine')??'new'}/>:null;
}

function MissionPhoto({task,step}:{task:MissionData;step?:MissionStep}) {
  const [expanded,setExpanded]=useState(false);
  const image=task.working_image,ids=step?.object_ids??task.protected_ids;
  const picture=<div className="mission-photo-image" style={{aspectRatio:`${image.width}/${image.height}`,width:`min(100%, calc(var(--mission-photo-height) * ${image.width/image.height}))`}}>
    <img src={image.image_url} alt="The workspace photograph used to build these steps"/>
    {task.analysis?.objects.filter(o=>ids.includes(o.id)).map(o=><div className="mission-object" key={o.id} style={{left:`${o.box.x*100}%`,top:`${o.box.y*100}%`,width:`${o.box.width*100}%`,height:`${o.box.height*100}%`}}><span style={o.box.y<.12?{top:3,bottom:'auto'}:undefined}>{o.label}</span></div>)}
  </div>;
  return <><figure className="mission-photo">
    <button className="mission-photo-open" aria-label="Enlarge your workspace photo" onClick={()=>setExpanded(true)}>{picture}<span className="mission-photo-caption">{step?'The highlighted items are for this step':'Your captured photo'}<Maximize2 size={14}/></span></button>
  </figure><Dialog open={expanded} onClose={()=>setExpanded(false)} title="Your workspace photo"><div className="mission-enlarged">{picture}<p>These outlines belong to this photo. Sizes and physical clearance are not measured.</p></div></Dialog></>;
}

function MissionScreen() {
  const route=useRoute(),id=route.params.get('id'),routineId=route.params.get('routine');
  const initial=GOALS.find(value=>value.id===route.params.get('goal'))??GOALS[0];
  const [goal,setGoal]=useState<string>(initial.goal),[constraints,setConstraints]=useState(''),[photo,setPhoto]=useState<SceneImage|null>(null);
  const [task,setTask]=useState<MissionData|null>(null),[routine,setRoutine]=useState<Routine|null>(null),[protectedIds,setProtectedIds]=useState<string[]>([]);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(!!id||!!routineId),[selected,setSelected]=useState('');
  const [view,setView]=useState<'guide'|'check'>('guide'),[feedback,setFeedback]=useState(''),[adapting,setAdapting]=useState(false),[editing,setEditing]=useState(false);
  const [routineName,setRoutineName]=useState('My focus setup'),[exported,setExported]=useState(false),[showSteps,setShowSteps]=useState(false);
  const request=useRef<AbortController|null>(null),epoch=useRef(0),creationId=useRef(crypto.randomUUID()),mounted=useRef(true),started=useRef(false);
  const heading=useRef<HTMLHeadingElement>(null),workspace=useRef<HTMLDivElement>(null),focusNext=useRef(false);

  function adopt(value:MissionData){setTask(value);setProtectedIds(value.protected_ids);setFeedback(value.feedback??'');}
  function advance(){focusNext.current=true;setShowSteps(false);}
  useEffect(()=>{
    mounted.current=true;const controller=new AbortController();request.current=controller;
    window.scrollTo({top:0,behavior:'instant'});
    if(id){void api.getMission(id,controller.signal).then(value=>{
      if(controller.signal.aborted)return;adopt(value);setRoutineName(value.plan?.title??'My focus setup');
      const finished=!!value.plan&&value.plan.steps.every(step=>value.completed_ids.includes(step.id));
      setView(value.review||value.after||finished?'check':'guide');
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);}).finally(()=>{if(!controller.signal.aborted){setLoading(false);request.current=null;}});}
    else if(routineId){void api.getRoutine(routineId,controller.signal).then(value=>{if(controller.signal.aborted)return;setRoutine(value);setGoal(value.goal);setConstraints(value.constraints);setRoutineName(value.name);}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);}).finally(()=>{if(!controller.signal.aborted){setLoading(false);request.current=null;}});}
    else{request.current=null;setLoading(false);}
    return()=>{mounted.current=false;epoch.current++;controller.abort();request.current?.abort();request.current=null;};
  },[id,routineId]);

  async function action<T,>(label:string,work:(signal:AbortSignal)=>Promise<T>,apply:(value:T)=>void) {
    if(request.current)return;const controller=new AbortController(),version=++epoch.current;request.current=controller;setBusy(label);setError('');
    try{const result=await work(controller.signal);if(mounted.current&&version===epoch.current)apply(result);}
    catch(reason){if(mounted.current&&version===epoch.current&&!controller.signal.aborted){setError(reason instanceof Error?reason.message:'That action could not finish. Your saved task is still available.');if(id){try{const fresh=await api.getMission(id,controller.signal);if(mounted.current&&version===epoch.current)adopt(fresh);}catch{/* Keep the last visible state available. */}}}}
    finally{if(mounted.current&&version===epoch.current){request.current=null;setBusy('');}}
  }
  useEffect(()=>{
    if(!task||started.current||route.params.get('observe')!=='1'||loading)return;
    started.current=true;replaceRoute('mission',{id:task.id});void action('Looking at your space…',signal=>api.observeMission(task,undefined,signal),adopt);
  },[task,loading]);
  useEffect(()=>{
    if(!focusNext.current)return;focusNext.current=false;
    heading.current?.focus({preventScroll:true});workspace.current?.scrollIntoView?.({block:'start',behavior:'instant'});
  },[task,view,editing,selected,showSteps]);

  async function choosePhoto(file:File){await action('Opening your photo…',()=>analyze(file),value=>{setPhoto(value);creationId.current=crypto.randomUUID();});}
  async function begin(){if(!photo)return;await action('Saving your photo…',signal=>api.createMission({id:creationId.current,goal:goal.trim(),constraints:constraints.trim(),image_url:photo.image_url,...(routine?{routine_id:routine.id}:{})},signal),value=>navigate('mission',{id:value.id,observe:'1'}));}
  async function makePlan(){if(!task)return;await action('Finding a few useful steps…',signal=>api.planMission(task,protectedIds,feedback,signal),value=>{advance();adopt(value);setSelected(value.plan?.steps[0]?.id??'');setEditing(false);setView('guide');setRoutineName(value.plan?.title??'My focus setup');});}
  async function freshPhoto(file:File,check:boolean){if(!task)return;await action(check?'Comparing your photos…':'Looking at your updated space…',async signal=>{const image=await analyze(file);if(signal.aborted)throw new DOMException('Cancelled','AbortError');return check?api.checkMission(task,image.image_url,signal):api.observeMission(task,image.image_url,signal);},value=>{advance();adopt(value);setSelected('');setAdapting(false);setEditing(false);setView(check?'check':'guide');});}
  async function mark(step:MissionStep,done:boolean){if(!task)return;await action('Saving your progress…',signal=>api.progressMission(task,step.id,done,signal),value=>{
    advance();adopt(value);const next=value.plan?.steps.find(s=>!value.completed_ids.includes(s.id));
    setSelected(next?.id??step.id);if(!next&&done)setView('check');
  });}
  async function remember(){if(!task)return;await action('Saving your setup…',signal=>api.saveRoutine(task,routineName.trim(),signal),value=>adopt(value.mission));}
  async function download(){if(!task)return;await action('Preparing your export…',async()=>{await exportJSON({format:'worldos-task-v1',task},`worldos-task-${task.id}.json`);return true;},()=>setExported(true));}
  const steps=task?.plan?.steps??[],done=task?.completed_ids??[],allDone=!!steps.length&&done.length===steps.length;
  const step=steps.find(s=>s.id===selected)??steps.find(s=>!done.includes(s.id))??steps[0];
  const stage=!task?'photo':task.plan&&view==='check'&&!editing?'check':'steps';
  const blocked=!!busy||loading,goalTitle=GOALS.find(value=>value.goal===task?.goal)?.title??'Your workspace';
  const captureActions=<PhotoActions label={photo?'Choose another photo':'Choose a photo'} cameraLabel={photo?'Retake photo':'Take a photo'} disabled={blocked} onPhoto={choosePhoto}/>;
  const taskDetails=task&&<details className="mission-disclosure mission-goal-details"><summary>{task.reference?task.reference.name:goalTitle}<span>Goal & preferences</span></summary><p>{task.goal}</p>{task.constraints&&<p><LockKeyhole size={13}/>{task.constraints}</p>}{task.reference&&<img src={task.reference.image.image_url} alt="Your saved preferred setup"/>}{task.history.length>0&&<><p>{task.history.length} earlier actions you marked done</p><ul>{task.history.map((s,i)=><li key={i}>{s}</li>)}</ul></>}</details>;

  return <div className={`mission-app mission-stage-${stage}`}>
    <header className="mission-header"><button aria-label="Back to home" onClick={()=>navigate('home')}><ArrowLeft size={18}/></button><span className="mission-wordmark"><ScanLine size={21}/>world<strong>os</strong></span><button className="mission-save-exit" onClick={()=>navigate('history')}><BookOpen size={15}/>My Spaces</button></header>
    <main className="mission-main">
      <nav className="mission-progress" aria-label="Task stages">{(['photo','steps','check'] as const).map((value,index)=><span key={value} aria-current={stage===value?'step':undefined}><b>{index+1}</b>{['Photo','Steps','Check'][index]}</span>)}</nav>
      {loading&&<div className="mission-loading" role="status"><LoaderCircle className="spin"/>Opening your saved task…</div>}
      {error&&<div className="mission-error" role="alert"><strong>Let’s pick up from here.</strong><p>{error}</p>{id&&<button disabled={blocked} onClick={()=>void action('Loading your saved progress…',signal=>api.getMission(id,signal),adopt)}>Reload saved task</button>}</div>}
      {!!busy&&<div className="mission-busy" role="status"><LoaderCircle size={18} className="spin"/><span>{busy}<small>{task?'Your photo and progress stay saved.':'This may take a moment.'}</small></span></div>}
      {!loading&&!task&&(!routineId||routine)&&<section className="mission-start">
        <h1>{routine?`Back to ${routine.name}.`:'Show your space.'}</h1><p className="mission-lead">{routine?'Take a photo of your space today. We’ll help you get back to your saved setup.':'Take a photo. We’ll help you get ready, one small step at a time.'}</p>
        <div className="mission-capture">{photo?<><figure className="mission-start-photo"><img src={photo.image_url} alt="Your selected starting photograph"/></figure><details className="mission-disclosure"><summary>Change photo</summary>{captureActions}</details></>:<>{captureActions}<p>Show the whole surface in good light.</p></>}</div>
        {!routine&&<fieldset className="mission-goals"><legend>What would you like to do?</legend>{GOALS.map((value,index)=><button disabled={blocked} key={value.id} aria-pressed={goal===value.goal} onClick={()=>{setGoal(value.goal);creationId.current=crypto.randomUUID();}}>{['Focus','Create','Tidy up'][index]}</button>)}</fieldset>}
        <details className="mission-disclosure"><summary>Change the goal or add a note <span>Optional</span></summary><label className="mission-field">What do you want to do?<textarea disabled={blocked} maxLength={500} rows={3} value={goal} onChange={e=>{setGoal(e.target.value);creationId.current=crypto.randomUUID();}}/></label><label className="mission-field">Anything that should stay?<textarea disabled={blocked} maxLength={600} rows={2} value={constraints} placeholder="Keep my monitor in place." onChange={e=>{setConstraints(e.target.value);creationId.current=crypto.randomUUID();}}/></label></details>
        {photo&&<button className="mission-primary" disabled={blocked||goal.trim().length<3} onClick={()=>void begin()}>Use this photo<ArrowRight size={18}/></button>}
        <p className="mission-footnote">Your photo is saved in your workspace. Continuing sends it to AI to help with your goal.</p>
        {routine&&<details className="mission-reference"><summary>See my saved setup</summary><img src={routine.image.image_url} alt="Your saved preferred setup"/></details>}
      </section>}
      {task&&<>
        {taskDetails}
        <div ref={workspace} className={`mission-workspace ${stage==='check'?'mission-check-workspace':''}`}>
          {stage!=='check'&&<aside className="mission-visual"><MissionPhoto task={{...task,protected_ids:protectedIds}} step={task.plan&&!editing?step:undefined}/></aside>}
          <section className="mission-controls">
            {(!task.plan||editing)&&<>
              <h1 ref={heading} tabIndex={-1}>Anything that should stay?</h1><p>Tap items you want to leave in place, or continue without selecting any.</p>
              {task.analysis?<div className="mission-keep" role="group" aria-label="Keep these objects in place">{task.analysis.objects.map(o=><button disabled={blocked} key={o.id} aria-pressed={protectedIds.includes(o.id)} onClick={()=>setProtectedIds(old=>old.includes(o.id)?old.filter(v=>v!==o.id):[...old,o.id])}>{protectedIds.includes(o.id)?<LockKeyhole size={14}/>:<span className="mission-check-dot"/>}{o.label}</button>)}</div>:!busy&&<div className="mission-fallback"><p>We can still help using your photo. Add a note about anything that should stay.</p><button disabled={blocked} onClick={()=>void action('Looking for visible items…',signal=>api.observeMission(task,undefined,signal),adopt)}><ScanLine size={15}/>Retry object recognition</button></div>}
              <details className="mission-disclosure"><summary>Add a note or correction <span>Optional</span></summary><label className="mission-field">Notes for this plan<textarea disabled={blocked} maxLength={600} rows={3} value={feedback} placeholder="That is a tablet. Keep the cables connected." onChange={e=>setFeedback(e.target.value)}/></label>{task.analysis&&<p>{task.analysis.summary}{task.analysis.truncated?' Some items may be missing.':''}</p>}</details>
              <button className="mission-primary" disabled={blocked} onClick={()=>void makePlan()}>{editing?'Update my steps':'Get my steps'}<ArrowRight size={18}/></button>
              {editing&&<button className="mission-text-button" disabled={blocked} onClick={()=>{advance();setEditing(false);}}>Keep current steps</button>}
            </>}
            {task.plan&&!editing&&view==='guide'&&<>
              <div className="mission-completion"><span>{done.length} of {steps.length} marked done by you</span><div role="progressbar" aria-label="Steps marked done by you" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done.length}><i style={{width:`${done.length/steps.length*100}%`}}/></div></div>
              {step&&<article className="mission-step-card"><span className="product-label">{task.plan.live_request===false?'TEST RESPONSE · ':''}STEP {steps.indexOf(step)+1} OF {steps.length}</span><h1 ref={heading} tabIndex={-1}>{step.title}</h1><p>{step.instruction}</p>
                <div className="mission-success-check"><CheckCheck size={17}/><span><strong>You’re ready when</strong>{step.success_check}</span></div>
                <button className="mission-primary" disabled={blocked} onClick={()=>void mark(step,!done.includes(step.id))}>{done.includes(step.id)?<RotateCcw size={17}/>:<Check size={17}/ >}{done.includes(step.id)?'Undo this step':done.length===steps.length-1?'Done, check my space':'Done, next step'}<ArrowRight size={17}/></button>
                <details className="mission-disclosure"><summary><CircleHelp size={15}/>Why this helps</summary><p>{step.why}</p></details>
              </article>}
              <details className="mission-disclosure" open={showSteps} onToggle={e=>setShowSteps(e.currentTarget.open)}><summary>See all {steps.length} steps</summary><p>{task.plan.outcome}</p><ol className="mission-step-list">{steps.map((s,i)=><li key={s.id}><button disabled={blocked} aria-current={step?.id===s.id?'step':undefined} onClick={()=>{advance();setSelected(s.id);}}><b>{done.includes(s.id)?<Check size={15}/>:i+1}</b><span>{s.title}</span><ArrowRight size={14}/></button></li>)}</ol></details>
              <button className="mission-text-button" disabled={blocked} onClick={()=>{if(done.length)setAdapting(value=>!value);else{advance();setEditing(true);}}}>This won’t work? Change the plan</button>
              {adapting&&<div className="mission-adapt"><h2>Show where you are now.</h2><p>Your earlier actions stay saved. A new photo helps us adjust the remaining steps.</p><PhotoActions label="Choose updated photo" cameraLabel="Take updated photo" disabled={blocked} onPhoto={file=>freshPhoto(file,false)}/></div>}
              <details className="mission-disclosure"><summary>More options</summary><button className="mission-text-button" disabled={blocked} onClick={()=>{advance();setView('check');setAdapting(false);}}>Check a photo now<ArrowRight size={15}/></button><p>{task.plan.limitation}</p><small className="mission-model">{task.plan.model} · Suggestions based on your photo</small></details>
            </>}
            {task.plan&&!editing&&view==='check'&&<>
              <h1 ref={heading} tabIndex={-1}>{task.review?'Your photo check':'Check your changes.'}</h1>
              <p>{allDone?'You’ve marked all your steps done. ':''}{task.review?'Here’s what we could see in your photos.':'Take a new photo from the same angle to see what changed.'}</p>
              {!task.after&&<div className="mission-check-capture"><PhotoActions label="Choose after photo" cameraLabel="Take after photo" disabled={blocked} onPhoto={file=>freshPhoto(file,true)}/></div>}
              {task.after&&<div className="mission-comparison"><figure><img src={task.working_image.image_url} alt="Before the current plan"/><figcaption>Before</figcaption></figure><figure><img src={task.after.image_url} alt="Your latest after photograph"/><figcaption>Now</figcaption></figure></div>}
              {task.review&&<section className="mission-review" aria-label="AI photo review"><span className="product-label">{task.review.live_request===false?'TEST RESPONSE · ':''}AI PHOTO REVIEW</span><h2>{task.review.comparable?'Here’s what changed.':'We need a clearer view.'}</h2><p>{task.review.summary}</p><ul>{task.review.steps.map(row=><li key={row.step_id} className={`review-${row.status}`}><span>{row.status==='looks_done'?'Looks done':row.status==='needs_attention'?'Needs attention':'Can’t tell from the photo'}</span><strong>{steps.find(s=>s.id===row.step_id)?.title}</strong><p>{row.evidence}</p></li>)}</ul><div className="mission-review-next"><strong>What to do next</strong><p>{task.review.next_step}</p></div><small>A photo check can’t confirm physical measurements or everything you did.</small></section>}
              {task.after&&!task.review&&!busy&&<p className="mission-footnote">Your photo is saved, but the AI check didn’t finish. Try a new photo or save this setup based on your own review.</p>}
              {task.after&&<section className="mission-remember"><h2>{task.saved_routine_id?'Your setup is saved.':'Want to keep this setup?'}</h2>{task.saved_routine_id?<><p>Find it in My Spaces whenever you want to reset your space.</p><button className="mission-primary" onClick={()=>navigate('home')}>Back to home<ArrowRight size={17}/></button><button className="mission-text-button" onClick={()=>navigate('mission',{routine:task.saved_routine_id!})}><RotateCcw size={17}/>Use this setup again</button></>:<><p>Save this photo as the setup you want to return to.</p><details className="mission-disclosure"><summary>Name this setup <span>Optional</span></summary><label className="mission-field">Setup name<input disabled={blocked} maxLength={100} value={routineName} onChange={e=>setRoutineName(e.target.value)}/></label></details><button className="mission-primary" disabled={blocked||!routineName.trim()} onClick={()=>void remember()}><BookOpen size={17}/>Save this setup</button></>}</section>}
              {task.after&&<details className="mission-disclosure"><summary>Try another photo</summary><PhotoActions label="Choose after photo" cameraLabel="Take after photo" disabled={blocked} onPhoto={file=>freshPhoto(file,true)}/></details>}
              <button className="mission-text-button" disabled={blocked} onClick={()=>{advance();setView('guide');}}><ArrowLeft size={15}/>Back to my steps</button>
            </>}
          </section>
        </div>
        <footer className="mission-task-footer"><span>Saved as you go. Export a copy to keep it through hosting resets.</span><button disabled={blocked} onClick={()=>void download()}><Download size={15}/>{exported?'Export again':'Export task'}</button></footer>
      </>}
    </main>
  </div>;
}
