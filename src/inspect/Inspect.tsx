import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCheck, Download, Focus, Plus, ScanLine, ShieldCheck, Sparkles } from 'lucide-react';
import Canvas from '../Canvas';
import OperationStatus from '../ui/OperationStatus';
import Photo from '../ui/Photo';
import PhotoComparison from '../ui/PhotoComparison';
import PhotoActions from '../PhotoActions';
import { exportJSON } from '../exportFile';
import ConnectionStatus from '../ConnectionStatus';
import { analyze, analyzeAI } from '../api';
import type { AIAnalysis, Box, Plan, SceneImage, SceneObject, Tool } from '../types';
import AlignmentView from './AlignmentView';
import ObjectEditor from './ObjectEditor';
import EvaluationPanel from './EvaluationPanel';
import FirstInspectionGuide from './FirstInspectionGuide';
import { inferenceEvidence } from '../inferenceEvidence';
import * as api from './api';
import { DEFAULT_ALIGNMENT } from './types';
import type { Alignment, EvaluationTrial, InspectionRecord, ReferenceObject, TemplateSummary, WorkspaceTemplate } from './types';

const STAGES=['Create Template','Scan Workspace','Inspect','Fix Issues','Verify'];
const DEFAULT_WORKSPACE={x:.03,y:.03,width:.94,height:.94};
const errorText=(e:unknown)=>e instanceof Error?e.message:'The action could not be completed. Please retry.';
const statusText=(value:string)=>value.replaceAll('_',' ');

