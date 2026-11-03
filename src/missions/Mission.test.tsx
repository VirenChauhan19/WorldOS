// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Mission as Task } from './types';
import { GOALS } from './types';
vi.mock('./api',()=>({getMission:vi.fn(),getRoutine:vi.fn(),createMission:vi.fn(),observeMission:vi.fn(),planMission:vi.fn(),progressMission:vi.fn(),checkMission:vi.fn(),saveRoutine:vi.fn()}));
vi.mock('../api',()=>({analyze:vi.fn()}));
vi.mock('../PhotoActions',()=>({default:({onPhoto,disabled,label}:{onPhoto:(file:File)=>Promise<void>;disabled:boolean;label:string})=><button disabled={disabled} onClick={()=>void onPhoto(new File(['photo'],'desk.jpg',{type:'image/jpeg'}))}>{label}</button>}));
vi.mock('../exportFile',()=>({exportJSON:vi.fn()}));
vi.mock('../device/taskCapture',()=>({getTaskCapture:vi.fn(),saveTaskCapture:vi.fn()}));
import { getTaskCapture, saveTaskCapture } from '../device/taskCapture';
import * as api from './api';
import { analyze } from '../api';
import Mission from './Mission';

const image={image_url:'data:image/jpeg;base64,before',width:640,height:480};
const base:Task={id:'task-one',revision:1,goal:GOALS[0].goal,constraints:'Keep my cup.',initial_image:image,working_image:image,reference:null,analysis:{objects:[{id:'phone',label:'Phone',box:{x:.2,y:.3,width:.1,height:.2},locked:false},{id:'cup',label:'Cup',box:{x:.7,y:.3,width:.1,height:.1},locked:false}],concepts:['phone','cup'],summary:'A phone and cup.',model:'SAM fixture',provider:'fixture',warnings:[],message:'',live_request:false},protected_ids:[],plan:null,completed_ids:[],history:[],after:null,review:null,status:'observed',created_at:'2026-11-02',updated_at:'2026-11-02'};
const planned:Task={...base,revision:2,protected_ids:['cup'],status:'guiding',plan:{title:'A space ready to study',outcome:'Keep a clear work area.',steps:[{id:'step-one',title:'Give your phone a spot',instruction:'Choose a clear stable spot outside your working area for the phone.',why:'Keep your working area available.',success_check:'Your work area is clear of the phone.',object_ids:['phone'],move_ids:['phone']},{id:'step-two',title:'Check your working area',instruction:'Check that the space you need is clear.',why:'You can start your work.',success_check:'You can begin your task.',object_ids:[],move_ids:[]}],limitation:'Check the destination yourself.',model:'Muse fixture',provider:'fixture',live_request:false}};
beforeEach(()=>{
  vi.resetAllMocks();window.history.replaceState(null,'','#/mission?id=task-one');vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
  vi.mocked(analyze).mockResolvedValue({...image,image_url:'data:image/jpeg;base64,after',name:'New capture',annotation_source:'manual',message:''});
  vi.mocked(api.getMission).mockResolvedValue(structuredClone(base));vi.mocked(api.createMission).mockResolvedValue(structuredClone(base));vi.mocked(api.observeMission).mockResolvedValue(structuredClone(base));vi.mocked(api.planMission).mockResolvedValue(structuredClone(planned));
  vi.mocked(api.progressMission).mockImplementation(async(value,id,done)=>({...value,revision:value.revision+1,completed_ids:done?[...new Set([...value.completed_ids,id])]:value.completed_ids.filter(item=>item!==id)}));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('offers recovery instead of a new-photo form when an existing task cannot be loaded',async()=>{
  vi.mocked(api.getMission).mockRejectedValueOnce(new Error('Task not found'));
  render(<Mission/>);
  await screen.findByRole('heading',{name:'This saved task is unavailable.'});
  expect(screen.queryByRole('button',{name:'Choose a photo'})).toBeNull();
  expect(screen.getByRole('button',{name:'Reload saved task'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Start a new task'})).toBeTruthy();
});

it('opens an accepted server task even if its device shortcut cannot be saved',async()=>{
  history.replaceState(null,'','/#/mission?capture=1');
  vi.mocked(getTaskCapture).mockResolvedValue({kind:'task-capture',id:base.id,goal:base.goal,constraints:'',photo:{...image,name:'Starting photo'},updatedAt:'now'});
  vi.mocked(saveTaskCapture).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Storage full'));
  render(<Mission/>);
  fireEvent.click(await screen.findByRole('button',{name:'Get my guided steps'}));
  await screen.findByRole('heading',{name:'Anything that should stay?'});
  expect(api.createMission).toHaveBeenCalledTimes(1);
  expect(location.hash).toContain('id=task-one');
  expect(screen.getByText(/Its device shortcut could not be saved/)).toBeTruthy();
});

it('can start with a photo without typing, and makes AI use an explicit next action',async()=>{
  window.history.replaceState(null,'','#/mission');render(<Mission/>);
  expect(screen.getByRole('button',{name:'Focus'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('What do you want to do?').closest('details')?.open).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Choose a photo'}));await screen.findByAltText('Your selected starting photograph');
  expect(api.createMission).not.toHaveBeenCalled();expect(api.planMission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Use this photo'}));await screen.findByRole('heading',{name:'Anything that should stay?'});
  expect(api.createMission).toHaveBeenCalledWith(expect.objectContaining({goal:GOALS[0].goal,constraints:''}),expect.any(AbortSignal));
  await waitFor(()=>expect(api.observeMission).toHaveBeenCalledOnce());
});

it('supports changing a goal without exposing or requiring the longer form',async()=>{
  window.history.replaceState(null,'','#/mission');render(<Mission/>);fireEvent.click(screen.getByRole('button',{name:'Create'}));
  expect(screen.getByRole('button',{name:'Create'}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'Choose a photo'}));fireEvent.click(await screen.findByRole('button',{name:'Use this photo'}));
  await waitFor(()=>expect(api.createMission).toHaveBeenCalledWith(expect.objectContaining({goal:GOALS[1].goal}),expect.any(AbortSignal)));
});

it('protects selected objects, advances one step at a time, and opens the photo check only after reported completion',async()=>{
  render(<Mission/>);await screen.findByRole('heading',{name:'Anything that should stay?'});fireEvent.click(screen.getByRole('button',{name:'Cup'}));
  fireEvent.click(screen.getByRole('button',{name:'Get my steps'}));await screen.findByRole('heading',{name:'Give your phone a spot'});
  expect(api.planMission).toHaveBeenCalledWith(expect.objectContaining({id:'task-one'}),['cup'],'',expect.any(AbortSignal));
  expect(screen.getByText('See all 2 steps').closest('details')?.open).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Done, next step'}));await screen.findByRole('heading',{name:'Check your working area'});
  expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Check your working area'}));
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
  fireEvent.click(screen.getByRole('button',{name:'Done, check my space'}));await screen.findByRole('heading',{name:'Check your changes.'});
  expect(api.checkMission).not.toHaveBeenCalled();expect(api.saveRoutine).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('AI photo review')).toBeNull();expect(screen.getByRole('button',{name:'Choose after photo'})).toBeTruthy();
});

it('can undo a completed step from the collapsed list without losing other progress',async()=>{
  vi.mocked(api.getMission).mockResolvedValue({...planned,completed_ids:['step-one']});render(<Mission/>);
  await screen.findByRole('heading',{name:'Check your working area'});fireEvent.click(screen.getByText('See all 2 steps'));
  fireEvent.click(await screen.findByRole('button',{name:/Give your phone a spot/}));
  fireEvent.click(screen.getByRole('button',{name:'Undo this step'}));await screen.findByText('0 of 2 marked done by you');
  expect(api.progressMission).toHaveBeenCalledWith(expect.objectContaining({id:'task-one'}),'step-one',false,expect.any(AbortSignal));
});

it('resumes completed steps at the photo check and saves a preferred setup only on an explicit save',async()=>{
  vi.mocked(api.getMission).mockResolvedValue({...planned,completed_ids:['step-one','step-two']});
  const reviewed:Task={...planned,revision:4,status:'reviewed',after:{...image,image_url:'data:image/jpeg;base64,after'},review:{comparable:false,summary:'The view is too different to compare.',steps:planned.plan!.steps.map(step=>({step_id:step.id,status:'uncertain',evidence:'The work area is cropped.'})),next_step:'Take the whole surface from the same angle.',model:'Muse fixture',source:'photo_assessment',live_request:false}};
  vi.mocked(api.checkMission).mockResolvedValue(reviewed);
  const routine={id:'routine-one',name:planned.plan!.title,goal:base.goal,constraints:'',image:reviewed.after!,source:'user_selected_reference' as const,created_at:'2026-11-02'};
  vi.mocked(api.saveRoutine).mockResolvedValue({mission:{...reviewed,revision:5,saved_routine_id: routine.id},routine});vi.mocked(api.getRoutine).mockResolvedValue(routine);
  render(<Mission/>);fireEvent.click(await screen.findByRole('button',{name:'Choose after photo'}));
  await screen.findByText('We need a clearer view.');expect(screen.getAllByText('Can’t tell from the photo')).toHaveLength(2);
  expect(api.saveRoutine).not.toHaveBeenCalled();expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Save this setup'}));await screen.findByText('Your setup is saved.');
  expect(api.saveRoutine).toHaveBeenCalledWith(expect.objectContaining({after:reviewed.after}),planned.plan!.title,expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button',{name:'Use this setup again'}));expect(window.location.hash).toBe('#/mission?routine=routine-one&workspace=private');
});

it('aborts a pending plan on navigation and discards its late answer',async()=>{
  let resolve!:(value:Task)=>void;vi.mocked(api.planMission).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const {rerender}=render(<Mission/>);fireEvent.click(await screen.findByRole('button',{name:'Get my steps'}));fireEvent.click(screen.getByRole('button',{name:'Get my steps'}));
  expect(api.planMission).toHaveBeenCalledOnce();const signal=vi.mocked(api.planMission).mock.calls[0][3]!;rerender(<Mission active={false}/>);expect(signal.aborted).toBe(true);
  await act(async()=>resolve(planned));expect(screen.queryByText('Give your phone a spot')).toBeNull();
});

it('recovers the saved photo after recognition failure and keeps a photo-only route available',async()=>{
  vi.mocked(api.getMission).mockResolvedValue({...base,analysis:null,status:'draft'});vi.mocked(api.observeMission).mockRejectedValueOnce(new Error('Recognition is unavailable.'));
  render(<Mission/>);fireEvent.click(await screen.findByRole('button',{name:'Retry object recognition'}));await screen.findByText('Recognition is unavailable.');
  expect(screen.getByAltText('The workspace photograph used to build these steps')).toBeTruthy();
  await waitFor(()=>expect((screen.getByRole('button',{name:'Get my steps'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Get my steps'}));await screen.findByRole('heading',{name:'Give your phone a spot'});
});

it('preserves completed actions when the user changes a started plan',async()=>{
  vi.mocked(api.getMission).mockResolvedValue({...planned,completed_ids:['step-one']});
  vi.mocked(api.observeMission).mockResolvedValue({...base,revision:4,history:['User reported: moved the phone.']});
  render(<Mission/>);fireEvent.click(await screen.findByRole('button',{name:'This won’t work? Change the plan'}));
  expect(api.planMission).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Choose updated photo'}));
  await screen.findByRole('heading',{name:'Anything that should stay?'});
  expect(api.observeMission).toHaveBeenCalledWith(expect.objectContaining({completed_ids:['step-one']}),'data:image/jpeg;base64,after',expect.any(AbortSignal));
  expect(screen.getByText('1 earlier actions you marked done')).toBeTruthy();
});
