// @vitest-environment jsdom
// Camera and storage transport are fixtures; the room solver and UI transitions are real.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FurnitureItem, FurniturePlacement, ReservedZone, RoomSize } from './layout';
import { DeviceWorkspaceContext } from '../device/context';
import type { useLiveCamera as CameraHook } from '../live/useLiveCamera';

interface PreviewProps {room:RoomSize;items:FurnitureItem[];placements:FurniturePlacement[];reserved:ReservedZone[]}
vi.mock('./RoomPreview',()=>({default:(props:PreviewProps)=><output data-testid="room-preview">{JSON.stringify(props)}</output>}));
vi.mock('./ProjectedFurniture',()=>({default:()=> <canvas aria-label="Furniture concept projected into your room photo"/>}));
vi.mock('./design',async original=>({...await original<typeof import('./design')>(),surveyRoom:vi.fn(),designRoom:vi.fn()}));
vi.mock('../live/useLiveCamera',()=>({useLiveCamera:vi.fn()}));
vi.mock('../live/xr',()=>({isWorldARSupported:vi.fn(async()=>false),startWorldAR:vi.fn()}));
vi.mock('../device/store',async original=>({...await original<typeof import('../device/store')>(),loadRoomReference:vi.fn(async()=>undefined),saveRoomReference:vi.fn(async()=>undefined)}));
import { useLiveCamera } from '../live/useLiveCamera';
import { isWorldARSupported, startWorldAR } from '../live/xr';
import type { WorldARController, WorldAROptions } from '../live/xr';
import { loadRoomReference, saveRoomReference } from '../device/store';
import { roomDraftKey } from '../device/roomDraft';
import RoomStudio from './RoomStudio';
vi.mock('./jobs',async original=>({...await original<typeof import('./jobs')>(),cancelRoomJob:vi.fn(async()=>({})),watchRoomJob:vi.fn(),startRoomJob:vi.fn()}));
import { RoomJobFailure, RoomJobRejected, startRoomJob, watchRoomJob } from './jobs';
import { APIError } from '../api';
import { emptyRoom } from '../device/roomProjects';
import { surveyRoom, designRoom } from './design';
import type { SurveyResponse, RoomDesign } from './design';

const survey:SurveyResponse={status:'ready',summary:'An open room with a window on the left.',room:{width:4,depth:5,width_min:3.2,width_max:4.8,depth_min:4,depth_max:6},floor_corners:[{x:.2,y:.4},{x:.8,y:.4},{x:.95,y:.95},{x:.05,y:.95}],evidence:['Assuming a typical door size.'],uncertainty:'Hidden space is unknown.',confidence:'low',features:[{label:'Left window',kind:'window',x:0,z:.3,observation:'A visible window on the left wall.'}],zones:[{id:'door',label:'Door access',kind:'access',x:3,z:4,width:1,depth:1}],ideas:['Add a reading corner'],image_url:'data:image/jpeg;base64,cGhvdG8=',image_width:1280,image_height:720};
const design:RoomDesign={title:'A little room to read',summary:'A reading corner beside the window.',items:[{id:'sofa',kind:'sofa',label:'Compact sofa',width:1.8,depth:.85,height:.8,color:'#718b65'}],placements:[{itemId:'sofa',x:0,z:1,rotation:90,reason:'Near the window for reading light.'}],tradeoffs:['Example furniture sizes.']};
const projectFixture=()=>({kind:'room-project' as const,id:'project',name:'Office',updatedAt:'now',draft:{...emptyRoom(),roomFields:{width:'4',depth:'5',height:''},source:'photo' as const,goal:'Reading corner',designStyle:'open' as const},reference:{image_url:survey.image_url,width:survey.image_width,height:survey.image_height,corners:survey.floor_corners,labels:[],survey},versions:[]});
it('keeps the accepted survey recoverable when its queued design submission is rejected',async()=>{
  vi.mocked(surveyRoom).mockImplementation((_image,_signal,_id,onStatus)=>{onStatus?.('running');return new Promise(()=>{});});
  vi.mocked(startRoomJob).mockRejectedValueOnce(new RoomJobRejected('Two room requests are running',429));
  await capturePhoto();
  change('What would make this room yours?','A reading corner');
  fireEvent.click(screen.getByRole('button',{name:'Design when room is ready'}));
  await screen.findByText('Two room requests are running');
  const pending=JSON.parse(localStorage.getItem(roomDraftKey)!).roomJob;
  expect(pending.stage).toBe('survey');expect(pending.id).toBe(vi.mocked(surveyRoom).mock.calls[0][2]);
  expect(screen.getByRole('button',{name:'Reconnect to this request'})).toBeTruthy();
});
let camera:ReturnType<typeof CameraHook>;
beforeEach(()=>{
  localStorage.clear();
  vi.mocked(surveyRoom).mockResolvedValue(structuredClone(survey));
  vi.mocked(designRoom).mockResolvedValue(structuredClone(design));
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));
  camera={memory:{places:[],items:[],location:null,full:false},forgetMemory:vi.fn(),renamePlace:vi.fn(),trackedObjects:[],latencyMs:null,localStatus:'off',localLatencyMs:null,localStabilizing:false,resultAgeMs:null,status:'idle',error:'',analysis:null,analysisFrame:null,lastScan:null,steady:false,analyzing:false,recognitionStatus:'off',retryInSeconds:0,lastRecognizedAt:null,start:vi.fn(async()=>{}),stop:vi.fn(),retry:vi.fn()};
  vi.mocked(useLiveCamera).mockReturnValue(camera);
  vi.mocked(isWorldARSupported).mockResolvedValue(false);
  vi.mocked(loadRoomReference).mockResolvedValue(undefined);
  vi.mocked(saveRoomReference).mockResolvedValue(undefined);
});
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();vi.restoreAllMocks();vi.unstubAllGlobals();});

