// @vitest-environment jsdom
// Mocked responses are software fixtures, not a live inspection recording.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Inspect from './Inspect';
import type { EvaluationTrial, InspectionRecord, WorkspaceTemplate } from './types';
import type { SceneObject } from '../types';

vi.mock('../api',()=>({analyze:vi.fn(),analyzeAI:vi.fn()}));
vi.mock('../ConnectionStatus',()=>({default:()=> <div>AI connection status</div>}));
vi.mock('./api',()=>({listTemplates:vi.fn(),getTemplate:vi.fn(),saveTemplate:vi.fn(),deleteTemplate:vi.fn(),templateHistory:vi.fn(),getInspection:vi.fn(),alignPhoto:vi.fn(),scanWorkspace:vi.fn(),reviewInspection:vi.fn(),planCorrections:vi.fn(),explainInspection:vi.fn(),inspectionReport:vi.fn(),listEvaluationTrials:vi.fn(),getEvaluationTrial:vi.fn(),createEvaluationTrial:vi.fn(),saveEvaluationCapture:vi.fn(),evaluationReport:vi.fn(),exportEvaluationTrial:vi.fn()}));
import { analyze, analyzeAI } from '../api';
import * as api from './api';

const template:WorkspaceTemplate={id:'workspace-1',revision:1,name:'Workshop',description:'Return tools to marked positions.',location:'Bench A',reference_image_url:'data:image/jpeg;base64,reference',image_width:1000,image_height:600,workspace:{x:.03,y:.03,width:.94,height:.94},clearance:.005,created_at:'2026-10-26T12:00:00Z',updated_at:'2026-10-26T12:00:00Z',objects:[{id:'book',label:'Book',box:{x:.1,y:.1,width:.1,height:.1},locked:false,required:true,tolerance:.025},{id:'cup',label:'Cup',box:{x:.75,y:.1,width:.1,height:.1},locked:true,required:true,tolerance:.025}]};
const observed:SceneObject[]=template.objects.map(o=>({...o,id:`d-${o.id}`,source:'sam_3_1',confidence:.91}));
function trial():InspectionRecord {
  const facts={passed:true,status:'passed',review_required:false,objects:template.objects.map((o,index)=>({object_id:o.id,label:o.label,detection_id:`d-${o.id}`,status:'correct',severity:'info' as const,source:'ai_generated' as const,certainty:'supported',provider_confidence:.91,observed_box:observed[index].box,expected_box:o.box,required:true,protected:o.locked,reasons:[]})),additional_objects:[],observed_objects:template.objects,issues:[],inventory_confirmed:true,evidence_mode:'automatic',correct_count:2,reference_count:2,issue_count:0,message:'Workspace matches reviewed reference.'};
  return {id:'scan-1',revision:1,created_at:'2026-10-26T12:05:00Z',template_id:template.id,template_revision:1,template_snapshot:structuredClone(template),current_image_url:'data:image/jpeg;base64,current',aligned_image:{image_url:'data:image/jpeg;base64,aligned',width:1000,height:600,comparison_allowed:true,workspace_coverage:1,alignment:{tx:0,ty:0,scale:1,rotation:0,confirmed:true},warnings:[]},analysis:{objects:structuredClone(observed),provider:'meta',model:'sam-3.1',concepts:['Book','Cup'],summary:'Review',message:'Review',warnings:[]},automatic_result:facts,reviewed_result:null,review:null,latency_ms:1234,previous_inspection_id:null,correction_plan:null,explanation:null,warnings:[]};
}
beforeEach(()=>{
  vi.mocked(api.listTemplates).mockResolvedValue({templates:[template]});
  vi.mocked(api.getTemplate).mockResolvedValue(structuredClone(template));
  vi.mocked(api.templateHistory).mockResolvedValue({inspections:[]});
  vi.mocked(api.saveTemplate).mockResolvedValue(structuredClone(template));
  vi.mocked(api.scanWorkspace).mockResolvedValue(trial());
  vi.mocked(analyze).mockResolvedValue({image_url:'data:image/jpeg;base64,current',width:1000,height:600,name:'current.jpg',annotation_source:'manual',message:'Prepared'});
  vi.mocked(analyzeAI).mockResolvedValue({objects:structuredClone(observed),concepts:['book','cup'],summary:'Actual response fixture',message:'Review every object.',warnings:[],provider:'meta',model:'sam-3.1'});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
async function openTemplate(){fireEvent.click(await screen.findByRole('button',{name:/Workshop/}));await screen.findByRole('button',{name:'Choose current photograph'});}
async function uploadCurrent(){fireEvent.change(screen.getByLabelText('Upload workspace inspection image'),{target:{files:[new File(['synthetic'],'current.jpg',{type:'image/jpeg'})]}});await screen.findByLabelText('Reference overlay alignment confirmed');}
async function inspect(){await openTemplate();await uploadCurrent();fireEvent.click(screen.getByLabelText('Reference overlay alignment confirmed'));fireEvent.click(screen.getByRole('button',{name:'Inspect workspace'}));await screen.findByText('Object findings');}

it('starts with reusable workspace onboarding and never infers on mount',async()=>{
  vi.mocked(api.listTemplates).mockResolvedValue({templates:[]});render(<Inspect/>);
  expect(await screen.findByText('Make your workspace repeatable.')).toBeTruthy();
  expect(analyzeAI).not.toHaveBeenCalled();expect(api.scanWorkspace).not.toHaveBeenCalled();
});
it('creates a reviewed reference with required, protected and tolerance settings',async()=>{
  render(<Inspect/>);await screen.findByRole('button',{name:/Workshop/});
  fireEvent.click(screen.getByRole('button',{name:'New template'}));
  fireEvent.change(screen.getByLabelText('Workspace template name'),{target:{value:'Workshop'}});
  fireEvent.change(screen.getByLabelText('Upload inspection reference image'),{target:{files:[new File(['synthetic'],'reference.jpg',{type:'image/jpeg'})]}});
  await screen.findByRole('button',{name:'Identify with Meta AI'});
  expect(analyzeAI).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Identify with Meta AI'}));
  await screen.findByLabelText('Required Book');
  expect((screen.getByRole('button',{name:'Save workspace template'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Required Book'));fireEvent.click(screen.getByLabelText('Protected Cup'));
  fireEvent.change(screen.getByLabelText('Tolerance Book'),{target:{value:'3'}});
  fireEvent.click(screen.getByLabelText('Reference annotations reviewed'));
  fireEvent.click(screen.getByRole('button',{name:'Save workspace template'}));
  await waitFor(()=>expect(api.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({annotations_reviewed:true,objects:expect.arrayContaining([expect.objectContaining({label:'Book',required:false,tolerance:.03})])}),undefined));
});
it('blocks inspection until overlay alignment is confirmed and clears confirmation on edits',async()=>{
  render(<Inspect/>);await openTemplate();await uploadCurrent();
  const scan=screen.getByRole('button',{name:'Inspect workspace'}) as HTMLButtonElement;
  expect(scan.disabled).toBe(true);expect(api.scanWorkspace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Reference overlay alignment confirmed'));expect(scan.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Alignment rotation'),{target:{value:'2'}});expect(scan.disabled).toBe(true);
  expect((screen.getByLabelText('Reference overlay alignment confirmed') as HTMLInputElement).checked).toBe(false);
});
it('treats automatic registration as a suggestion needing confirmation',async()=>{
  vi.mocked(api.alignPhoto).mockResolvedValue({status:'suggestion',alignment:{tx:.01,ty:0,scale:1,rotation:0,confirmed:false},message:'Check surface features.'});
  render(<Inspect/>);await openTemplate();await uploadCurrent();
  fireEvent.click(screen.getByRole('button',{name:'Suggest alignment'}));await screen.findByText('Check surface features.');
  expect((screen.getByRole('button',{name:'Inspect workspace'}) as HTMLButtonElement).disabled).toBe(true);
  expect(api.scanWorkspace).not.toHaveBeenCalled();
});
it('never confirms missing solely from a failed detection',async()=>{
  const value=trial();value.automatic_result.objects[0].status='suspected_missing';value.automatic_result.objects[0].certainty='missing';value.automatic_result.objects[0].detection_id=null;value.automatic_result.objects[0].observed_box=null;value.automatic_result.passed=false;value.automatic_result.review_required=true;value.automatic_result.status='needs_review';value.analysis.objects=[observed[1]];
  vi.mocked(api.scanWorkspace).mockResolvedValue(value);render(<Inspect/>);await inspect();
  expect(screen.getByText('suspected missing')).toBeTruthy();expect(screen.queryByText('Workspace verified')).toBeNull();
  const corrected=structuredClone(value);corrected.revision=2;corrected.reviewed_result=structuredClone(value.automatic_result);corrected.reviewed_result.objects[0].status='confirmed_missing';corrected.reviewed_result.objects[0].source='human_confirmed';
  vi.mocked(api.reviewInspection).mockResolvedValue(corrected);
  fireEvent.change(screen.getByLabelText('Inspect identity book'),{target:{value:'absent'}});
  fireEvent.click(screen.getByLabelText('Confirm inspection identity book'));
  fireEvent.click(screen.getByRole('button',{name:'Apply reviewed inspection'}));
  await waitFor(()=>expect(api.reviewInspection).toHaveBeenCalledWith('scan-1',expect.objectContaining({assignments:{book:null},confirmed_missing_ids:['book']})));
});
it('invalidates displayed success immediately after a manual observation edit',async()=>{
  render(<Inspect/>);await inspect();expect(screen.getByText('Workspace verified')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Book'}));
  fireEvent.change(screen.getByLabelText('Inspection object x'),{target:{value:'25'}});
  expect(screen.queryByText('Workspace verified')).toBeNull();expect(screen.getByText('Review changes before using this result')).toBeTruthy();
  expect((screen.getByRole('button',{name:'Generate correction plan'}) as HTMLButtonElement).disabled).toBe(true);
});
it('withholds arrows for a blocked correction plan and displays the reason',async()=>{
  const value=trial();value.revision=2;value.correction_plan={status:'blocked',message:'Correction plan withheld.',reasons:['Protected object moved.'],movements:[],final_objects:[],locked_ids:['cup'],warnings:[],explored_states:0};
  vi.mocked(api.planCorrections).mockResolvedValue(value);
  render(<Inspect/>);await inspect();fireEvent.click(screen.getByRole('button',{name:'Generate correction plan'}));
  await screen.findByText('Protected object moved.');expect(document.querySelector('animateMotion')).toBeNull();
});
it('verifies another real-photo upload against the pinned template and preceding inspection',async()=>{
  render(<Inspect/>);await inspect();fireEvent.click(screen.getByRole('button',{name:'Verify with another photo'}));
  expect(screen.queryByText('Workspace verified')).toBeNull();
  await uploadCurrent();fireEvent.click(screen.getByLabelText('Reference overlay alignment confirmed'));
  const value=trial();value.id='scan-2';value.previous_inspection_id='scan-1';vi.mocked(api.scanWorkspace).mockResolvedValue(value);
  fireEvent.click(screen.getByRole('button',{name:'Verify correction photo'}));await screen.findByText('Workspace verified');
  expect(api.scanWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({previous_inspection_id:'scan-1',template_revision:1,alignment:expect.objectContaining({confirmed:true})}));
});
it('keeps failed inference recoverable and does not invent a result',async()=>{
  vi.mocked(api.scanWorkspace).mockRejectedValue(new Error('Provider timed out. Retry explicitly.'));
  render(<Inspect/>);await openTemplate();await uploadCurrent();fireEvent.click(screen.getByLabelText('Reference overlay alignment confirmed'));
  fireEvent.click(screen.getByRole('button',{name:'Inspect workspace'}));await screen.findByRole('alert');
  expect(screen.queryByText('Workspace verified')).toBeNull();expect(api.scanWorkspace).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button',{name:'Inspect workspace'}) as HTMLButtonElement).disabled).toBe(false);
});
it('requires a separate delete action and sends the selected template identity',async()=>{
  vi.mocked(api.deleteTemplate).mockResolvedValue({deleted:true});
  render(<Inspect/>);await openTemplate();fireEvent.click(screen.getByRole('button',{name:'Delete template'}));
  expect(api.deleteTemplate).not.toHaveBeenCalled();
  expect(screen.getByText('Delete this template, its reference photo, and all of its inspection history?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Delete template and history'}));
  await waitFor(()=>expect(api.deleteTemplate).toHaveBeenCalledWith('workspace-1'));
});
it('edits the existing template with its revision and renewed annotation review',async()=>{
  render(<Inspect/>);await openTemplate();fireEvent.click(screen.getByRole('button',{name:'Edit template'}));
  expect((screen.getByLabelText('Reference annotations reviewed') as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText('Workspace template name'),{target:{value:'Revised workshop'}});
  fireEvent.click(screen.getByLabelText('Reference annotations reviewed'));
  fireEvent.click(screen.getByRole('button',{name:'Save workspace template'}));
  await waitFor(()=>expect(api.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({name:'Revised workshop',revision:1}),template.id));
});

function savedEvaluation():EvaluationTrial {
  return {id:'eval-1',template_id:template.id,name:'SYNTHETIC saved trial',scenario:'correct_workspace',operator:'Test fixture',created_at:'2026-10-26',template_snapshot:template,captures:[]};
}
function evaluationCapture() {
  const r=trial();
  return {id:'capture-1',stage:'inspection' as const,image_url:r.current_image_url,image_width:1000,image_height:600,alignment:r.aligned_image.alignment,aligned_image:r.aligned_image,image_hash:'synthetic-hash',captured_at:'2026-10-26',notes:'SYNTHETIC only',truth:{objects:[],issues:[],workspace_correct:true,inventory_complete:true,independently_reviewed:true,reviewed_by:'Test fixture'},record:null,attempts:[]};
}
async function resumeEvaluation() {
  await openTemplate();fireEvent.click(screen.getByRole('button',{name:'Evaluate real photographs'}));
  await screen.findByText(/Resume saved trials/);fireEvent.click(screen.getByText(/Resume saved trials/));
  fireEvent.click(screen.getByRole('button',{name:/SYNTHETIC saved trial/}));
  await screen.findByText(/Automatic inference starts with no inventory confirmation/);
}
it('requires frozen labels and forces automatic evaluation to precede inventory confirmation',async()=>{
  const saved=savedEvaluation();vi.mocked(api.listEvaluationTrials).mockResolvedValue({trials:[saved],scenarios:['correct_workspace']});vi.mocked(api.getEvaluationTrial).mockResolvedValue(saved);
  render(<Inspect/>);await resumeEvaluation();await uploadCurrent();fireEvent.click(screen.getByLabelText('Reference overlay alignment confirmed'));
  expect((screen.getByRole('button',{name:'Inspect workspace'}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Inspection inventory confirmed') as HTMLInputElement).disabled).toBe(true);
  const frozen={...saved,captures:[evaluationCapture()]};vi.mocked(api.getEvaluationTrial).mockResolvedValue(frozen);
  fireEvent.click(screen.getByRole('button',{name:'Reload trials'}));await screen.findByText(/Ready for the first scan below/);
  fireEvent.click(screen.getByRole('button',{name:'Inspect workspace'}));
  await waitFor(()=>expect(api.scanWorkspace).toHaveBeenCalledWith(expect.objectContaining({evaluation_capture_id:'capture-1',inventory_confirmed:false})));
  expect(api.scanWorkspace).toHaveBeenCalledTimes(1);
  expect(api.scanWorkspace).not.toHaveBeenCalledWith(expect.objectContaining({truth:expect.anything()}));
});
it('opens saved trial inference as recorded evidence without making a provider request',async()=>{
  const saved={...savedEvaluation(),captures:[{...evaluationCapture(),record:trial(),attempts:[{id:'attempt',status:'completed',started_at:'2026-10-26'}]}]};
  vi.mocked(api.listEvaluationTrials).mockResolvedValue({trials:[saved],scenarios:['correct_workspace']});vi.mocked(api.getEvaluationTrial).mockResolvedValue(saved);
  render(<Inspect/>);await resumeEvaluation();await screen.findByText(/Saved inference is available below/);
  expect(screen.getByText('Workspace verified')).toBeTruthy();expect(api.scanWorkspace).not.toHaveBeenCalled();
});
