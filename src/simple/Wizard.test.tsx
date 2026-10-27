// @vitest-environment jsdom
// Synthetic UI responses: these tests do not establish live or physical accuracy.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Wizard from './Wizard';
import { emptyReview, emptyState } from './types';
import type { InspectionRecord, WorkspaceTemplate } from '../inspect/types';
import { navigate } from '../navigation';
vi.mock('../photos',()=>({normalizePhoto:vi.fn(async f=>f),nativePhoto:vi.fn()}));
vi.mock('../api',()=>({analyze:vi.fn(),analyzeAI:vi.fn(),connectionDiagnostics:vi.fn()}));
vi.mock('../inspect/api',()=>({listTemplates:vi.fn(),listDrafts:vi.fn(),getDraft:vi.fn(),saveDraft:vi.fn(),getTemplate:vi.fn(),saveTemplate:vi.fn(),getInspection:vi.fn(),scanWorkspace:vi.fn(),recognizePhoto:vi.fn(),manualScan:vi.fn(),reviewInspection:vi.fn(),planCorrections:vi.fn(),alignPhoto:vi.fn()}));
import * as api from '../inspect/api';
import { analyze, analyzeAI, connectionDiagnostics } from '../api';
const image={image_url:'data:image/jpeg;base64,synthetic',width:600,height:400,name:'synthetic.jpg'};
const phone={id:'phone',label:'phone',box:{x:.1,y:.2,width:.1,height:.2},locked:false,required:true,tolerance:.025,source:'sam_3_1' as const,confidence:.95};
const template:WorkspaceTemplate={id:'space',revision:1,name:'My desk',description:'',location:'',reference_image_url:image.image_url,image_width:600,image_height:400,workspace:{x:0,y:0,width:1,height:1},clearance:.005,objects:[phone],created_at:'2026-10-27',updated_at:'2026-10-27'};
function result(manual=false,passed=false):InspectionRecord{
  const facts={passed,status:passed?'passed':'issues_found',review_required:false,objects:[{object_id:'phone',label:'phone',detection_id:'phone',status:passed?'correct':'misplaced',severity:'medium' as const,source:'human_confirmed' as const,certainty:'reviewed',provider_confidence:null,observed_box:{...phone.box,x:.5},expected_box:phone.box}],additional_objects:[],observed_objects:[{...phone,box:{...phone.box,x:.5}}],issues:[],inventory_confirmed:true,evidence_mode:manual?'human_assisted':'automatic',correct_count:passed?1:0,reference_count:1,issue_count:passed?0:1,message:'Synthetic fixture'};
  return {id:'scan',revision:1,created_at:'2026-10-27',template_id:'space',template_revision:1,template_snapshot:template,current_image_url:image.image_url,aligned_image:{...image,comparison_allowed:true,workspace_coverage:1,warnings:[],alignment:{tx:0,ty:0,scale:1,rotation:0,confirmed:true}},analysis:{objects:manual?[]:[phone],concepts:['phone'],summary:'Fixture',message:'Fixture',warnings:[],provider:manual?'human':'meta',model:manual?'manual-review':'sam-3.1',live_request:false},automatic_result:{...facts,passed:manual?false:passed},reviewed_result:manual?facts:null,review:null,latency_ms:10,previous_inspection_id:null,correction_plan:null,explanation:null,warnings:[]};
}
beforeEach(()=>{
  window.history.replaceState(null,'','#/inspect?template=new');vi.spyOn(window,'scrollTo').mockImplementation(()=>{});localStorage.clear();
  vi.mocked(connectionDiagnostics).mockResolvedValue({selected_sam_provider:'meta',integrations:{}});
  vi.mocked(api.listTemplates).mockResolvedValue({templates:[]});vi.mocked(api.listDrafts).mockResolvedValue({drafts:[]});
  vi.mocked(api.getTemplate).mockResolvedValue(template);vi.mocked(api.saveTemplate).mockResolvedValue(template);
  vi.mocked(api.saveDraft).mockImplementation(async(id,revision)=>({id,revision:revision+1,updated_at:'2026-10-27'}));
  vi.mocked(analyze).mockResolvedValue({...image,annotation_source:'manual',message:'Prepared'});
  vi.mocked(analyzeAI).mockResolvedValue({objects:[phone],concepts:['phone'],summary:'Fixture',message:'Review',warnings:[],provider:'meta',model:'sam-3.1',live_request:false});
  vi.mocked(api.recognizePhoto).mockResolvedValue({analysis:result().analysis,aligned_image:result().aligned_image});
  vi.mocked(api.scanWorkspace).mockResolvedValue(result());vi.mocked(api.manualScan).mockResolvedValue(result(true));
  vi.mocked(api.alignPhoto).mockResolvedValue({...image,comparison_allowed:true,alignment:{tx:0,ty:0,scale:1,rotation:0,confirmed:true}});
});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();});
async function upload(){fireEvent.change(await screen.findByLabelText('Choose from photos library input'),{target:{files:[new File(['synthetic'],'desk.jpg',{type:'image/jpeg'})]}});await screen.findByAltText('Your space');}
async function openCheck(){window.history.replaceState(null,'','#/inspect?template=space');render(<Wizard/>);await screen.findByRole('heading',{name:'Check your space'});await upload();await waitFor(()=>expect((screen.getByLabelText('The fixed background lines up, and I can see the whole setup.') as HTMLInputElement).disabled).toBe(false));fireEvent.click(screen.getByLabelText('The fixed background lines up, and I can see the whole setup.'));}
function outline(label:string){const target=screen.getByRole('button',{name:`Mark ${label} on the photo`});fireEvent.keyDown(target,{key:'Enter'});fireEvent.keyDown(target,{key:'ArrowRight',shiftKey:true});fireEvent.keyDown(target,{key:'ArrowDown',shiftKey:true});fireEvent.keyDown(target,{key:'Enter'});}