export default function Inspect({active=true,initialTemplateId,initialInspectionId,navigationIntent}:{active?:boolean;initialTemplateId?:string;initialInspectionId?:string;navigationIntent?:string}) {
  const [templates,setTemplates]=useState<TemplateSummary[]>([]);
  const [template,setTemplate]=useState<WorkspaceTemplate|null>(null);
  const [stage,setStage]=useState(0);
  const [editing,setEditing]=useState(false);
  const [draftId,setDraftId]=useState<string>();
  const [draftRevision,setDraftRevision]=useState<number>();
  const [name,setName]=useState('');
  const [description,setDescription]=useState('');
  const [location,setLocation]=useState('');
  const [reference,setReference]=useState<SceneImage|null>(null);
  const [referenceAnalysis,setReferenceAnalysis]=useState<AIAnalysis|null>(null);
  const [referenceLatency,setReferenceLatency]=useState<number|null>(null);
  const [objects,setObjects]=useState<ReferenceObject[]>([]);
  const [workspace,setWorkspace]=useState<Box>(DEFAULT_WORKSPACE);
  const [clearance,setClearance]=useState(.005);
  const [referenceReviewed,setReferenceReviewed]=useState(false);
  const [concepts,setConcepts]=useState('');
  const [tool,setTool]=useState<Tool>('select');
  const [selected,setSelected]=useState<string|null>(null);
  const [current,setCurrent]=useState<SceneImage|null>(null);
  const [alignment,setAlignment]=useState<Alignment>({...DEFAULT_ALIGNMENT});
  const [alignmentNotice,setAlignmentNotice]=useState('');
  const [discover,setDiscover]=useState(true);
  const [extraConcepts,setExtraConcepts]=useState('');
  const [inventory,setInventory]=useState(false);
  const [record,setRecord]=useState<InspectionRecord|null>(null);
  const [previous,setPrevious]=useState<InspectionRecord|null>(null);
  const [observations,setObservations]=useState<SceneObject[]>([]);
  const [assignments,setAssignments]=useState<Record<string,string>>({});
  const [confirmed,setConfirmed]=useState<string[]>([]);
  const [ignored,setIgnored]=useState<string[]>([]);
  const [pendingReview,setPendingReview]=useState(false);
  const [activeMove,setActiveMove]=useState(1);
  const [history,setHistory]=useState<{id:string;revision:number;created_at:string}[]>([]);
  const [deletePending,setDeletePending]=useState(false);
  const [busy,setBusy]=useState<string|null>('Loading workspace templates…');
  const openedIntent=useRef<string|undefined>(undefined);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState('');
  const [evaluationOpen,setEvaluationOpen]=useState(false);
  const [firstGuide,setFirstGuide]=useState(false);
  const [evaluation,setEvaluation]=useState<EvaluationTrial|null>(null);
  const [evaluationPhase,setEvaluationPhase]=useState<'inspection'|'corrected'>('inspection');
  const evaluationCapture=evaluation?.captures.find(c=>c.stage===evaluationPhase);
  const referenceInput=useRef<HTMLInputElement>(null), currentInput=useRef<HTMLInputElement>(null);
  const lock=useRef(false);
  const errorRef=useRef<HTMLDivElement>(null);
  const facts=record?.reviewed_result??record?.automatic_result;

  useEffect(()=>{
    let mounted=true;
    api.listTemplates().then(value=>{if(mounted)setTemplates(value.templates);}).catch(e=>{if(mounted)setError(errorText(e));}).finally(()=>{if(mounted)setBusy(null);});
    return ()=>{mounted=false;};
  },[]);
  useEffect(()=>{if(error&&active)errorRef.current?.scrollIntoView?.({behavior:'instant',block:'nearest'});},[error,active]);
  useEffect(()=>{
    if(!active||busy)return;
    const intent=initialInspectionId?`inspection:${initialInspectionId}`:initialTemplateId?`template:${initialTemplateId}`:'';
    if(!intent||openedIntent.current===intent+navigationIntent)return;
    openedIntent.current=intent+navigationIntent;
    if(initialInspectionId)void action('Opening saved inspection…',async()=>{
      const value=await api.getInspection(initialInspectionId);
      loadRecord(value);setEditing(false);setEvaluation(null);setEvaluationOpen(false);setPrevious(null);setCurrent(null);setStage(2);
    });
    else if(initialTemplateId==='new'){if(!editing)startNew();}
    else if(initialTemplateId)void selectTemplate(initialTemplateId);
  },[active,busy,initialTemplateId,initialInspectionId,navigationIntent]);
  async function action(label:string,operation:()=>Promise<void>) {
    if(lock.current || busy)return;
    lock.current=true;setBusy(label);setError(null);setNotice('');
    try{await operation();}catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(null);}
  }
  async function refreshList(){setTemplates((await api.listTemplates()).templates);}
  function loadRecord(value:InspectionRecord) {
    setRecord(value);setTemplate(value.template_snapshot);setObservations(value.review?.manual_objects.length ? value.analysis.objects.map(o=>value.review!.manual_objects.find(m=>m.id===o.id)??o).concat(value.review.manual_objects.filter(m=>!value.analysis.objects.some(o=>o.id===m.id))) : value.analysis.objects);
    const latest=value.reviewed_result??value.automatic_result;
    setAssignments(Object.fromEntries(latest.objects.map(o=>[o.object_id,value.review?.confirmed_missing_ids.includes(o.object_id)?'absent':o.detection_id??''])));
    setConfirmed(Object.keys(value.review?.assignments??{}));setIgnored(value.review?.ignored_detection_ids??[]);
    setInventory(latest.inventory_confirmed);setPendingReview(false);setSelected(null);setTool('select');setActiveMove(1);
  }
  function startNew() {
    setEvaluationOpen(false);setEvaluation(null);
    setReferenceAnalysis(null);setReferenceLatency(null);
    setEditing(true);setStage(0);setDraftId(undefined);setDraftRevision(undefined);setName('');setDescription('');setLocation('');
    setReference(null);setObjects([]);setWorkspace(DEFAULT_WORKSPACE);setClearance(.005);setReferenceReviewed(false);setConcepts('');setSelected(null);setDeletePending(false);setError(null);setNotice('');
  }
  function editTemplate() {
    if(!template)return;
    setEvaluationOpen(false);setEvaluation(null);
    setReferenceAnalysis(template.reference_analysis??null);setReferenceLatency(template.reference_inference_wall_ms??null);
    setEditing(true);setStage(0);setDraftId(template.id);setDraftRevision(template.revision);setName(template.name);setDescription(template.description);setLocation(template.location);
    setReference({image_url:template.reference_image_url,width:template.image_width,height:template.image_height,name:template.name});setObjects(structuredClone(template.objects));setWorkspace(template.workspace);setClearance(template.clearance);setReferenceReviewed(false);setSelected(template.objects[0]?.id??null);setTool('select');setNotice('');
  }
  async function selectTemplate(id:string) {
    await action('Opening workspace…',async()=>{
      setEvaluationOpen(false);setEvaluation(null);
      const value=await api.getTemplate(id);setTemplate(value);setEditing(false);setStage(1);setCurrent(null);setRecord(null);setPrevious(null);setDeletePending(false);setAlignment({...DEFAULT_ALIGNMENT});setAlignmentNotice('');
      setHistory((await api.templateHistory(id)).inspections);
    });
  }
  function updateReference(next:SceneObject[]) {
    if(busy)return;
    setObjects(next.map(o=>{
      const old=objects.find(item=>item.id===o.id);
      const changed=old&&(old.label!==o.label||JSON.stringify(old.box)!==JSON.stringify(o.box));
      return {...o,required:old?.required??true,tolerance:old?.tolerance??.025,...(changed?{source:'ai_corrected' as const,confidence:null}:{})};
    }));setReferenceReviewed(false);
  }
  async function upload(file:File|undefined,isReference:boolean) {
    if(!file||(!isReference&&evaluationCapture))return;
    await action('Preparing photograph…',async()=>{
      const value=await analyze(file);const image={image_url:value.image_url,width:value.width,height:value.height,name:file.name};
      if(isReference){setReference(image);setReferenceAnalysis(null);setReferenceLatency(null);setWorkspace(DEFAULT_WORKSPACE);setObjects([]);setReferenceReviewed(false);setSelected(null);setTool('object');}
      else {setCurrent(image);setAlignment({...DEFAULT_ALIGNMENT});setAlignmentNotice('');setInventory(false);setRecord(null);setPendingReview(false);}
    });
  }
  async function detectReference() {
    if(!reference)return;
    await action('Meta AI is identifying reference objects…',async()=>{
      const phrases=concepts.split(',').map(s=>s.trim()).filter(Boolean);
      const started=performance.now();const value=await analyzeAI(reference.image_url,phrases);
      setReferenceAnalysis(value);setReferenceLatency(Math.round(performance.now()-started));
      setObjects(value.objects.map(o=>({...o,required:true,tolerance:.025})));setReferenceReviewed(false);setSelected(value.objects[0]?.id??null);setTool('select');setNotice(value.message+' '+value.warnings.join(' '));
    });
  }
  async function save() {
    if(!reference)return;
    await action('Saving reference workspace…',async()=>{
      const value=await api.saveTemplate({name,description,location,reference_image_url:reference.image_url,objects,workspace,clearance,annotations_reviewed:referenceReviewed,reference_analysis:referenceAnalysis,reference_inference_wall_ms:referenceLatency,...(draftRevision?{revision:draftRevision}:{})},draftId);
      setTemplate(value);setEditing(false);setStage(1);setCurrent(null);setRecord(null);setPrevious(null);setHistory([]);await refreshList();setNotice('Workspace template saved to this backend. Download a backup to keep a copy.');
    });
  }
  async function align(automatic:boolean) {
    if(!template||!current)return;
    await action(automatic?'Matching stationary surface features…':'Checking aligned workspace coverage…',async()=>{
      const value=await api.alignPhoto(template.id,current.image_url,alignment,automatic,previous?.id??null,evaluation?.id??null);
      if(automatic){if(value.alignment)setAlignment({...value.alignment,confirmed:false});setAlignmentNotice(`${value.message??''}${value.fit?` ${value.fit.inliers}/${value.fit.matches} background matches agreed; fit error ${value.fit.rms_error_pixels_at_900}px.`:''}`);}
      else setAlignmentNotice(`${((value.workspace_coverage??0)*100).toFixed(1)}% workspace coverage. ${(value.warnings??[]).join(' ')}`);
    });
  }
  async function scan() {
    if(!template||!current||(evaluation&&!evaluationCapture))return;
    await action(previous?'Checking the correction photograph…':'Inspecting workspace with Meta AI…',async()=>{
      try {
        const value=await api.scanWorkspace({template_id:template.id,template_revision:template.revision,image_url:current.image_url,alignment,inventory_confirmed:evaluation?false:inventory,discover_unexpected:discover,extra_concepts:extraConcepts.split(',').map(s=>s.trim()).filter(Boolean),previous_inspection_id:previous?.id??null,...(evaluationCapture?{evaluation_capture_id:evaluationCapture.id}:{})});
        loadRecord(value);setStage(previous||(evaluation&&evaluationPhase==='corrected')?4:2);setHistory((await api.templateHistory(template.id)).inspections);
      } finally { if(evaluation) {try{setEvaluation(await api.getEvaluationTrial(evaluation.id));}catch{/* Retain the photo and let Reload trials recover after an outage. */}} }
    });
  }
  function updateObservations(next:SceneObject[]) {
    if(busy)return;
    const changed=new Set(next.filter(o=>JSON.stringify(o)!==JSON.stringify(observations.find(old=>old.id===o.id))).map(o=>o.id));
    setObservations(next.map(o=>changed.has(o.id)?{...o,source:'ai_corrected',confidence:null}:o));
    setConfirmed(confirmed.filter(id=>!changed.has(assignments[id])));setPendingReview(true);setInventory(false);
  }
  async function applyReview() {
    if(!record)return;
    await action('Checking reviewed observations…',async()=>{
      const choices=Object.fromEntries(confirmed.map(id=>[id,assignments[id]==='absent'?null:assignments[id]]));
      const value=await api.reviewInspection(record.id,{assignments:choices,confirmed_missing_ids:confirmed.filter(id=>assignments[id]==='absent'),manual_objects:observations.filter(o=>o.source!=='sam_3_1'||!record.analysis.objects.some(d=>d.id===o.id)),ignored_detection_ids:ignored,inventory_confirmed:inventory,revision:record.revision});
      loadRecord(value);setNotice('Review saved. The original automatic result remains separate in the report.');
      if(evaluation)setEvaluation(await api.getEvaluationTrial(evaluation.id));
    });
  }
  async function corrections() {
    if(!record)return;
    await action('Validating correction movements…',async()=>{const value=await api.planCorrections(record.id,record.revision);setRecord(value);setStage(3);setActiveMove(1);if(evaluation)setEvaluation(await api.getEvaluationTrial(evaluation.id));});
  }
  async function explain() {
    if(!record)return;
    await action('Muse Spark is explaining the inspection…',async()=>{setRecord(await api.explainInspection(record.id,record.revision));if(evaluation)setEvaluation(await api.getEvaluationTrial(evaluation.id));});
  }
  function startVerification() {
    if(!record)return;
    if(evaluation){changeEvaluationPhase('corrected');return;}
    setPrevious(record);setTemplate(record.template_snapshot);setRecord(null);setCurrent(null);setAlignment({...DEFAULT_ALIGNMENT});setAlignmentNotice('');setStage(4);setInventory(false);setPendingReview(false);setError(null);setNotice('Take a new photograph after physical corrections. The original template revision remains pinned.');
  }
  function resumeEvaluation(value:EvaluationTrial,resume:boolean) {
    setEvaluation(value);
    if(resume) {
      const phase=value.captures.some(c=>c.stage==='corrected')?'corrected':'inspection';
      showEvaluationPhase(value,phase);
    }
  }
  function showEvaluationPhase(value:EvaluationTrial,phase:'inspection'|'corrected') {
    const capture=value.captures.find(c=>c.stage===phase);
    const initial=value.captures.find(c=>c.stage==='inspection');
    setEvaluationPhase(phase);setTemplate(value.template_snapshot);setEditing(false);setPrevious(phase==='corrected'?initial?.record??null:null);
    setCurrent(capture?{image_url:capture.image_url,width:capture.image_width,height:capture.image_height,name:`Saved ${phase} photograph`}:null);
    setAlignment(capture?capture.alignment:{...DEFAULT_ALIGNMENT});setAlignmentNotice('');setRecord(null);setInventory(false);setPendingReview(false);setError(null);
    if(capture?.record){loadRecord(capture.record);setStage(phase==='corrected'?4:2);}else setStage(phase==='corrected'?4:1);
  }
  function changeEvaluationPhase(phase:'inspection'|'corrected'){if(evaluation)showEvaluationPhase(evaluation,phase);}
  async function exportReport() {
    if(!record)return;
    await action('Preparing inspection report…',async()=>{
      const report=await api.inspectionReport(record.id);await exportJSON(report,`worldos-inspect-${record.id}.json`);
    });
  }
  const busyFlag=!!busy;
  const selectedReference=objects.find(o=>o.id===selected);
  const selectedObservation=observations.find(o=>o.id===selected);
  const usablePlan=record?.correction_plan&&['ready','already_clear'].includes(record.correction_plan.status)?record.correction_plan as Plan:null;
  const duplicateChoices=confirmed.map(id=>assignments[id]).filter(value=>value&&value!=='absent');
  const invalidChoices=new Set(duplicateChoices).size!==duplicateChoices.length||confirmed.some(id=>!assignments[id]);
  function scene(image:SceneImage,items:SceneObject[],editable=false,plan:Plan|null=null) {
    return <Canvas disabled={busyFlag} image={image} objects={items} target={null} workspace={editing?workspace:template?.workspace??DEFAULT_WORKSPACE} tool={editable?tool:'select'} selected={selected} onSelect={setSelected}
      onObjects={editing?updateReference:updateObservations} onTarget={()=>{}} onWorkspace={box=>{setWorkspace(box);setReferenceReviewed(false);setTool('select');}}
      onAdd={box=>{if(busy)return;if(editing){if(objects.length>=12)return;const id=crypto.randomUUID();updateReference([...objects,{id,label:`Object ${objects.length+1}`,box,locked:false}]);setSelected(id);}else{if(observations.length>=24)return;const id=`manual-${crypto.randomUUID()}`;updateObservations([...observations,{id,label:`Observed object ${observations.length+1}`,box,locked:false,source:'manual',confidence:null}]);setSelected(id);}setTool('select');}}
      mode={editable?'annotate':'plan'} showBoxes plan={plan} activeMovement={stage===3?activeMove:undefined}
      placementStatuses={Object.fromEntries((facts?.objects??[]).flatMap(o=>{
        const status=o.status==='correct'?'completed':o.status==='misplaced'||o.status==='protected_moved'?'incomplete':'uncertain';
        return [[o.object_id,status],...(o.detection_id?[[o.detection_id,status]]:[])];
      }))}/>;
  }

  return <div className="inspect-shell">
    <div className="inspection-toolbar"><button className="secondary" aria-expanded={firstGuide} onClick={()=>setFirstGuide(!firstGuide)}>{firstGuide?'Hide first-inspection guide':'Guide my first inspection'}</button>
      {firstGuide&&template&&!editing&&<button className="primary" disabled={busyFlag||evaluationOpen} onClick={()=>setEvaluationOpen(true)}>Record this physical test</button>}</div>
    {firstGuide&&<FirstInspectionGuide trial={evaluation}/>}
    <header className="inspect-heading"><div><span className="section-kicker"><ScanLine size={16}/> WORLDOS INSPECT</span><h1>A place for everything.<br/><span>Know when it changes.</span></h1><p>Save the standard. Inspect the workspace. Restore it with confidence you can review.</p></div><div className="inspect-local"><ShieldCheck size={19}/><span>Templates stay on your backend<br/>AI runs only when you ask</span></div></header>
    {template&&!editing&&<div className="inspection-toolbar"><button className="secondary" disabled={busyFlag||evaluationOpen} onClick={()=>setEvaluationOpen(true)}>Evaluate real photographs</button><span>Capture, label, and measure a complete physical trial.</span></div>}
    <nav className="inspect-stages" aria-label="Inspection stages">{STAGES.map((label,index)=><button key={label} disabled={busyFlag||(index===0&&!editing)||(index===1&&!template)||(index===2&&!record)||(index===3&&!record?.correction_plan)||(index===4&&!previous&&!record)} aria-current={stage===index?'step':undefined} onClick={()=>setStage(index)}><span>{index+1}</span>{label}</button>)}</nav>
    {error&&<div ref={errorRef} className="error-banner" role="alert"><span>{error}</span><button disabled={busyFlag} onClick={()=>setError(null)}>Dismiss</button><button disabled={busyFlag} onClick={()=>void action('Refreshing templates…',refreshList)}>Reconnect</button></div>}
    <div className="workflow-feedback">{busy?<OperationStatus key={busy} message={busy}/>:notice?<div className="inspect-notice" role="status">{notice}</div>:null}</div>
    <div className="inspect-layout"><aside className="inspect-library panel"><div className="panel-title"><h2>Your workspaces</h2><button className="icon-button" disabled={busyFlag} onClick={startNew} aria-label="Create workspace template"><Plus size={18}/></button></div><div className="inspect-library-body">
      <button className="secondary full-width" disabled={busyFlag} onClick={startNew}><Plus size={15}/>New template</button>
      {!templates.length&&!busy&&<p>No templates yet. Capture the workspace as it should look, then save your reference.</p>}
      {templates.map(t=><button key={t.id} className={`template-choice ${template?.id===t.id?'selected':''}`} disabled={busyFlag} onClick={()=>void selectTemplate(t.id)}><strong>{t.name}</strong><small>Reference v{t.revision} · {new Date(t.updated_at).toLocaleDateString()}</small></button>)}
      {template&&!editing&&<><div className="inspect-library-meta"><strong>{template.name}</strong><p>{template.location||'Local workspace'} · {template.objects.length} reference objects</p><p>{template.description}</p><button className="secondary full-width" disabled={busyFlag} onClick={editTemplate}>Edit template</button><button className="text-button danger" disabled={busyFlag} onClick={()=>setDeletePending(!deletePending)}>Delete template</button>{deletePending&&<div className="inspection-warning"><p>Delete this template, its reference photo, and all of its inspection history?</p><button className="secondary full-width danger" disabled={busyFlag} onClick={()=>void action('Deleting workspace…',async()=>{await api.deleteTemplate(template.id);setTemplate(null);setRecord(null);setPrevious(null);setCurrent(null);setDeletePending(false);setHistory([]);setStage(0);await refreshList();})}>Delete template and history</button></div>}</div>
      {!!history.length&&<details><summary>Recent inspections ({history.length})</summary>{history.map(item=><button key={item.id} className="template-choice" disabled={busyFlag} onClick={()=>void action('Opening saved inspection…',async()=>{setEvaluation(null);setEvaluationOpen(false);const value=await api.getInspection(item.id);loadRecord(value);setPrevious(null);setCurrent(null);setStage(2);})}>{new Date(item.created_at).toLocaleString()}</button>)}</details>}</>}
      <details className="inspect-connection"><summary>AI connection</summary><ConnectionStatus busy={busy} onBusy={setBusy}/></details>
    </div></aside>
    <section className="inspect-workflow" aria-label="Inspection workspace">
      {evaluationOpen&&template&&!editing&&<EvaluationPanel firstInspection={firstGuide} template={template} trial={evaluation} current={current} alignment={alignment} phase={evaluationPhase} busy={busyFlag} onTrial={resumeEvaluation} onPhase={changeEvaluationPhase} onLeave={()=>{setEvaluationOpen(false);setEvaluation(null);setEvaluationPhase('inspection');}} onBusy={value=>setBusy(value?'Saving or loading evaluation evidence...':null)}/>}

      {!editing&&!template&&<div className="panel inspect-welcome"><ScanLine size={38}/><h2>Make your workspace repeatable.</h2><p>A packing station, a tool bench, or a desk. Start with a reviewed reference, then see what changed each time.</p><button className="primary" disabled={busyFlag} onClick={startNew}>Create your first template <ArrowRight size={16}/></button><p>Photos and annotations are stored on this backend. On free hosting, restarts can erase them. Model detections remain suggestions until their evidence is sufficient or you review them.</p></div>}
      {editing&&<><div className="panel inspection-section"><div className="inspect-section-heading"><div><span className="section-kicker">01 / CREATE TEMPLATE</span><h2>{draftId?'Refine your reference':'Set the workspace standard'}</h2></div><PhotoActions label="Upload reference photo" cameraLabel="Take reference photo" disabled={busyFlag} onPhoto={file=>upload(file,true)}/></div>
        <fieldset disabled={busyFlag} className="template-fields"><label>Workspace name<input aria-label="Workspace template name" maxLength={120} value={name} onChange={e=>{setName(e.target.value);setReferenceReviewed(false);}} placeholder="Packing station A"/></label><label>Location<input aria-label="Workspace location" maxLength={200} value={location} onChange={e=>setLocation(e.target.value)} placeholder="Workshop / north bench"/></label><label className="wide">What does this workspace support?<textarea aria-label="Workspace description" maxLength={2000} rows={2} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Tools must return to their marked positions after each task."/></label></fieldset>
        {reference?<><div className="inspection-toolbar"><button className="secondary" disabled={busyFlag} onClick={()=>setTool('select')}>Select / edit</button><button className="secondary" disabled={busyFlag||objects.length>=12} onClick={()=>setTool('object')}>Draw object</button><button className="secondary" disabled={busyFlag} onClick={()=>setTool('workspace')}>Draw boundary</button><span>Photograph as expected · all coordinates use image percentages</span></div><fieldset disabled={busyFlag} className={busyFlag?'inspect-disabled-canvas':''}>{scene(reference,objects,true)}</fieldset>
        <div className="inspect-ai-row"><label>Object concepts<input aria-label="Reference object concepts" disabled={busyFlag} value={concepts} onChange={e=>setConcepts(e.target.value)} placeholder="parcel, tape dispenser, scanner"/></label><button className="secondary" disabled={busyFlag} onClick={()=>void detectReference()}><Sparkles size={15}/>Identify with Meta AI</button></div><p className="inspect-caption">One noun phrase per comma-separated concept. Leave blank for Muse discovery. Re-running replaces reference boxes. AI actions send this scene to the configured provider and may use credits.</p>
        <div className="reference-objects">{objects.map(o=><div key={o.id} className={`reference-object ${selected===o.id?'selected':''}`}><button disabled={busyFlag} onClick={()=>{setSelected(o.id);setTool('select');}}><strong>{o.label}</strong><small>{o.source==='sam_3_1'?`SAM 3.1 · ${o.confidence==null?'confidence unavailable':`${(o.confidence*100).toFixed(1)}%`}`:o.source==='ai_corrected'?'Manually corrected':'Manual annotation'}</small></button><label><input type="checkbox" aria-label={`Required ${o.label}`} checked={o.required} disabled={busyFlag} onChange={e=>{setObjects(objects.map(item=>item.id===o.id?{...item,required:e.target.checked}:item));setReferenceReviewed(false);}}/>Required</label><label><input type="checkbox" aria-label={`Protected ${o.label}`} checked={o.locked} disabled={busyFlag} onChange={e=>{setObjects(objects.map(item=>item.id===o.id?{...item,locked:e.target.checked}:item));setReferenceReviewed(false);}}/>Protected</label><label>Placement tolerance (%)<input type="number" aria-label={`Tolerance ${o.label}`} min=".5" max="10" step=".1" disabled={busyFlag} value={Number((o.tolerance*100).toFixed(2))} onChange={e=>{setObjects(objects.map(item=>item.id===o.id?{...item,tolerance:Number(e.target.value)/100}:item));setReferenceReviewed(false);}}/></label></div>)}</div>
        {selectedReference&&<ObjectEditor object={selectedReference} busy={busyFlag} onChange={next=>updateReference(objects.map(o=>o.id===next.id?next:o))} onDelete={()=>{updateReference(objects.filter(o=>o.id!==selected));setSelected(null);}}/>}
        <label className="inspection-check"><input type="checkbox" aria-label="Reference annotations reviewed" checked={referenceReviewed} disabled={busyFlag||!objects.length} onChange={e=>setReferenceReviewed(e.target.checked)}/>I reviewed every identity, box, required/optional setting, protected object, and workspace boundary.</label><p className="inspect-caption">Up to 12 objects. Protected placement tolerance is capped at 1%. Optional objects may be absent; present objects still need valid identities and placements.</p><button className="primary" disabled={busyFlag||!referenceReviewed||!name.trim()||!objects.length} onClick={()=>void save()}>Save workspace template <ArrowRight size={16}/></button></>:<div className="inspect-empty"><Focus size={32}/><p>Upload a real reference photo showing the desired workspace. Choose a near-overhead view with a visible, flat working surface.</p></div>}
      </div></>}
      {!editing&&template&&(stage===1||(stage===4&&!record))&&<div className="panel inspection-section"><div className="inspect-section-heading"><div><span className="section-kicker">{stage===4?'05 / VERIFY':'02 / SCAN WORKSPACE'}</span><h2>{stage===4?'Check the physical correction':'What changed since the reference?'}</h2></div>{current&&<PhotoActions label={`Upload ${stage===4?"verification":"inspection"} photo`} cameraLabel={stage===4?"Take verification photo":"Take inspection photo"} disabled={busyFlag||!!evaluationCapture} onPhoto={file=>upload(file,false)}/>}</div>
        {current?<><AlignmentView template={template} current={current} value={alignment} busy={busyFlag||!!evaluationCapture} onChange={value=>{setAlignment(value);setAlignmentNotice('');}}/><div className="inspection-toolbar"><button className="secondary" disabled={busyFlag||!!evaluationCapture} onClick={()=>void align(true)}>Suggest alignment</button><button className="secondary" disabled={busyFlag} onClick={()=>void align(false)}>Check coverage</button><button className="text-button" disabled={busyFlag||!!evaluationCapture} onClick={()=>{setAlignment({...DEFAULT_ALIGNMENT});setAlignmentNotice('');}}>Reset alignment</button></div>{alignmentNotice&&<p className="inspection-warning" role="status">{alignmentNotice}</p>}
        <fieldset disabled={busyFlag} className="inspect-scan-settings"><label className="inspection-check"><input type="checkbox" checked={discover} onChange={e=>setDiscover(e.target.checked)}/>Discover unexpected object types with Muse Spark before SAM inspection</label><label>Additional object concepts<input aria-label="Inspection extra concepts" value={extraConcepts} onChange={e=>setExtraConcepts(e.target.value)} placeholder="pallet, carton, loose cable"/></label><label className="inspection-check"><input type="checkbox" aria-label="Inspection inventory confirmed" disabled={!!evaluation} checked={evaluation?false:inventory} onChange={e=>setInventory(e.target.checked)}/>I checked the entire visible workspace for relevant objects and obstacles.</label><p>Reference labels are always included. Discovery and SAM can miss objects; inspect the photograph and review uncertain results. Upload and alignment make no model requests.</p></fieldset><button className="primary" disabled={busyFlag||(evaluation?!evaluationCapture:!alignment.confirmed)} onClick={()=>void scan()}><ScanLine size={17}/>{evaluationCapture&&!alignment.confirmed?'Record alignment abstention':stage===4?'Verify correction photo':'Inspect workspace'}<ArrowRight size={16}/></button></>:<div className="inspect-empty"><Photo src={template.reference_image_url} alt="Saved workspace reference" width={template.image_width} height={template.image_height}/><p>{stage===4?"Capture a new photograph after physical corrections. Do not reuse the reference or previous inspection photo.":`Reference v${template.revision} is saved. Take a separate photograph of this workspace, then align stationary features before inspection.`}</p><PhotoActions label={stage===4?"Choose verification photograph":"Choose current photograph"} cameraLabel={stage===4?"Take verification photo":"Take inspection photo"} disabled={busyFlag} onPhoto={file=>upload(file,false)}/></div>}
      </div>}
      {!editing&&record&&facts&&stage>=2&&<><section className={`panel inspection-section inspection-summary ${facts.passed&&!pendingReview?'passed':''}`}><div className="inspect-section-heading"><div><span className="section-kicker">{record.previous_inspection_id?'VERIFICATION RESULT':'INSPECTION RESULT'}</span><h2>{pendingReview?'Review changes before using this result':facts.passed?'Workspace verified':facts.review_required?'Review needed':'Workspace needs attention'}</h2></div><button className="secondary" disabled={busyFlag||pendingReview} onClick={()=>void exportReport()}><Download size={15}/>Export report</button></div><p>{pendingReview?'The saved result is historical while observations are being edited.':facts.message}</p><div className="inspection-stats"><div><strong>{facts.correct_count}/{facts.reference_count}</strong><span>correct placements</span></div><div><strong>{facts.issue_count}</strong><span>issues / uncertain findings</span></div><div><strong>{(record.latency_ms/1000).toFixed(1)}s</strong><span>scan + comparison</span></div><div><strong>{record.review||facts.evidence_mode==='human_assisted'?'Human assisted':'AI decisions'}</strong><span>{pendingReview?'changes pending':'with scene confirmation'}</span></div></div>
        {previous&&<p>Progress: {(previous.reviewed_result??previous.automatic_result).correct_count} previously correct → {facts.correct_count} now correct. Each verification uses a fresh photograph; no physical action is assumed.</p>}
        <p className="inspect-caption">{record.analysis.provider} / {record.analysis.model} · {inferenceEvidence(record.analysis)} · template v{record.template_revision} · {new Date(record.created_at).toLocaleString()}</p>
      </section>
      <section className="panel inspection-section"><div className="inspect-photo-pair"><figure><figcaption>REFERENCE · EXPECTED WORKSPACE</figcaption>{scene({image_url:record.template_snapshot.reference_image_url,width:record.template_snapshot.image_width,height:record.template_snapshot.image_height,name:'Reference'},record.template_snapshot.objects)}</figure><figure><figcaption>{stage===3?'CORRECTION MOVEMENTS':'CURRENT · ALIGNED PHOTOGRAPH'}</figcaption>{scene({image_url:record.aligned_image.image_url,width:record.aligned_image.width,height:record.aligned_image.height,name:'Inspection'},stage===3?facts.observed_objects:observations,stage!==3,stage===3?usablePlan:null)}</figure></div>
        <PhotoComparison before={record.template_snapshot.reference_image_url} after={record.aligned_image.image_url} width={record.template_snapshot.image_width} height={record.template_snapshot.image_height}/>
        {record.aligned_image.warnings.map((warning,index)=><p className="inspect-caption" key={index}>{warning}</p>)}
        {stage!==3&&<><div className="inspection-toolbar"><button className="secondary" disabled={busyFlag} onClick={()=>setTool('select')}>Edit observations</button><button className="secondary" disabled={busyFlag||observations.length>=24} onClick={()=>setTool('object')}>Draw missed object</button><span>Editing boxes invalidates displayed success until review is applied.</span></div>{selectedObservation&&<ObjectEditor object={selectedObservation} busy={busyFlag} onChange={next=>updateObservations(observations.map(o=>o.id===next.id?next:o))}/>}</>}
      </section>
      {stage!==3&&<section className="panel inspection-section"><div className="inspect-section-heading"><h2>Object findings</h2><span className="subtle-badge">IDENTITY BEFORE CERTAINTY</span></div><div className="inspection-findings">{facts.objects.map(row=><article key={row.object_id} className={`inspection-finding severity-${row.severity}`}><div className="finding-title"><button disabled={busyFlag} onClick={()=>{setSelected(row.detection_id??null);setTool('select');}}><strong>{row.label}</strong></button><span className="finding-status">{statusText(row.status)}</span><span className="severity-badge">{row.severity}</span></div><p>{row.source==='human_confirmed'?'Human confirmed':`AI-generated · ${row.provider_confidence==null?'confidence unavailable':`SAM confidence ${(row.provider_confidence*100).toFixed(1)}%`}`}{row.protected?' · protected':''}{row.required===false?' · optional':''}</p>{row.reasons?.map((reason,index)=><small key={index}>{reason}</small>)}<div className="inspection-assignment"><label>Observed identity<select aria-label={`Inspect identity ${row.object_id}`} disabled={busyFlag} value={assignments[row.object_id]??''} onChange={e=>{setAssignments({...assignments,[row.object_id]:e.target.value});setConfirmed(confirmed.filter(id=>id!==row.object_id));setPendingReview(true);}}><option value="">Locate manually / unresolved</option><option value="absent">I checked: this object is absent</option>{observations.filter(o=>!ignored.includes(o.id)).map(o=><option key={o.id} value={o.id}>{o.label} · x {(o.box.x*100).toFixed(1)}%, y {(o.box.y*100).toFixed(1)}%</option>)}</select></label><label className="inspection-check"><input type="checkbox" aria-label={`Confirm inspection identity ${row.object_id}`} disabled={busyFlag||!assignments[row.object_id]} checked={confirmed.includes(row.object_id)} onChange={e=>{setConfirmed(e.target.checked?[...confirmed,row.object_id]:confirmed.filter(id=>id!==row.object_id));setPendingReview(true);}}/>I confirm this identity{assignments[row.object_id]==='absent'?' is physically absent':' and its observed box'}.</label></div></article>)}</div>
        {!!facts.additional_objects.length&&<div className="inspection-warning"><strong>Additional observations</strong>{facts.additional_objects.map(row=><p key={row.object_id}>{row.label}: {statusText(row.status)} · {row.source==='human_confirmed'?'Human confirmed':'AI-generated'}. Inspect it before excluding it.</p>)}</div>}
        <details><summary>Review false-positive detections</summary>{record.analysis.objects.map(o=><label className="inspection-check" key={o.id}><input type="checkbox" disabled={busyFlag} aria-label={`Ignore detection ${o.id}`} checked={ignored.includes(o.id)} onChange={e=>{setIgnored(e.target.checked?[...ignored,o.id]:ignored.filter(id=>id!==o.id));setConfirmed(confirmed.filter(id=>assignments[id]!==o.id));setPendingReview(true);setInventory(false);}}/>I checked the photo: {o.label} at {(o.box.x*100).toFixed(1)}%, {(o.box.y*100).toFixed(1)}% is a false detection.</label>)}</details>
        <label className="inspection-check"><input type="checkbox" aria-label="Reviewed inspection inventory confirmed" disabled={busyFlag} checked={inventory} onChange={e=>{setInventory(e.target.checked);setPendingReview(true);}}/>I checked all relevant objects, added missed obstacles, and reviewed unmatched detections.</label>{invalidChoices&&<p role="alert">Choose one distinct observation per confirmed identity, or explicitly confirm its absence.</p>}<button className="secondary" disabled={busyFlag||invalidChoices} onClick={()=>void applyReview()}>Apply reviewed inspection</button><p className="inspect-caption">No inference is made when applying review. Original AI decisions and human changes are stored separately. Suspected missing objects are never confirmed absent automatically.</p>
        {!!facts.issues.length&&<ul className="inspection-warning">{facts.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}
      </section>}
      <section className="panel inspection-section"><div className="inspect-section-heading"><h2>{stage===3?'Restore the workspace':'Understand and resolve'}</h2><button className="secondary" disabled={busyFlag||pendingReview} onClick={()=>void explain()}><Sparkles size={15}/>Explain with Muse Spark</button></div>{record.explanation&&<div className="inspection-explanation"><span className="subtle-badge">AI-GENERATED EXPLANATION · {record.explanation.provider} / {record.explanation.model}</span>{record.explanation.fallback&&<p>Fallback from {record.explanation.fallback.from_provider}: {record.explanation.fallback.reason.replaceAll('_',' ')}. The displayed explanation came from {record.explanation.provider}.</p>}<p>{record.explanation.summary}</p>{record.explanation.findings.map((finding,index)=><p key={index}><strong>{facts.objects.concat(facts.additional_objects).find(o=>o.object_id===finding.object_id)?.label??finding.object_id}: </strong>{finding.explanation} {finding.next_step}</p>)}<small>Advisory explanation. Geometry and inspection decisions are computed independently.</small></div>}
        {stage===3&&record.correction_plan&&<><div className={`inspection-warning ${usablePlan?'valid-plan':''}`}><strong>{record.correction_plan.status==='ready'?'Ordered correction plan':record.correction_plan.status==='already_clear'?'Placements already match':'Correction plan withheld'}</strong><p>{record.correction_plan.message}</p>{record.correction_plan.reasons.map((reason,index)=><p key={index}>{reason}</p>)}</div><ol className="inspection-moves">{usablePlan?.movements.map(move=><li key={move.number}><button className={activeMove===move.number?'selected':''} disabled={busyFlag} onClick={()=>setActiveMove(move.number)}><span>{move.number}</span><div><strong>{move.label}</strong><p>{move.instruction}</p></div></button></li>)}</ol>{record.correction_plan.warnings.map((warning,index)=><p className="inspect-caption" key={index}>{warning}</p>)}</>}
        <div className="inspection-toolbar"><button className="primary" disabled={busyFlag||pendingReview} onClick={()=>void corrections()}><Focus size={16}/>Generate correction plan</button><button className="secondary" disabled={busyFlag||pendingReview} onClick={startVerification}><CheckCheck size={16}/>{evaluationCapture?.stage==='corrected'?'Review saved verification':'Verify with another photo'}</button></div><p className="inspect-caption">Protected objects are never moved by an issued plan. Unresolved matches, absent required objects, unexpected obstacles, and collision dependencies can block correction instructions.</p>
      </section></>}
    </section></div>
    <input className="hidden" type="file" ref={referenceInput} accept="image/jpeg,image/png,image/webp" aria-label="Upload inspection reference image" onChange={e=>{void upload(e.target.files?.[0],true);e.target.value='';}}/>
    <input className="hidden" type="file" ref={currentInput} accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Upload workspace inspection image" onChange={e=>{void upload(e.target.files?.[0],false);e.target.value='';}}/>
  </div>;
}
