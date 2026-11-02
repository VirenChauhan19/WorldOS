// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Mission as Task } from './types';
vi.mock('./api',()=>({getMission:vi.fn(),getRoutine:vi.fn(),createMission:vi.fn(),observeMission:vi.fn(),planMission:vi.fn(),progressMission:vi.fn(),checkMission:vi.fn(),saveRoutine:vi.fn()}));
vi.mock('../api',()=>({analyze:vi.fn(async()=>({image_url:'data:image/jpeg;base64,after',width:640,height:480,name:'New capture'}))}));
vi.mock('../PhotoActions',()=>({default:({onPhoto,disabled,label}:{onPhoto:(file:File)=>Promise<void>;disabled:boolean;label:string})=><button disabled={disabled} onClick={()=>void onPhoto(new File(['photo'],'desk.jpg',{type:'image/jpeg'}))}>{label}</button>}));
vi.mock('../exportFile',()=>({exportJSON:vi.fn()}));
import * as api from './api';
import Mission from './Mission';

const image={image_url:'data:image/jpeg;base64,before',width:640,height:480};
const base:Task={id:'task-one',revision:1,goal:'Get ready to study',constraints:'Keep my cup.',initial_image:image,working_image:image,reference:null,analysis:{objects:[{id:'phone',label:'Phone',box:{x:.2,y:.3,width:.1,height:.2},locked:false},{id:'cup',label:'Cup',box:{x:.7,y:.3,width:.1,height:.1},locked:false}],concepts:['phone','cup'],summary:'A phone and cup.',model:'SAM fixture',provider:'fixture',warnings:[],message:'',live_request:false},protected_ids:[],plan:null,completed_ids:[],history:[],after:null,review:null,status:'observed',created_at:'2026-11-02',updated_at:'2026-11-02'};
const planned:Task={...base,revision:2,protected_ids:['cup'],status:'guiding',plan:{title:'A space ready to study',outcome:'Keep a clear work area.',steps:[{id:'step-one',title:'Give your phone a spot',instruction:'Choose a clear stable spot outside your working area for the phone.',why:'Keep your working area available.',success_check:'Your work area is clear of the phone.',object_ids:['phone'],move_ids:['phone']}],limitation:'Check the destination yourself.',model:'Muse fixture',provider:'fixture',live_request:false}};
beforeEach(()=>{window.history.replaceState(null,'','#/mission?id=task-one');vi.mocked(api.getMission).mockResolvedValue(structuredClone(base));vi.mocked(api.planMission).mockResolvedValue(structuredClone(planned));vi.mocked(api.progressMission).mockImplementation(async(value,id,done)=>({...value,revision:value.revision+1,completed_ids:done?[id]:[]}));});
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('protects selected objects, guides one step, and saves human progress without inventing verification',async()=>{
  render(<Mission/>);await screen.findByText('What should stay put?');fireEvent.click(screen.getByRole('button',{name:'Cup'}));
  fireEvent.click(screen.getByRole('button',{name:'Make my step-by-step plan'}));await screen.findByRole('heading',{name:'A space ready to study'});
  expect(api.planMission).toHaveBeenCalledWith(expect.objectContaining({id:'task-one'}),['cup'],'',expect.any(AbortSignal));
  fireEvent.click(screen.getByText('Why this helps'));expect(screen.getByText('Keep your working area available.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'I’ve done this step'}));await screen.findByText('1 of 1 marked done by you');
  expect(api.checkMission).not.toHaveBeenCalled();expect(screen.queryByLabelText('AI photo review')).toBeNull();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
});

it('checks a new photo and requires explicit preference before saving a repeatable routine',async()=>{
  vi.mocked(api.getMission).mockResolvedValue({...planned,completed_ids:['step-one']});
  const reviewed:Task={...planned,revision:4,status:'reviewed',after:{...image,image_url:'data:image/jpeg;base64,after'},review:{comparable:false,summary:'The view is too different to compare.',steps:[{step_id:'step-one',status:'uncertain',evidence:'The work area is cropped.'}],next_step:'Take the whole surface from the same angle.',model:'Muse fixture',source:'photo_assessment',live_request:false}};
  vi.mocked(api.checkMission).mockResolvedValue(reviewed);
  vi.mocked(api.saveRoutine).mockResolvedValue({mission:{...reviewed,revision:5,saved_routine_id:'routine-one'},routine:{id:'routine-one',name:'Study setup',goal:base.goal,constraints:'',image:reviewed.after!,source:'user_selected_reference',created_at:'2026-11-02'}});
  vi.mocked(api.getRoutine).mockResolvedValue({id:'routine-one',name:'Study setup',goal:base.goal,constraints:'',image:reviewed.after!,source:'user_selected_reference',created_at:'2026-11-02'});
  render(<Mission/>);fireEvent.click(await screen.findByRole('button',{name:'Check my result'}));fireEvent.click(screen.getByRole('button',{name:'Choose after photo'}));
  await screen.findByText('Let’s get a clearer comparison.');expect(screen.getByText('Can’t tell from the photo')).toBeTruthy();
  expect(api.checkMission).toHaveBeenCalledWith(expect.objectContaining({id:'task-one'}),'data:image/jpeg;base64,after',expect.any(AbortSignal));
  expect((screen.getByRole('button',{name:'Save my routine'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.change(screen.getByLabelText('Routine name'),{target:{value:'Study setup'}});fireEvent.click(screen.getByRole('button',{name:'Save my routine'}));
  await screen.findByText('Your routine is ready.');fireEvent.click(screen.getByRole('button',{name:'Use this routine again'}));
  expect(window.location.hash).toBe('#/mission?routine=routine-one');
});

it('aborts a pending plan on navigation and discards its late answer',async()=>{
  let resolve!:(value:Task)=>void;vi.mocked(api.planMission).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const {rerender}=render(<Mission/>);fireEvent.click(await screen.findByRole('button',{name:'Make my step-by-step plan'}));
  fireEvent.click(screen.getByRole('button',{name:'Make my step-by-step plan'}));expect(api.planMission).toHaveBeenCalledOnce();
  const signal=vi.mocked(api.planMission).mock.calls[0][3]!;rerender(<Mission active={false}/>);expect(signal.aborted).toBe(true);
  await act(async()=>resolve(planned));expect(screen.queryByText('A space ready to study')).toBeNull();
});

it('recovers the server-saved photograph after an inference failure and allows photo-only planning',async()=>{
  const draft={...base,analysis:null,status:'draft' as const};vi.mocked(api.getMission).mockResolvedValue(draft);
  vi.mocked(api.observeMission).mockRejectedValueOnce(new Error('Recognition is unavailable.'));
  render(<Mission/>);fireEvent.click(await screen.findByRole('button',{name:'Find visible items'}));await screen.findByText('Recognition is unavailable.');
  expect(screen.getByAltText('The workspace photograph used to build these steps')).toBeTruthy();
  await waitFor(()=>expect((screen.getByRole('button',{name:'Make my step-by-step plan'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Make my step-by-step plan'}));await screen.findByRole('heading',{name:'A space ready to study'});
});

it('resumes saved progress and requests a fresh photo before adapting a started plan',async()=>{
  vi.mocked(api.getMission).mockResolvedValue({...planned,completed_ids:['step-one']});
  vi.mocked(api.observeMission).mockResolvedValue({...base,revision:4,history:['User reported: moved the phone.']});
  render(<Mission/>);await screen.findByText('1 of 1 marked done by you');fireEvent.click(screen.getByRole('button',{name:'Something won’t work? Adapt the plan'}));
  expect(api.planMission).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Choose updated photo'}));
  await screen.findByText('What should stay put?');expect(api.observeMission).toHaveBeenCalledWith(expect.objectContaining({completed_ids:['step-one']}),'data:image/jpeg;base64,after',expect.any(AbortSignal));
  expect(screen.getByText('1 earlier actions you marked done')).toBeTruthy();
});