it('recognizes each chosen setup photo automatically, then saves a reviewed setup',async()=>{
  render(<Wizard/>);await screen.findByRole('button',{name:'Take a setup photo'});expect(screen.queryByLabelText('Workspace template name')).toBeNull();await upload();
  expect(screen.queryByLabelText('What would you like to keep track of?')).toBeNull();
  await screen.findByText('Does this look right?');expect(analyzeAI).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Name your space'),{target:{value:'My desk'}});fireEvent.click(screen.getByRole('button',{name:'Save this setup'}));
  await screen.findByRole('button',{name:'Take a new photo'});expect(api.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({annotations_reviewed:true,name:'My desk'}));
  expect(screen.getByText(/Your setup is saved/)).toBeTruthy();expect(api.scanWorkspace).not.toHaveBeenCalled();
});
it('keeps the photo and supports keyboard manual setup after an actual analysis error',async()=>{
  vi.mocked(analyzeAI).mockRejectedValue(new Error('The requested model is unavailable to this credential.'));
  render(<Wizard/>);await upload();await screen.findByRole('button',{name:'Retry'});expect(screen.getByText("We couldn't identify your items automatically.")).toBeTruthy();
  expect(screen.getByAltText('Your space').getAttribute('src')).toBe(image.image_url);fireEvent.click(screen.getByRole('button',{name:'Mark items myself (optional)'}));
  fireEvent.change(screen.getByLabelText('What would you like to keep track of?'),{target:{value:'phone'}});fireEvent.click(screen.getByRole('button',{name:'Mark this item'}));outline('phone');
  fireEvent.click(screen.getByRole('button',{name:'Save this setup'}));await screen.findByRole('button',{name:'Take a new photo'});
  expect(api.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({objects:[expect.objectContaining({label:'phone',source:'manual',confidence:null})],reference_analysis:null}));
});
it('requires alignment and a whole-photo review for the manual inspection fallback',async()=>{
  vi.mocked(api.scanWorkspace).mockRejectedValue(new Error('AI model unavailable'));await openCheck();fireEvent.click(screen.getByRole('button',{name:'Check for changes'}));
  await screen.findByText("We couldn't identify your items automatically.");fireEvent.click(screen.getByText('Correct items manually (optional)'));await waitFor(()=>expect((screen.getByRole('button',{name:'Check items myself'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Check items myself'}));await screen.findByRole('heading',{name:'Check each item'});
  expect((screen.getByRole('button',{name:'Save my review'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Mark phone'}));outline('phone');fireEvent.click(screen.getByLabelText('I’ve checked the whole photo, including anything extra.'));
  fireEvent.click(screen.getByRole('button',{name:'Save my review'}));await screen.findByRole('heading',{name:'Your phone has moved.'});
  expect(screen.getByText(/not an independent AI check/)).toBeTruthy();expect(api.manualScan).toHaveBeenCalledTimes(1);
});
it('shows only a validated movement and requests a new photo without claiming success',async()=>{
  const r=result();vi.mocked(api.planCorrections).mockResolvedValue({...r,correction_plan:{status:'ready',message:'Validated',movements:[{number:1,object_id:'phone',label:'phone',source:{...phone.box,x:.5},destination:phone.box,instruction:'Legacy coordinates'}],final_objects:[phone],locked_ids:[],warnings:[],explored_states:1,reasons:[]}});
  await openCheck();fireEvent.click(screen.getByRole('button',{name:'Check for changes'}));fireEvent.click(await screen.findByRole('button',{name:'Help me put things back'}));
  expect(await screen.findByText(/Lift your phone and move it left back to the outlined spot/)).toBeTruthy();expect(screen.queryByText('Legacy coordinates')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'I’ve moved it — check again'}));await screen.findByRole('button',{name:'Take a fresh photo'});
  expect(screen.queryByText('Everything is back in place.')).toBeNull();expect(api.scanWorkspace).toHaveBeenCalledTimes(1);
});
it('resumes a saved photo after reopening without repeating any AI request',async()=>{
  const saved={...emptyState(),step:'check' as const,name:'Desk',template_id:'space',current:image};window.history.replaceState(null,'','#/inspect?draft=saved');
  vi.mocked(api.getDraft).mockResolvedValue({id:'saved',revision:3,name:'Desk',step:'check',updated_at:'2026-10-27',state:saved});render(<Wizard/>);
  await screen.findByRole('button',{name:'Check for changes'});expect(screen.getByAltText('Your space').getAttribute('src')).toBe(image.image_url);expect(api.scanWorkspace).not.toHaveBeenCalled();expect(analyzeAI).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);expect(api.saveDraft).not.toHaveBeenCalled();
});
it('prevents duplicate scans and does not pull navigation back on a late result',async()=>{
  let resolve!:(r:InspectionRecord)=>void;vi.mocked(api.scanWorkspace).mockImplementation(()=>new Promise(r=>{resolve=r;}));await openCheck();
  const button=screen.getByRole('button',{name:'Check for changes'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(api.scanWorkspace).toHaveBeenCalledTimes(1));
  act(()=>navigate('home'));await act(async()=>resolve(result()));expect(window.location.hash).toBe('#/home');
});
it('restores an unfinished manual review directly, including positions already marked',async()=>{
  const review={...emptyReview(),assignments:{phone:'manual-phone'},manual_objects:[{...phone,id:'manual-phone',source:'manual' as const}]};
  const saved={...emptyState(),step:'check' as const,name:'Desk',template_id:'space',current:image,manual:true,review,alignment:{tx:0,ty:0,scale:1,rotation:0,confirmed:true}};
  window.history.replaceState(null,'','#/inspect?draft=saved-review');vi.mocked(api.getDraft).mockResolvedValue({id:'saved-review',revision:4,name:'Desk',step:'check',updated_at:'2026-10-27',state:saved});render(<Wizard/>);
  await screen.findByRole('heading',{name:'Check each item'});expect(screen.getByText('You marked its position.')).toBeTruthy();expect(api.manualScan).not.toHaveBeenCalled();expect(api.scanWorkspace).not.toHaveBeenCalled();
});
it('does not present a human-reviewed AI result as independent automatic verification',async()=>{
  const r=result(true,true);r.analysis={...r.analysis,provider:'meta',model:'sam-3.1',live_request:true};r.review=emptyReview();r.previous_inspection_id='previous';
  window.history.replaceState(null,'','#/inspect?inspection=reviewed-ai');vi.mocked(api.getInspection).mockResolvedValue(r);render(<Wizard/>);
  await screen.findByRole('heading',{name:'Your review says everything is in place.'});
  expect(screen.getByText('Based on automatic suggestions and your review. This is not an independent AI check.')).toBeTruthy();
  expect(screen.queryByText('Everything is back in place.')).toBeNull();expect(api.scanWorkspace).not.toHaveBeenCalled();
});

it('automatically recognizes a current photo but never assumes camera alignment',async()=>{
  window.history.replaceState(null,'','#/inspect?template=space');render(<Wizard/>);await upload();
  await waitFor(()=>expect(api.recognizePhoto).toHaveBeenCalledTimes(1));
  expect(api.recognizePhoto).toHaveBeenCalledWith(expect.objectContaining({alignment:expect.objectContaining({confirmed:false})}));
  expect(api.scanWorkspace).not.toHaveBeenCalled();
  await screen.findByText(/Found phone/);
  expect((screen.getByRole('button',{name:'Check for changes'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('heading',{name:'Check each item'})).toBeNull();
});

it('saves a photo before recognition and does not duplicate long-running analysis',async()=>{
  let finish!:(value:Awaited<ReturnType<typeof analyzeAI>>)=>void;
  vi.mocked(analyzeAI).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  render(<Wizard/>);await upload();await screen.findByText('Finding your items...');
  expect(api.saveDraft).toHaveBeenCalledWith(expect.any(String),0,expect.objectContaining({reference:expect.objectContaining({image_url:image.image_url})}));
  expect(vi.mocked(api.saveDraft).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(analyzeAI).mock.invocationCallOrder[0]);
  expect(screen.queryByRole('button',{name:'Mark items myself (optional)'})).toBeNull();
  expect((screen.getByRole('button',{name:'Retake setup photo'}) as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>finish(result().analysis));
  await screen.findByText('Does this look right?');expect(analyzeAI).toHaveBeenCalledTimes(1);
});

it('keeps an empty detection truthful with explicit Retry and no automatic editor',async()=>{
  vi.mocked(analyzeAI).mockResolvedValue({...result().analysis,objects:[]});render(<Wizard/>);await upload();
  await screen.findByText("We couldn't identify your items automatically.");
  expect(screen.getByRole('button',{name:'Retry'})).toBeTruthy();
  expect(screen.queryByLabelText('What would you like to keep track of?')).toBeNull();
  expect(screen.queryByRole('button',{name:'Save this setup'})).toBeNull();
  vi.mocked(analyzeAI).mockResolvedValue(result().analysis);fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  await screen.findByText('Does this look right?');expect(analyzeAI).toHaveBeenCalledTimes(2);
});

it('does not spend on recognition if the uploaded photo could not be saved',async()=>{
  vi.mocked(api.saveDraft).mockRejectedValue(new Error('Session expired'));
  render(<Wizard/>);await upload();await screen.findByText('Please sign in again. Your photo stays here so you can retry.');
  expect(analyzeAI).not.toHaveBeenCalled();expect(screen.getByAltText('Your space')).toBeTruthy();
});