async function open(){const view=render(<DeviceWorkspaceContext.Provider value={true}><RoomStudio/></DeviceWorkspaceContext.Provider>);await waitFor(()=>expect(loadRoomReference).toHaveBeenCalled());return view;}
function change(name:string,value:string){fireEvent.change(screen.getByLabelText(name),{target:{value}});}
function enterArea(width='2',length='2'){
  fireEvent.click(screen.getByText('Furniture & fine adjustments'));
  fireEvent.click(screen.getByRole('button',{name:'Enter dimensions (optional)'}));
  change('Room width',width);change('Room length',length);
}
function review(){fireEvent.click(screen.getByLabelText('I checked the dimensions and reserved areas'));}
function preview():PreviewProps{return JSON.parse(screen.getByTestId('room-preview').textContent!);}

it('retains an accepted request when polling requires sign-in again',async()=>{
  const project=projectFixture(),job={id:'accepted',stage:'design' as const},changed=vi.fn();
  project.draft.roomJob=job;vi.mocked(watchRoomJob).mockRejectedValueOnce(new APIError('Session expired',401));
  render(<DeviceWorkspaceContext.Provider value={true}><RoomStudio initialProject={project} onProjectChange={changed}/></DeviceWorkspaceContext.Provider>);
  await screen.findByRole('button',{name:'Sign in for AI design'});
  expect(changed.mock.lastCall?.[0].roomJob).toEqual(job);expect(designRoom).not.toHaveBeenCalled();
});
it('persists the job before inference and keeps the restored design priority',async()=>{
  const checkpoint=vi.fn(async()=>{});
  render(<DeviceWorkspaceContext.Provider value={true}><RoomStudio initialProject={projectFixture()} onBeforeJob={checkpoint}/></DeviceWorkspaceContext.Provider>);
  fireEvent.click(screen.getByRole('button',{name:'Design my room'}));await screen.findByText(design.title);
  expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(designRoom).mock.invocationCallOrder[0]);
  expect(vi.mocked(designRoom).mock.calls[0][0].style).toBe('open');
});
it('does not start inference when its recovery ID cannot be saved',async()=>{
  const checkpoint=vi.fn(async()=>{throw new Error('Storage full');});
  render(<DeviceWorkspaceContext.Provider value={true}><RoomStudio initialProject={projectFixture()} onBeforeJob={checkpoint}/></DeviceWorkspaceContext.Provider>);
  fireEvent.click(screen.getByRole('button',{name:'Design my room'}));await screen.findByText('Storage full');expect(designRoom).not.toHaveBeenCalled();
});
it('keeps a completed survey when a queued design fails, so retry only designs',async()=>{
  const base=projectFixture(),project={...base,draft:{...base.draft,roomFields:{width:'',depth:'',height:''},roomJob:{id:'child',stage:'design' as const,surveyId:'parent'},designQueued:true},reference:{...base.reference,survey:undefined}};
  vi.mocked(watchRoomJob).mockRejectedValueOnce(new RoomJobFailure('Design unavailable',{survey}));
  render(<DeviceWorkspaceContext.Provider value={true}><RoomStudio initialProject={project}/></DeviceWorkspaceContext.Provider>);
  fireEvent.click(await screen.findByRole('button',{name:'Try design again'}));await screen.findByText(design.title);
  expect(surveyRoom).not.toHaveBeenCalled();expect(designRoom).toHaveBeenCalledTimes(1);
});

