// @vitest-environment jsdom
// Synthetic software fixtures, never physical evaluation evidence.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EvaluationPanel, { TruthEditor } from './EvaluationPanel';
import type { AlignedImage, EvaluationTrial, WorkspaceTemplate } from './types';
import type { Box } from '../types';
vi.mock('./api',()=>({listEvaluationTrials:vi.fn(),getEvaluationTrial:vi.fn(),createEvaluationTrial:vi.fn(),saveEvaluationCapture:vi.fn(),alignPhoto:vi.fn(),evaluationReport:vi.fn(),exportEvaluationTrial:vi.fn()}));
vi.mock('../Canvas',()=>({default:({onAdd}:{onAdd:(b:Box)=>void})=><button onClick={()=>onAdd({x:.2,y:.2,width:.1,height:.1})}>Draw test annotation</button>}));
import * as api from './api';

const template:WorkspaceTemplate={id:'t',revision:1,name:'Synthetic fixture',description:'',location:'',reference_image_url:'synthetic reference',image_width:300,image_height:200,workspace:{x:0,y:0,width:1,height:1},clearance:0,created_at:'2026-10-26',updated_at:'2026-10-26',objects:[{id:'book',label:'Book',box:{x:.2,y:.2,width:.1,height:.1},locked:false,required:true,tolerance:.025}]};
const image:AlignedImage={image_url:'synthetic current',width:300,height:200,workspace_coverage:1,comparison_allowed:true,warnings:[],alignment:{tx:0,ty:0,scale:1,rotation:0,confirmed:true}};
const trial:EvaluationTrial={id:'trial',template_id:'t',name:'Trial fixture',operator:'Tester',scenario:'correct_workspace',created_at:'2026-10-26',template_snapshot:template,captures:[]};
const props=()=>({template,trial:null,current:null,alignment:image.alignment,phase:'inspection' as const,busy:false,onTrial:vi.fn(),onPhase:vi.fn(),onLeave:vi.fn(),onBusy:vi.fn()});
beforeEach(()=>{vi.mocked(api.listEvaluationTrials).mockResolvedValue({trials:[],scenarios:['correct_workspace','missing_object']});});
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('requires physical reference declaration before starting a trial',async()=>{
  const p=props();vi.mocked(api.createEvaluationTrial).mockResolvedValue(trial);render(<EvaluationPanel {...p}/>);
  await screen.findByRole('option',{name:'correct workspace'});
  fireEvent.change(screen.getByLabelText('Evaluation trial name'),{target:{value:'Live trial'}});fireEvent.change(screen.getByLabelText('Evaluation operator'),{target:{value:'Operator'}});
  const start=screen.getByRole('button',{name:'Start physical trial'}) as HTMLButtonElement;
  expect(start.disabled).toBe(true);fireEvent.click(screen.getByLabelText(/This saved reference is a photograph/));expect(start.disabled).toBe(false);
  fireEvent.click(start);await waitFor(()=>expect(p.onTrial).toHaveBeenCalledWith(trial,true));
  expect(api.createEvaluationTrial).toHaveBeenCalledWith(expect.objectContaining({physical_reference_confirmed:true,operator:'Operator'}));
});

it('presets the phone-moved scenario without declaring a physical test completed',async()=>{
  const p=props();render(<EvaluationPanel {...p} firstInspection/>);
  expect((screen.getByLabelText('Evaluation trial name') as HTMLInputElement).value).toBe('First inspection: only the phone moved');
  expect((screen.getByRole('button',{name:'Start physical trial'}) as HTMLButtonElement).disabled).toBe(true);
  expect(api.createEvaluationTrial).not.toHaveBeenCalled();
});

it('never seeds independent truth from reference positions or model detections',async()=>{
  const changed=vi.fn();render(<TruthEditor template={template} image={image} onChange={changed} disabled={false}/>);
  expect(changed).toHaveBeenLastCalledWith(null);
  fireEvent.change(screen.getByLabelText('Truth state book'),{target:{value:'correct'}});fireEvent.change(screen.getByLabelText('Ground truth reviewer'),{target:{value:'Tester'}});
  fireEvent.click(screen.getByLabelText(/I checked the actual workspace/));expect(changed).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole('button',{name:'Draw test annotation'}));fireEvent.click(screen.getByLabelText(/I checked the actual workspace/));
  await waitFor(()=>expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({objects:[expect.objectContaining({id:'book',source:'manual',confidence:null})],issues:[],workspace_correct:true})));
});

