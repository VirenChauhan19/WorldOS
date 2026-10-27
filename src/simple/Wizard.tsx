import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { analyze, analyzeAI, connectionDiagnostics } from '../api';
import * as api from '../inspect/api';
import { navigate, replaceRoute, useRoute } from '../navigation';
import type { InspectionRecord, TemplateSummary, WorkspaceTemplate } from '../inspect/types';
import type { SceneImage } from '../types';
import PhotoActions from '../PhotoActions';
import Photo from '../ui/Photo';
import OperationStatus from '../ui/OperationStatus';
import PhotoComparison from '../ui/PhotoComparison';
import AlignmentView from '../inspect/AlignmentView';
import PhotoStage from './PhotoStage';
import ItemReview, { SetupItems } from './ItemReview';
import { emptyReview, emptyState } from './types';
import type { DraftSummary, Step, WizardState } from './types';
import { useDraft } from './useDraft';
import { finding, friendlyError, movementText, resultTitle } from './copy';

const labels:Record<Step,string>={setup:'Save your setup',check:'Check your space',result:'What changed',fix:'Put things back',verify:'Check again'};
const steps:Step[]=['setup','check','result','fix','verify'];
const imageOf=(template:WorkspaceTemplate):SceneImage=>({image_url:template.reference_image_url,width:template.image_width,height:template.image_height,name:template.name});