it('reopens a pending photo and retries analysis when its queued design lost the survey',async()=>{
  const base=projectFixture(),project={...base,draft:{...base.draft,source:'unmeasured' as const,roomFields:{width:'',depth:'',height:''},roomJob:{id:'child',stage:'design' as const,surveyId:'parent'},designQueued:true},reference:{...base.reference,corners:[],survey:undefined}};
  vi.mocked(watchRoomJob).mockRejectedValueOnce(new RoomJobFailure('Room analysis stopped: response limit reached.'));
  render(<DeviceWorkspaceContext.Provider value={true}><RoomStudio initialProject={project}/></DeviceWorkspaceContext.Provider>);
  const retry=await screen.findByRole('button',{name:'Try room analysis again'});
  expect(screen.getByRole('button',{name:'Photo plan'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button',{name:'Try design again'})).toBeNull();
  fireEvent.click(retry);
  await waitFor(()=>expect(surveyRoom).toHaveBeenCalledTimes(1));
  expect(vi.mocked(surveyRoom).mock.calls[0][0]).toBe(base.reference.image_url);
  expect(designRoom).not.toHaveBeenCalled();
});

it('starts with an empty device plan and waits for dimensions and review before offering furniture',async()=>{
  await open();
  expect(screen.queryByRole('button',{name:/Add suggested/})).toBeNull();
  expect(screen.queryByTestId('room-preview')).toBeNull();
  expect(screen.getByText('0/12')).toBeTruthy();
  enterArea();
  expect(preview().items).toEqual([]);
  expect(screen.queryByRole('button',{name:/Add suggested/})).toBeNull();
  review();
  expect(screen.getByRole('button',{name:'Add suggested Compact desk'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Add suggested Queen bed'})).toBeNull();
  expect(vi.mocked(useLiveCamera).mock.calls.every(([value])=>value.mode==='live')).toBe(true);
});

it('keeps an access strip clear and preserves placed pieces while adding another suggested item',async()=>{
  await open();enterArea();
  fireEvent.click(screen.getByRole('button',{name:'Reserve a door or occupied area'}));
  review();
  fireEvent.click(screen.getByRole('button',{name:'Add suggested Compact desk'}));
  const first=preview();
  expect(first.reserved).toHaveLength(1);expect(first.placements).toHaveLength(1);
  expect(first.placements[0].x).toBeGreaterThanOrEqual(.8);
  fireEvent.click(screen.getByRole('button',{name:'Add suggested Side table'}));
  const next=preview();
  expect(next.placements).toHaveLength(2);
  expect(next.placements.find(p=>p.itemId===first.placements[0].itemId)).toEqual(first.placements[0]);
  expect(next.placements.every(p=>p.x>=.8)).toBe(true);
  const stored=JSON.parse(localStorage.getItem(roomDraftKey)!);
  expect(stored.items).toHaveLength(2);expect(stored.manual).toEqual(next.placements);expect(stored.zones[0].kind).toBe('access');
});

it('blocks suggestions for invalid reserved areas and resets review whenever measurements or zones change',async()=>{
  await open();enterArea();review();
  expect(screen.getByRole('button',{name:'Add suggested Compact desk'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Reserve a door or occupied area'}));
  expect(screen.getByLabelText('I checked the dimensions and reserved areas')).toHaveProperty('checked',false);
  change('Reserved area 1 width','3');review();
  expect(screen.queryByRole('button',{name:/Add suggested/})).toBeNull();
  expect(screen.getByText(/Resolve the measurements or placement conflicts/)).toBeTruthy();
  change('Reserved area 1 width','.8');
  expect(screen.getByLabelText('I checked the dimensions and reserved areas')).toHaveProperty('checked',false);
  review();expect(screen.getByRole('button',{name:'Add suggested Compact desk'})).toBeTruthy();
  change('Room width','1');
  expect(screen.getByLabelText('I checked the dimensions and reserved areas')).toHaveProperty('checked',false);
  review();expect(screen.queryByRole('button',{name:'Add suggested Compact desk'})).toBeNull();
});

async function capturePhoto(){
  camera.status='live';
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,cGhvdG8=');
  const result=await open();
  fireEvent.click(screen.getByRole('button',{name:'Use camera'}));
  const video=screen.getByLabelText('Room camera preview');
  Object.defineProperties(video,{videoWidth:{value:1280,configurable:true},videoHeight:{value:720,configurable:true}});
  fireEvent.click(screen.getByRole('button',{name:'Capture this area'}));
  return result;
}

it('analyzes a capture automatically, reserves visible access, and never asks for measurements or corner marking',async()=>{
  await capturePhoto();
  await screen.findByText(survey.summary);
  expect(surveyRoom).toHaveBeenCalledWith('data:image/jpeg;base64,cGhvdG8=',expect.any(AbortSignal),expect.any(String),expect.any(Function));
  expect(camera.stop).toHaveBeenCalled();
  expect(screen.queryByLabelText('Room width')).toBeNull();
  expect(screen.queryByLabelText('I checked the dimensions and reserved areas')).toBeNull();
  expect(screen.queryByText(/Tap the back left/)).toBeNull();
  await waitFor(()=>{
    const saved=JSON.parse(localStorage.getItem(roomDraftKey)!);
    expect(saved.source).toBe('photo');expect(saved.zones).toEqual(survey.zones);expect(saved.roomFields.width).toBe('4');
  });
  await waitFor(()=>expect(saveRoomReference).toHaveBeenLastCalledWith(expect.objectContaining({corners:survey.floor_corners,survey:expect.objectContaining({status:'ready'})})));
  fireEvent.click(screen.getByText('Furniture & fine adjustments'));
  fireEvent.click(screen.getByRole('button',{name:'Add suggested Compact desk'}));
  expect(screen.getByRole('button',{name:'Select Compact desk footprint'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Original photo'}));
  expect(screen.queryByRole('button',{name:'Select Compact desk footprint'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'With furniture plan'}));
  expect(screen.getByRole('button',{name:'Select Compact desk footprint'})).toBeTruthy();
});

it('turns a wish list into a checked arrangement with explanations and can undo it',async()=>{
  await capturePhoto();await screen.findByText(survey.summary);
  change('What would make this room yours?','A sofa near the window');
  fireEvent.click(screen.getByRole('button',{name:'More open space'}));
  fireEvent.click(screen.getByRole('button',{name:'Design my room'}));
  await screen.findByText(design.title);
  expect(designRoom).toHaveBeenCalledWith(expect.objectContaining({goal:'A sofa near the window',style:'open',zones:survey.zones,features:survey.features}),expect.any(AbortSignal),expect.any(String),expect.any(Function));
  expect(screen.getByLabelText('Furniture concept projected into your room photo')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'3D room'}));
  expect(preview().items[0].kind).toBe('sofa');expect(preview().placements[0]).toEqual({itemId:'sofa',x:0,z:1,rotation:90});
  expect(screen.getByText('Near the window for reading light.')).toBeTruthy();
  expect(screen.queryByText(/All 1 fit the measured/)).toBeNull();
  const saved=JSON.parse(localStorage.getItem(roomDraftKey)!);expect(saved.design.title).toBe(design.title);
  fireEvent.click(screen.getByRole('button',{name:'Undo design'}));expect(preview().items).toEqual([]);
});

it('does not apply an old photo estimate after reset, even if transport ignores abort',async()=>{
  let resolve!:(value:SurveyResponse)=>void;
  vi.mocked(surveyRoom).mockReturnValue(new Promise(r=>{resolve=r;}));
  await capturePhoto();await screen.findByText('Preparing your request');
  fireEvent.click(screen.getByRole('button',{name:'Start a fresh arrangement'}));
  await act(async()=>{resolve(survey);});
  expect(screen.queryByText(survey.summary)).toBeNull();
  expect(JSON.parse(localStorage.getItem(roomDraftKey)!).source).toBe('unmeasured');
  expect(screen.queryByRole('button',{name:'Photo plan'})).toBeNull();
});

it('keeps the current design when a later design fails and supports retry',async()=>{
  await capturePhoto();await screen.findByText(survey.summary);
  change('What would make this room yours?','A sofa near the window');
  fireEvent.click(screen.getByRole('button',{name:'Design my room'}));await screen.findByText(design.title);
  vi.mocked(designRoom).mockRejectedValueOnce(new Error('Designer temporarily unavailable.'));
  fireEvent.click(screen.getByRole('button',{name:'Update my room'}));await screen.findByText('Designer temporarily unavailable.');
  fireEvent.click(screen.getByRole('button',{name:'3D room'}));
  expect(preview().items[0].id).toBe('sofa');expect(screen.getByRole('button',{name:'Update my room'})).toHaveProperty('disabled',false);
});

it('asks for a wider photo when the floor is unclear, without inventing dimensions',async()=>{
  vi.mocked(surveyRoom).mockResolvedValue({...survey,status:'needs_photo',room:null,floor_corners:[],features:[],zones:[],summary:'Take a wider photo with the floor visible.'});
  await capturePhoto();await screen.findByText('Take a wider photo with the floor visible.');
  expect(JSON.parse(localStorage.getItem(roomDraftKey)!).roomFields.width).toBe('');
  expect(screen.queryByLabelText('Room width')).toBeNull();
  expect(screen.getByRole('button',{name:'Design my room'})).toHaveProperty('disabled',true);
});

it('starts a fresh arrangement by clearing saved furniture, reference photo, reserved areas and review',async()=>{
  vi.mocked(loadRoomReference).mockResolvedValue({image_url:'data:image/jpeg;base64,cGhvdG8=',width:1280,height:720,labels:['Chair'],corners:[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}]});
  await open();
  await screen.findByRole('button',{name:'Photo plan'});
  enterArea();
  fireEvent.click(screen.getByRole('button',{name:'Reserve a door or occupied area'}));
  review();fireEvent.click(screen.getByRole('button',{name:'Add suggested Compact desk'}));
  expect(preview().items).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Start a fresh arrangement'}));
  expect(screen.queryByRole('button',{name:'Photo plan'})).toBeNull();
  expect(screen.queryByRole('button',{name:/Add suggested/})).toBeNull();
  expect(screen.queryByLabelText('I checked the dimensions and reserved areas')).toBeNull();
  expect(screen.queryByLabelText('Reserved area 1 name')).toBeNull();
  const stored=JSON.parse(localStorage.getItem(roomDraftKey)!);
  expect(stored.items).toEqual([]);expect(stored.zones).toEqual([]);expect(stored.reviewed).toBe(false);
  expect(stored.roomFields).toEqual({width:'',depth:'',height:''});
  await waitFor(()=>expect(saveRoomReference).toHaveBeenLastCalledWith(null));
  enterArea();
  expect(screen.getByLabelText('I checked the dimensions and reserved areas')).toHaveProperty('checked',false);
});

it('clears prior room coordinates and photo review when a new AR scan measures a different area',async()=>{
  vi.mocked(loadRoomReference).mockResolvedValue({image_url:'data:image/jpeg;base64,cGhvdG8=',width:1280,height:720,labels:['Chair'],corners:[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}]});
  vi.mocked(isWorldARSupported).mockResolvedValue(true);
  let options!:WorldAROptions;
  const controller:WorldARController={setFootprint:vi.fn(),setRoomLayout:vi.fn(),useDetectedSurface:vi.fn(()=>true),selectPoint:vi.fn(()=>true),reset:vi.fn(),end:vi.fn(async()=>{})};
  vi.mocked(startWorldAR).mockImplementation(async value=>{options=value;return controller;});
  await open();await screen.findByRole('button',{name:'Photo plan'});
  enterArea();fireEvent.click(screen.getByRole('button',{name:'Reserve a door or occupied area'}));review();
  expect(JSON.parse(localStorage.getItem(roomDraftKey)!).reviewed).toBe(true);
  fireEvent.click(await screen.findByRole('button',{name:'Scan & furnish in AR'}));
  await waitFor(()=>expect(startWorldAR).toHaveBeenCalled());
  act(()=>{
    options.onMeasurement({width:4,length:3,corners:[{x:0,y:0,z:0},{x:4,y:0,z:0},{x:4,y:0,z:3},{x:0,y:0,z:3}],source:'hit-test-scan'});
    options.onState({phase:'ready',points:3,canSelect:false,message:'New floor measured.'});
  });
  const stored=JSON.parse(localStorage.getItem(roomDraftKey)!);
  expect(stored.roomFields).toEqual({width:'4',depth:'3',height:''});expect(stored.zones).toEqual([]);expect(stored.reviewed).toBe(false);
  await waitFor(()=>expect(saveRoomReference).toHaveBeenLastCalledWith(null));
  fireEvent.click(screen.getByRole('button',{name:'See what fits'}));
  expect(screen.queryByRole('button',{name:'Photo plan'})).toBeNull();
  expect(screen.queryByLabelText('Reserved area 1 name')).toBeNull();
  expect(screen.getByLabelText('I checked the dimensions and reserved areas')).toHaveProperty('checked',false);
  expect(screen.queryByRole('button',{name:/Add suggested/})).toBeNull();
});

it('explains unavailable device labels while keeping camera capture available',async()=>{
  camera.status='live';camera.localStatus='unavailable';
  await open();fireEvent.click(screen.getByRole('button',{name:'Use camera'}));
  expect(screen.getByText('Live labels are unavailable in this browser. Capture a photo for AI room analysis.')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Capture this area'})).toHaveProperty('disabled',false);
  expect(camera.start).toHaveBeenCalledOnce();
  expect(vi.mocked(useLiveCamera).mock.calls.at(-1)?.[0].mode).toBe('live');
});