it('supports explicit physical absence and invalidates confirmation after edits',async()=>{
  const changed=vi.fn();render(<TruthEditor template={template} image={image} onChange={changed} disabled={false}/>);
  fireEvent.change(screen.getByLabelText('Truth state book'),{target:{value:'missing'}});fireEvent.change(screen.getByLabelText('Ground truth reviewer'),{target:{value:'Tester'}});fireEvent.click(screen.getByLabelText(/I checked the actual workspace/));
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({objects:[],issues:[{object_id:'book',kind:'missing'}],workspace_correct:false}));
  fireEvent.change(screen.getByLabelText('Truth state book'),{target:{value:'correct'}});expect(changed).toHaveBeenLastCalledWith(null);
});

it('freezes photograph, alignment, and independent labels without an inference call',async()=>{
  const p=props();vi.mocked(api.alignPhoto).mockResolvedValue(image);vi.mocked(api.saveEvaluationCapture).mockResolvedValue(trial);
  render(<EvaluationPanel {...p} trial={trial} current={{...image,name:'fixture'}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Prepare independent labels for this alignment'}));await screen.findByText('Label what is physically true');
  fireEvent.change(screen.getByLabelText('Truth state book'),{target:{value:'missing'}});fireEvent.change(screen.getByLabelText('Ground truth reviewer'),{target:{value:'Tester'}});fireEvent.click(screen.getByLabelText(/I checked the actual workspace/));
  fireEvent.change(screen.getByLabelText('Physical capture notes'),{target:{value:'Book physically removed.'}});fireEvent.click(screen.getByLabelText(/This is a new photograph/));
  fireEvent.click(screen.getByRole('button',{name:'Freeze photograph and ground truth'}));
  await waitFor(()=>expect(api.saveEvaluationCapture).toHaveBeenCalledWith('trial',expect.objectContaining({image_url:image.image_url,alignment:image.alignment,truth:expect.objectContaining({issues:[{object_id:'book',kind:'missing'}]})})));
});

it('shows saved API failures and lets the user resume without losing capture evidence',async()=>{
  const captured:EvaluationTrial={...trial,captures:[{id:'c',stage:'inspection',image_url:'photo',image_width:300,image_height:200,image_hash:'hash',alignment:image.alignment,aligned_image:image,captured_at:'2026-10-26',notes:'Physical setup',truth:{objects:[],issues:[{object_id:'book',kind:'missing'}],workspace_correct:false,inventory_complete:true,independently_reviewed:true,reviewed_by:'Tester'},record:null,attempts:[{id:'a',status:'failed',started_at:'2026-10-26',error:{status:504,message:'Provider timed out.'}}]}]};
  const p=props();render(<EvaluationPanel {...p} trial={captured}/>);
  expect(screen.getByText(/Provider timed out/)).toBeTruthy();expect(screen.getByText(/Last attempt: failed/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'2. Corrected photograph'}));expect(p.onPhase).toHaveBeenCalledWith('corrected');
  expect(api.saveEvaluationCapture).not.toHaveBeenCalled();
});

it('requires no new inference to reopen stored results and reports recoverable storage failures',async()=>{
  vi.mocked(api.listEvaluationTrials).mockResolvedValue({trials:[trial],scenarios:['correct_workspace']});vi.mocked(api.getEvaluationTrial).mockRejectedValue(new Error('Storage unavailable. Retry.'));
  render(<EvaluationPanel {...props()}/>);await screen.findByText('Trial fixture');fireEvent.click(screen.getByText('Trial fixture'));
  expect((await screen.findByRole('alert')).textContent).toContain('Storage unavailable. Retry.');
  expect((screen.getByRole('button',{name:'Reload trials'}) as HTMLButtonElement).disabled).toBe(false);
});