export default function Wizard({active=true}:{active?:boolean}){
  const route=useRoute();
  const [state,setState]=useState<WizardState>(emptyState),[id,setId]=useState(''),[seed,setSeed]=useState(0),[loaded,setLoaded]=useState('');
  const [template,setTemplate]=useState<WorkspaceTemplate|null>(null),[record,setRecord]=useState<InspectionRecord|null>(null);
  const [spaces,setSpaces]=useState<TemplateSummary[]>([]),[drafts,setDrafts]=useState<DraftSummary[]>([]),[choosing,setChoosing]=useState(false);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState<string|null>('Opening your space…'),[error,setError]=useState(''),[details,setDetails]=useState('');
  const [unavailable,setUnavailable]=useState(false),[editItems,setEditItems]=useState(false),[aligned,setAligned]=useState<SceneImage|null>(null),[move,setMove]=useState(0);
  const lock=useRef(false),opened=useRef(''),heading=useRef<HTMLHeadingElement>(null),generation=useRef(0);
  const intent=route.params.get('draft')?`draft:${route.params.get('draft')}`:route.params.get('inspection')?`record:${route.params.get('inspection')}`:route.params.get('template')?`template:${route.params.get('template')}:${route.params.get('open')??''}`:'choose';
  const draft=useDraft(id,seed,loaded,state,ready&&!busy);
  const facts=record?.reviewed_result??record?.automatic_result;
  const manualEvidence=record?.analysis.provider==='human';
  const reviewedEvidence=manualEvidence||facts?.evidence_mode==='human_assisted';
  const step:Step=state.step==='setup'&&template?'check':(['result','fix'].includes(state.step)&&!record?(state.previous_id?'verify':template?'check':'setup'):state.step);
  const busyFlag=!!busy;

  function openState(value:WizardState,identity:string,revision=0,existing=false){
    setState(value);setId(identity);setSeed(revision);setLoaded(existing?JSON.stringify(value):'');setReady(true);setChoosing(false);setEditItems(value.manual&&value.step==='setup');setAligned(null);setMove(0);
    opened.current=`draft:${identity}`;replaceRoute('inspect',{draft:identity,step:value.step});
  }
  async function openTemplate(identity:string,epoch:number){
    const value=await api.getTemplate(identity);if(epoch!==generation.current)return;setTemplate(value);setRecord(null);
    openState({...emptyState(),step:'check',name:value.name,template_id:value.id},crypto.randomUUID());
  }
  useEffect(()=>{
    if(!active||route.page!=='inspect'||intent===opened.current)return;
    const epoch=++generation.current;lock.current=false;opened.current=intent;setBusy('Opening your space…');setError('');setReady(false);setChoosing(false);
    void(async()=>{
      if(intent.startsWith('draft:')){
        const saved=await api.getDraft(route.params.get('draft')!);const value=saved.state;
        const r=value.record_id?await api.getInspection(value.record_id):null;
        const previous=!r&&value.previous_id?await api.getInspection(value.previous_id):null;
        const t=r?.template_snapshot??previous?.template_snapshot??(value.template_id?await api.getTemplate(value.template_id):null);
        const preview=value.manual&&value.current&&t?await api.alignPhoto(t.id,value.current.image_url,value.alignment,false,value.previous_id):null;
        if(epoch!==generation.current)return;setRecord(r);setTemplate(t);openState(value,saved.id,saved.revision,true);
        if(preview?.image_url&&t)setAligned({image_url:preview.image_url,width:t.image_width,height:t.image_height,name:'Saved review photo'});
      }else if(intent.startsWith('record:')){
        const r=await api.getInspection(route.params.get('inspection')!);if(epoch!==generation.current)return;
        setRecord(r);setTemplate(r.template_snapshot);openState({...emptyState(),step:'result',name:r.template_snapshot.name,template_id:r.template_id,record_id:r.id,previous_id:r.previous_inspection_id},crypto.randomUUID());
      }else if(route.params.get('template')&&route.params.get('template')!=='new'){
        await openTemplate(route.params.get('template')!,epoch);
      }else if(route.params.get('template')==='new'){
        setTemplate(null);setRecord(null);openState(emptyState(),crypto.randomUUID());
      }else{
        const [list,unfinished]=await Promise.all([api.listTemplates(),api.listDrafts()]);if(epoch!==generation.current)return;
        setSpaces(list.templates);setDrafts(unfinished.drafts);
        if(!list.templates.length&&!unfinished.drafts.length){setTemplate(null);setRecord(null);openState(emptyState(),crypto.randomUUID());}
        else{setChoosing(true);setId('');}
      }
    })().catch(e=>{if(epoch===generation.current){setError('This saved check could not be opened. It may have been cleared while the service was asleep. Your other spaces are still available in My Spaces.');setDetails(e instanceof Error?e.message:'');}}).finally(()=>{if(epoch===generation.current)setBusy(null);});
  },[active,intent,route.page]);
  useEffect(()=>{if(!active)return;let live=true;void connectionDiagnostics().then(value=>{const sam=value.integrations.sam;if(live)setUnavailable(!!sam&&(!sam.configuration.credentials_configured||['blocked','needs_retest'].includes(sam.readiness?.status??'')));}).catch(()=>{});return()=>{live=false;};},[active]);
  useEffect(()=>{
    const target=route.params.get('step');
    if(active&&ready&&steps.includes(target as Step)&&target!==state.step)setState(old=>({...old,step:target as Step}));
  },[route.key,active,ready]);
  useEffect(()=>{if(active&&ready){heading.current?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}},[step,active,ready]);
  async function action(message:string,work:(guard:<T>(operation:Promise<T>)=>Promise<T>)=>Promise<void>,ai=false){
    if(lock.current||busy)return;lock.current=true;setBusy(message);setError('');setDetails('');
    const epoch=generation.current;
    const guard=async<T,>(operation:Promise<T>)=>{const value=await operation;if(epoch!==generation.current)throw new Error('Earlier check closed.');return value;};
    let started=false;
    try{if(ready&&(state.reference||state.template_id))await guard(draft.flush());started=true;await work(guard);}catch(e){if(epoch===generation.current){setError(friendlyError(e));setDetails(e instanceof Error?e.message:'');if(ai&&started)setUnavailable(true);}}finally{if(epoch===generation.current){lock.current=false;setBusy(null);}}
  }
  function go(next:Step,patch:Partial<WizardState>={}){setState(old=>({...old,...patch,step:next}));const current=new URLSearchParams(window.location.hash.split('?')[1]);if(window.location.hash.startsWith('#/inspect?')&&current.get('draft')===id)navigate('inspect',{draft:id,step:next});}
  async function leave(){await action('Saving your place…',async guard=>{if(state.reference||state.template_id)await guard(draft.flush());navigate('history');});}
  async function upload(file:File,isReference:boolean){
    // Keep errors in this focused experience; PhotoActions owns preparation errors.
    await action('Opening your photo…',async guard=>{const value=await guard(analyze(file));const image={image_url:value.image_url,width:value.width,height:value.height,name:file.name};
      if(isReference){setState(old=>({...old,reference:image,objects:[],analysis:null,reference_ms:null,manual:false}));setEditItems(false);}
      else{setState(old=>({...old,current:image,record_id:null,alignment:{tx:0,ty:0,scale:1,rotation:0,confirmed:false},manual:false,review:null}));setRecord(null);setAligned(null);}
    });
  }
  async function detect(){if(!state.reference)return;await action('Finding the items in your photo…',async guard=>{const start=performance.now();const analysis=await guard(analyzeAI(state.reference!.image_url,[]));setState(old=>({...old,analysis,reference_ms:Math.round(performance.now()-start),objects:analysis.objects.map(o=>({...o,required:true,tolerance:.025})),manual:false}));setUnavailable(false);if(!analysis.objects.length){setError('We couldn’t find any items. You can mark the things you want to keep track of.');setEditItems(true);}},true);}
  async function saveSetup(){if(!state.reference)return;await action('Saving your setup…',async guard=>{const t=await guard(api.saveTemplate({name:state.name.trim()||'My space',reference_image_url:state.reference!.image_url,objects:state.objects,workspace:{x:0,y:0,width:1,height:1},clearance:.005,annotations_reviewed:true,reference_analysis:state.analysis,reference_inference_wall_ms:state.reference_ms}));setTemplate(t);setEditItems(false);go('check',{name:t.name,template_id:t.id,reference:null,objects:[],analysis:null,manual:false,current:null,record_id:null});});}
  async function alignCurrent(){
    if(!template||!state.current)return;
    await action('Lining up the photos…',async guard=>{const suggestion=await guard(api.alignPhoto(template.id,state.current!.image_url,state.alignment,true,state.previous_id));const alignment=suggestion.alignment?{...suggestion.alignment,confirmed:false}:state.alignment;
      const preview=await guard(api.alignPhoto(template.id,state.current!.image_url,alignment,false,state.previous_id));
      setState(old=>({...old,alignment}));if(preview.image_url)setAligned({image_url:preview.image_url,width:template.image_width,height:template.image_height,name:'Lined up photo'});
      if(!suggestion.alignment)setError('We couldn’t line these up automatically. Compare the photos, or retake yours from the same spot.');
    });
  }
  function acceptRecord(value:InspectionRecord){setRecord(value);setTemplate(value.template_snapshot);setMove(0);go('result',{record_id:value.id,current:null,review:null,manual:false});}
  async function scan(){if(!template||!state.current)return;await action(state.previous_id?'Checking your fresh photo…':'Looking for changes…',async guard=>{const value=await guard(api.scanWorkspace({template_id:template.id,template_revision:template.revision,image_url:state.current!.image_url,alignment:state.alignment,inventory_confirmed:false,discover_unexpected:true,extra_concepts:[],previous_inspection_id:state.previous_id}));acceptRecord(value);setUnavailable(false);},true);}
  async function startReview(){
    if(!template)return;
    if(record){setAligned({image_url:record.aligned_image.image_url,width:template.image_width,height:template.image_height,name:'Photo to review'});setState(old=>({...old,manual:true,review:record.review??emptyReview()}));return;}
    if(!state.current)return;
    await action('Opening your photo for review…',async guard=>{const value=await guard(api.alignPhoto(template.id,state.current!.image_url,state.alignment,false,state.previous_id));if(!value.comparison_allowed||!value.image_url)throw new Error('Confirm alignment and coverage before reviewing.');setAligned({image_url:value.image_url,width:template.image_width,height:template.image_height,name:'Photo to review'});setState(old=>({...old,manual:true,review:old.review??emptyReview()}));});
  }
  async function applyReview(quick=false){
    if(!template)return;const review=quick?{...emptyReview(),inventory_confirmed:true}:state.review;if(!review)return;
    await action('Checking your review…',async guard=>{if(record)acceptRecord(await guard(api.reviewInspection(record.id,{...review,revision:record.revision})));else if(state.current)acceptRecord(await guard(api.manualScan({template_id:template.id,template_revision:template.revision,image_url:state.current.image_url,alignment:state.alignment,inventory_confirmed:review.inventory_confirmed,discover_unexpected:false,extra_concepts:[],previous_inspection_id:state.previous_id,review})));});
  }
  async function corrections(){if(!record)return;await action('Checking how to put things back…',async guard=>{const value=await guard(api.planCorrections(record.id,record.revision));setRecord(value);setMove(0);go('fix');});}
  function verify(){if(!record)return;setTemplate(record.template_snapshot);setRecord(null);setAligned(null);go('verify',{previous_id:record.id,record_id:null,current:null,manual:false,review:null,alignment:{tx:0,ty:0,scale:1,rotation:0,confirmed:false}});}
  const plan=record?.correction_plan,validMove=plan?.status==='ready'?plan.movements[move]:undefined;
  const uncertain=!!facts&&([...facts.objects,...facts.additional_objects].some(o=>['uncertain','suspected_missing','uncertain_unexpected'].includes(o.status))||!!facts.issues.length);
  const reviewImage=aligned??(record&&template?{image_url:record.aligned_image.image_url,width:template.image_width,height:template.image_height,name:'Photo to review'}:null);
  const showManual=state.manual&&step!=='setup'&&!!state.review&&!!template&&!!reviewImage;
  const affected=facts?.objects.filter(o=>!['correct','optional_absent','optional_unseen'].includes(o.status))??[];
  const progress=step==='result'&&record?.previous_inspection_id?4:steps.indexOf(step);

  return <div className="consumer wizard">
    <div className="wizard-top"><button className="text-button" disabled={busyFlag} onClick={()=>{if(choosing||!ready)navigate('home');else if(step==='setup'||step==='check')void leave();else if(step==='verify'&&state.previous_id)navigate('inspect',{inspection:state.previous_id});else go(step==='fix'?'result':state.previous_id?'verify':'check');}}><ArrowLeft size={18}/>Back</button><button className="icon-button" aria-label="Save and close check" disabled={busyFlag} onClick={()=>void leave()}><X size={22}/></button></div>
    {ready&&!choosing&&<div className="wizard-progress" aria-label={`Step ${progress+1} of 5: ${labels[step]}`}><span>Step {progress+1} of 5</span><div>{steps.map(s=><i key={s} className={steps.indexOf(s)<=progress?'filled':''}/>)}</div><span>{state.name}</span></div>}
    {busy&&<OperationStatus message={busy} detail="Your photos stay here. Nothing is marked complete until the check finishes."/>}
    {error&&<div className="simple-alert" role="alert"><p>{error}</p>{details&&<details><summary>See details</summary><p>{details}</p></details>}</div>}
    {!ready&&!choosing&&!busy&&<button className="primary" onClick={()=>navigate('history')}>Go to My Spaces</button>}
    {choosing&&<><h1 ref={heading} tabIndex={-1}>Which space shall we check?</h1><p>Pick a saved setup, or save a new one.</p>{!!drafts.length&&<section className="simple-list"><h2>Pick up where you left off</h2>{drafts.slice(0,3).map(d=><button key={d.id} className="space-row" onClick={()=>navigate('inspect',{draft:d.id})}><span>{d.name}<small>Continue your check</small></span><ArrowRight size={20}/></button>)}</section>}<div className="simple-list">{spaces.map(t=><button className="space-row" key={t.id} onClick={()=>navigate('inspect',{template:t.id,open:crypto.randomUUID()})}><span>{t.name}</span><ArrowRight size={20}/></button>)}</div><button className="primary" onClick={()=>navigate('inspect',{template:'new',open:crypto.randomUUID()})}>Save a new setup</button></>}
    {ready&&!choosing&&<>
      <h1 ref={heading} tabIndex={-1}>{step==='result'&&facts?resultTitle(facts,reviewedEvidence,!!record?.previous_inspection_id):step==='fix'&&validMove?`Put your ${validMove.label} back.`:labels[step]}</h1>
      {step==='setup'&&<><p>Arrange your things the way you want them. Take a photo so WorldOS knows what looks right.</p>
        {!state.reference?<div className="capture-start"><PhotoActions cameraLabel="Take a setup photo" label="Choose from photos" disabled={busyFlag} onPhoto={file=>upload(file,true)}/><p className="quiet">Use a clear, overhead view. Include the whole setup.</p></div>:<>
          {editItems?<SetupItems image={state.reference} objects={state.objects} disabled={busyFlag} onChange={objects=>setState(old=>({...old,objects,manual:true}))}/>:<PhotoStage image={state.reference} objects={state.objects}/>}
          <details className="photo-options"><summary>Use a different photo</summary><PhotoActions label="Choose another setup photo" cameraLabel="Retake setup photo" disabled={busyFlag} onPhoto={file=>upload(file,true)}/></details>
          {!!state.objects.length&&<><h2>Does this look right?</h2><p>We’ll keep track of {state.objects.map(o=>o.label).join(', ')}. Check the names and outlines before saving.</p><label className="simple-label">Name your space<input value={state.name} maxLength={120} disabled={busyFlag} onChange={e=>setState(old=>({...old,name:e.target.value}))}/></label><button className="primary" disabled={busyFlag||!state.name.trim()} onClick={()=>void saveSetup()}>Save this setup <Check size={18}/></button></>}
          {!state.objects.length&&!editItems&&(unavailable?<><p className="simple-notice">Automatic checking isn’t available right now. Mark the things you want to keep track of instead.</p><button className="primary" disabled={busyFlag} onClick={()=>{setEditItems(true);setState(old=>({...old,manual:true}));}}>Mark my items</button></>:<><p className="quiet">Choose Find my items to let AI analyze this photo. Uploading alone doesn’t start a check.</p><button className="primary" disabled={busyFlag} onClick={()=>void detect()}>Find my items <ArrowRight size={18}/></button></>)}
          {!editItems&&(!unavailable||!!state.objects.length)&&<button className="text-button" disabled={busyFlag} onClick={()=>{setEditItems(true);setState(old=>({...old,manual:true}));}}>{state.objects.length?'Change or add items':'Mark items myself'}</button>}
          {unavailable&&<details><summary>Automatic checking</summary><p>Access needs to be restored in Advanced Settings. You can retry after it is fixed.</p><button className="secondary" disabled={busyFlag} onClick={()=>void detect()}>Try finding items again</button></details>}
        </>}
      </>}
      {(step==='check'||step==='verify')&&template&&!showManual&&<><p>{step==='verify'?'Moved everything back? Take a fresh photo. We need new evidence to check the result.':'Something moved? Take another photo from the same spot.'}</p>
        <div className="reference-reminder"><Photo src={template.reference_image_url} alt="Your saved setup" width={template.image_width} height={template.image_height}/><span><strong>Your saved setup</strong><small>Match this angle and include the whole space.</small></span></div>
        {!state.current?<><div className="capture-start"><PhotoActions label="Choose from photos" cameraLabel={step==='verify'?'Take a fresh photo':'Take a new photo'} disabled={busyFlag} onPhoto={file=>upload(file,false)}/></div><p className="quiet">Your setup is saved. You can close this check and come back when you need it.</p></>:<>
          <PhotoStage image={aligned??state.current}/><PhotoComparison before={template.reference_image_url} after={(aligned??state.current).image_url} width={template.image_width} height={template.image_height}/>
          <button className="secondary" disabled={busyFlag} onClick={()=>void alignCurrent()}>Help line up the photos</button>
          <label className="simple-check"><input type="checkbox" checked={state.alignment.confirmed} disabled={busyFlag} onChange={e=>setState(old=>({...old,alignment:{...old.alignment,confirmed:e.target.checked}}))}/>The fixed background lines up, and I can see the whole setup.</label>
          {unavailable?<><p className="simple-notice">Automatic checking is unavailable. Your photo is safe here. You can compare the items yourself.</p><button className="primary" disabled={busyFlag||!state.alignment.confirmed} onClick={()=>void startReview()}>Check items myself</button></>:<><p className="quiet">This sends your photo for an AI check. You’ll review anything uncertain.</p><button className="primary" disabled={busyFlag||!state.alignment.confirmed} onClick={()=>void scan()}>{step==='verify'?'Check again':'Check for changes'} <ArrowRight size={18}/></button><button className="text-button" disabled={busyFlag||!state.alignment.confirmed} onClick={()=>void startReview()}>Check items myself</button></>}
          <details className="photo-options"><summary>Retake or adjust photo</summary><PhotoActions cameraLabel="Retake photo" label="Choose another photo" disabled={busyFlag} onPhoto={file=>upload(file,false)}/><details><summary>Advanced photo alignment</summary><AlignmentView template={template} current={state.current} value={state.alignment} busy={busyFlag} onChange={alignment=>{setAligned(null);setState(old=>({...old,alignment}));}}/></details></details>
        </>}
      </>}
      {showManual&&<><ItemReview image={reviewImage!} references={template!.objects} record={record} value={state.review!} disabled={busyFlag} onChange={review=>setState(old=>({...old,review}))}/><button className="primary" disabled={busyFlag||!state.review?.inventory_confirmed} onClick={()=>void applyReview()}>Save my review <ArrowRight size={18}/></button><button className="text-button" disabled={busyFlag} onClick={()=>setState(old=>({...old,manual:false}))}>Back to photo</button></>}
      {step==='result'&&record&&facts&&!showManual&&<>
        {record.analysis.live_request===false&&!manualEvidence&&<p className="simple-notice">Sample or test response. This is not a live AI result.</p>}
        <p>{manualEvidence?'Based on the positions you marked. This is your review, not an independent AI check.':reviewedEvidence?'Based on automatic suggestions and your review. This is not an independent AI check.':facts.review_required?'We haven’t confirmed everything yet. Check the highlighted items before moving anything.':'Based on this photograph and the items in your saved setup.'}</p>
        <PhotoStage image={{image_url:record.aligned_image.image_url,width:record.template_snapshot.image_width,height:record.template_snapshot.image_height,name:'Checked photo'}} objects={facts.observed_objects} highlight={affected.map(o=>o.object_id)}/>
        <ul className="findings-list">{[...facts.objects,...facts.additional_objects].filter(o=>facts.passed||o.status!=='correct').map(o=><li key={o.object_id}>{finding(o)}</li>)}</ul>
        {!facts.passed&&(uncertain?<button className="primary" disabled={busyFlag} onClick={()=>void startReview()}>Review these items <ArrowRight size={18}/></button>:!facts.inventory_confirmed?<><p>Are all the items accounted for, including anything extra?</p><button className="primary" disabled={busyFlag} onClick={()=>void applyReview(true)}>Yes, I’ve checked the whole photo</button></>:<button className="primary" disabled={busyFlag} onClick={()=>void corrections()}>Help me put things back <ArrowRight size={18}/></button>)}
        {facts.passed&&<button className="primary" disabled={busyFlag} onClick={()=>void leave()}>Done <Check size={18}/></button>}
        <details><summary>See details</summary><p>{record.review?'This result includes your review.':'These are automatic suggestions.'} {record.analysis.live_request===false&&!manualEvidence?'This record used test responses, not live AI.':''}</p><PhotoComparison before={record.template_snapshot.reference_image_url} after={record.aligned_image.image_url} width={record.template_snapshot.image_width} height={record.template_snapshot.image_height}/><button className="secondary" disabled={busyFlag} onClick={()=>void startReview()}>Change my review</button><button className="text-button" onClick={()=>navigate('advanced-inspect',{inspection:record.id})}>Open advanced details</button></details>
      </>}
      {step==='fix'&&record&&!showManual&&<>{validMove?<><p className="instruction-number">Move {move+1} of {plan!.movements.length}</p><p className="movement-copy">{movementText(validMove)}</p><PhotoStage image={{image_url:record.aligned_image.image_url,width:record.template_snapshot.image_width,height:record.template_snapshot.image_height,name:'Correction photo'}} objects={facts?.observed_objects} move={validMove}/><p className="quiet">Lift the item; don’t slide it through other things. Check it’s safe to move. The arrow shows the destination, not a safe travel path.</p><button className="primary" disabled={busyFlag} onClick={()=>move+1<plan!.movements.length?setMove(n=>n+1):verify()}>{move+1<plan!.movements.length?'Next instruction':'I’ve moved it — check again'} <ArrowRight size={18}/></button></>:<><p>We can’t safely suggest a move yet. {facts?.objects.some(o=>o.status==='confirmed_missing')?'Find the missing item first. Compare with your saved setup, then take a new photo.':facts?.additional_objects.length?'There are extra items in the space. Check them against your saved setup, then take another photo.':'Review the items and their outlines before following a correction.'}</p><PhotoStage image={imageOf(record.template_snapshot)}/><button className="primary" disabled={busyFlag} onClick={()=>facts?.objects.some(o=>o.status==='confirmed_missing')||facts?.additional_objects.length?verify():void startReview()}>{facts?.objects.some(o=>o.status==='confirmed_missing')||facts?.additional_objects.length?'Take a new photo':'Review items'}</button></>}</>}
      <footer className="wizard-save"><span role="status">{draft.status}</span>{draft.error&&<p role="alert">Your latest changes haven’t saved. Keep this tab open.<button className="text-button" onClick={()=>void draft.flush().catch(()=>{})}>Retry saving</button></p>}<p>Free hosting can lose saved photos and checks when it restarts. Keep important originals on your device.</p></footer>
    </>}
  </div>;
}
