// @vitest-environment jsdom
// Camera and storage transport are fixtures; the room solver and UI transitions are real.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FurnitureItem, FurniturePlacement, ReservedZone, RoomSize } from './layout';
import { DeviceWorkspaceContext } from '../device/context';
import type { useLiveCamera as CameraHook } from '../live/useLiveCamera';

interface PreviewProps {room:RoomSize;items:FurnitureItem[];placements:FurniturePlacement[];reserved:ReservedZone[]}
vi.mock('./RoomPreview',()=>({default:(props:PreviewProps)=><output data-testid="room-preview">{JSON.stringify(props)}</output>}));
vi.mock('../live/useLiveCamera',()=>({useLiveCamera:vi.fn()}));
vi.mock('../live/xr',()=>({isWorldARSupported:vi.fn(async()=>false),startWorldAR:vi.fn()}));
vi.mock('../device/store',async original=>({...await original<typeof import('../device/store')>(),loadRoomReference:vi.fn(async()=>undefined),saveRoomReference:vi.fn(async()=>undefined)}));
import { useLiveCamera } from '../live/useLiveCamera';
import { isWorldARSupported, startWorldAR } from '../live/xr';
import type { WorldARController, WorldAROptions } from '../live/xr';
import { loadRoomReference, saveRoomReference } from '../device/store';
import { roomDraftKey } from '../device/roomDraft';
import RoomStudio from './RoomStudio';

let camera:ReturnType<typeof CameraHook>;
beforeEach(()=>{
  localStorage.clear();
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));
  camera={memory:{places:[],items:[],location:null,full:false},forgetMemory:vi.fn(),renamePlace:vi.fn(),trackedObjects:[],latencyMs:null,localStatus:'off',localLatencyMs:null,resultAgeMs:null,status:'idle',error:'',analysis:null,analysisFrame:null,lastScan:null,steady:false,analyzing:false,recognitionStatus:'off',retryInSeconds:0,lastRecognizedAt:null,start:vi.fn(async()=>{}),stop:vi.fn(),retry:vi.fn()};
  vi.mocked(useLiveCamera).mockReturnValue(camera);
  vi.mocked(isWorldARSupported).mockResolvedValue(false);
  vi.mocked(loadRoomReference).mockResolvedValue(undefined);
  vi.mocked(saveRoomReference).mockResolvedValue(undefined);
});
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();vi.restoreAllMocks();vi.unstubAllGlobals();});

async function open(){const view=render(<DeviceWorkspaceContext.Provider value={true}><RoomStudio/></DeviceWorkspaceContext.Provider>);await waitFor(()=>expect(loadRoomReference).toHaveBeenCalled());return view;}
function change(name:string,value:string){fireEvent.change(screen.getByLabelText(name),{target:{value}});}
function enterArea(width='2',length='2'){
  fireEvent.click(screen.getByRole('button',{name:'Start with measurements'}));
  change('Room width',width);change('Room length',length);
}
function review(){fireEvent.click(screen.getByLabelText('I checked the dimensions and reserved areas'));}
function preview():PreviewProps{return JSON.parse(screen.getByTestId('room-preview').textContent!);}

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

it('captures fresh device labels, stops the camera, and persists the photo outline before overlaying suggested furniture',async()=>{
  camera.status='live';camera.trackedObjects=[{id:'chair-1',label:'Chair',box:{x:.2,y:.3,width:.3,height:.3},locked:false}];
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,cGhvdG8=');
  await open();enterArea();
  fireEvent.click(screen.getByRole('button',{name:'Camera'}));
  const video=screen.getByLabelText('Room camera preview');
  Object.defineProperties(video,{videoWidth:{value:1280,configurable:true},videoHeight:{value:720,configurable:true}});
  fireEvent.click(screen.getByRole('button',{name:'Capture this area'}));
  expect(camera.stop).toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Reserve space for Chair'})).toBeTruthy();
  expect(screen.getByAltText('Your captured room with a floor outline and proposed furniture footprints')).toHaveProperty('src','data:image/jpeg;base64,cGhvdG8=');
  fireEvent.click(screen.getByRole('button',{name:'Set corners with controls'}));
  await waitFor(()=>expect(saveRoomReference).toHaveBeenLastCalledWith(expect.objectContaining({corners:expect.arrayContaining([{x:.2,y:.2}]),labels:['Chair']})));
  review();fireEvent.click(screen.getByRole('button',{name:'Add suggested Compact desk'}));
  expect(screen.getByRole('button',{name:'Select Compact desk footprint'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Undo corner'}));
  expect(screen.getByLabelText('I checked the dimensions and reserved areas')).toHaveProperty('checked',false);
  expect(screen.queryByRole('button',{name:'Select Compact desk footprint'})).toBeNull();
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
  expect(screen.getByText('Live labels are unavailable in this browser. Capture the area to plan with measurements.')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Capture this area'})).toHaveProperty('disabled',false);
  expect(camera.start).toHaveBeenCalledOnce();
  expect(vi.mocked(useLiveCamera).mock.calls.at(-1)?.[0].mode).toBe('live');
});
