// @vitest-environment jsdom
// Browser/device sessions and recognition are mocked; metric fit calculations are real.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorldARController, WorldARMeasurement, WorldAROptions } from './xr';
vi.mock('./useLiveCamera', () => ({ useLiveCamera: vi.fn() }));
vi.mock('./xr', () => ({ isWorldARSupported: vi.fn(), startWorldAR: vi.fn() }));
import { useLiveCamera } from './useLiveCamera';
import { isWorldARSupported, startWorldAR } from './xr';
import LiveSpace from './LiveSpace';

let camera: ReturnType<typeof useLiveCamera>;
let controller: WorldARController;
let options: WorldAROptions;
const measured: WorldARMeasurement = { width: 2, length: 3, corners: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 3 }, { x: 0, y: 0, z: 3 }] };
beforeEach(() => {
  window.history.replaceState(null, '', '#/live');
  camera = { memory:{places:[],items:[],location:null,full:false}, forgetMemory:vi.fn(), renamePlace:vi.fn(), trackedObjects:[], latencyMs:null, localStatus:'off', localLatencyMs:null, resultAgeMs:null, status: 'idle', error: '', analysis: null, analysisFrame: null, lastScan:null, steady: false, analyzing: false, recognitionStatus:'waiting', retryInSeconds:0, lastRecognizedAt:null, start: vi.fn(async () => {}), stop: vi.fn(), retry: vi.fn() };
  controller = { setFootprint: vi.fn(), setRoomLayout: vi.fn(), useDetectedSurface: vi.fn(() => true), selectPoint: vi.fn(() => true), reset: vi.fn(), end: vi.fn(async () => {}) };
  vi.mocked(useLiveCamera).mockReturnValue(camera);
  vi.mocked(isWorldARSupported).mockResolvedValue(false);
  vi.mocked(startWorldAR).mockImplementation(async value => { options = value; value.onState({ phase: 'searching', points: 0, canSelect: false, message: 'Find a horizontal surface.' }); return controller; });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function enterSpace(width: string, length: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Enter measurements' }));
  fireEvent.change(screen.getByLabelText('Space width'), { target: { value: width } });
  fireEvent.change(screen.getByLabelText('Space length'), { target: { value: length } });
}

it('shows a searched last-known spot beside fresh detections, and hides it when the view is lost',async()=>{
  const keys={id:'keys',label:'Keys',locked:false,box:{x:.2,y:.3,width:.2,height:.2}};
  const book={id:'book',label:'Book',locked:false,box:{x:.6,y:.3,width:.2,height:.2}};
  const frame={image_url:'data:image/jpeg;base64,fixture',width:768,height:512,name:'Desk'};
  camera.status='live';camera.trackedObjects=[book];
  camera.analysis={objects:[book],concepts:['book'],summary:'A book',warnings:[],message:'',provider:'fixture',model:'fixture',live_request:false};
  camera.memory={places:[{id:'desk',name:'Desk',summary:'A desk',frame,objects:[book],details:{},capturedAt:2000,features:{width:128,height:96,points:[]}}],items:[{object:keys,placeId:'desk',frame,detail:'Key ring',capturedAt:1000}],location:{placeId:'desk',objects:[book],target:keys,matchedAt:2000,match:{a:1,b:0,tx:0,ty:0,inliers:20,score:1}},full:false};
  const view=render(<LiveSpace/>);
  fireEvent.click(screen.getByRole('button',{name:'Memory'}));
  fireEvent.click(screen.getByRole('button',{name:'Find Keys, last seen in Desk'}));
  const remembered=screen.getByRole('button',{name:'Highlight Keys in camera'});
  expect(remembered.classList.contains('is-remembered')).toBe(true);
  expect(remembered.textContent).toContain('Remembered spot');
  expect(screen.getByRole('button',{name:'Highlight Book in camera'}).classList.contains('is-remembered')).toBe(false);
  camera.memory={...camera.memory,location:null};
  view.rerender(<LiveSpace/>);
  expect(screen.queryByRole('button',{name:'Highlight Keys in camera'})).toBeNull();
  await waitFor(()=>expect(isWorldARSupported).toHaveBeenCalled());
});
async function startAR() {
  vi.mocked(isWorldARSupported).mockResolvedValue(true);
  const view = render(<LiveSpace/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Measure a space in AR' }));
  await screen.findByRole('button', { name: 'End AR' });
  return view;
}

it('starts automatic recognition without asking users to label the scene or reusing their fit target as a detection prompt', async () => {
  render(<LiveSpace/>);
  expect((screen.getByRole('switch', { name: 'Automatic item recognition' }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByLabelText(/what would you like to keep track of/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /mark.*item/i })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Open camera & recognize' }));
  expect(camera.start).toHaveBeenCalledOnce();
  fireEvent.click(within(screen.getByRole('group', { name: 'Try an item to add' })).getByRole('button', { name: 'Car' }));
  fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
  fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'A bicycle' } });
  for (const [input] of vi.mocked(useLiveCamera).mock.calls) {
    expect(input.autoAnalyze).toBe(true);
    expect(Object.keys(input).sort()).toEqual(['active', 'autoAnalyze', 'findingId', 'mode', 'pauseRecognition', 'videoRef']);
  }
  expect(camera.start).toHaveBeenCalledOnce();
});

it('compares entered dimensions, preserves example attribution, and clears the verdict for invalid measurements', async () => {
  render(<LiveSpace/>);
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
  enterSpace('60', '50');
  expect(screen.getByRole('heading', { name: 'Example footprint fits' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /actual dimensions/ }));
  expect(screen.getByRole('heading', { name: 'Footprint fits' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Item width'), { target: { value: '80' } });
  expect(screen.getByRole('heading', { name: 'Needs more room' })).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: /actual dimensions/ }) as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText('Space width'), { target: { value: '' } });
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
  expect(screen.queryByRole('img', { name: /Top-down dimension comparison/ })).toBeNull();
  await waitFor(() => expect(isWorldARSupported).toHaveBeenCalled());
});

it('treats a car preset as editable dimensions and never turns a footprint comparison into parking approval', async () => {
  render(<LiveSpace/>);
  fireEvent.click(within(screen.getByRole('group', { name: 'Try an item to add' })).getByRole('button', { name: 'Car' }));
  expect((screen.getByLabelText('Measurement unit') as HTMLSelectElement).value).toBe('m');
  enterSpace('3', '6');
  expect(screen.getByRole('heading', { name: 'Example footprint fits' })).toBeTruthy();
  expect(screen.getByText(/Parked footprint only.*turning path yourself.*Never use while driving/)).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: /including mirrors/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: /including mirrors/ }));
  expect(screen.getByRole('heading', { name: 'Footprint fits' })).toBeTruthy();
  expect(screen.queryByText(/safe to park|can be parked|parking approved/i)).toBeNull();
  await waitFor(() => expect(isWorldARSupported).toHaveBeenCalled());
});

it('uses tracked measurements only while tracking is available and clears the renderer on invalid footprint input', async () => {
  await startAR();
  expect(camera.stop).toHaveBeenCalledOnce();
  act(() => { options.onMeasurement(measured); options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Measured.' }); });
  expect(screen.getByRole('heading', { name: 'Example footprint fits' })).toBeTruthy();
  expect(controller.setFootprint).toHaveBeenLastCalledWith({ width: .36, length: .25, clearance: .05, rotated: false });
  act(() => options.onState({ phase: 'tracking-lost', points: 3, canSelect: false, message: 'Tracking paused.' }));
  expect(screen.getByRole('heading', { name: 'Tracking paused' })).toBeTruthy();
  expect(screen.queryByText(/Width remaining/)).toBeNull();
  act(() => options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Tracking restored.' }));
  fireEvent.change(screen.getByLabelText('Item width'), { target: { value: '' } });
  expect(controller.setFootprint).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'End AR' }));
  await waitFor(() => expect(controller.end).toHaveBeenCalledOnce());
});

it('ends an AR session that resolves after navigation and ignores its late callbacks', async () => {
  vi.mocked(isWorldARSupported).mockResolvedValue(true);
  let resolve!: (value: WorldARController) => void;
  vi.mocked(startWorldAR).mockImplementation(value => { options = value; return new Promise(done => { resolve = done; }); });
  const { rerender } = render(<LiveSpace active/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Measure a space in AR' }));
  rerender(<LiveSpace active={false}/>);
  await act(async () => { resolve(controller); });
  expect(controller.end).toHaveBeenCalledOnce();
  act(() => { options.onMeasurement(measured); options.onState({ phase: 'ready', points: 3, canSelect: false, message: 'Late callback.' }); });
  rerender(<LiveSpace active/>);
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
  expect(controller.setFootprint).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'End AR' })).toBeNull();
});

it('invalidates callbacks when the browser ends the AR session', async () => {
  await startAR();
  act(() => options.onState({ phase: 'ended', points: 0, canSelect: false, message: 'AR ended.' }));
  act(() => options.onMeasurement(measured));
  expect(screen.queryByRole('button', { name: 'End AR' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Measure first. Then know.' })).toBeTruthy();
});

it('shows a grounded scene summary and lets the inventory highlight the corresponding camera outline', async () => {
  Object.assign(camera,{status:'live',steady:true,recognitionStatus:'ready',analysis:{objects:[{id:'phone',label:'smartphone',box:{x:.1,y:.2,width:.15,height:.3},locked:false,source:'sam_3_1',confidence:.94}],concepts:['smartphone','mug'],summary:'A smartphone is on a wooden desk.',warnings:[],message:'Found one item',provider:'meta',model:'sam-3.1',live_request:true,concept_discovery:{model:'Muse Spark',live_request:true},unmatched_concepts:['mug']}});
  const {rerender}=render(<LiveSpace/>);
  fireEvent.click(screen.getByRole('button',{name:'Detailed Steady SAM scan'}));
  expect(screen.getByText('A smartphone is on a wooden desk.')).toBeTruthy();
  const inventory=screen.getByRole('group',{name:'Recognized items'});
  fireEvent.click(within(inventory).getByRole('button',{name:/smartphone/}));
  expect(screen.getByRole('button',{name:'Highlight smartphone in camera'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(/Detection score 0.94/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Highlight mug in camera'})).toBeNull();
  camera.analysis=null;camera.steady=false;camera.recognitionStatus='stabilizing';
  rerender(<LiveSpace/>);
  expect(screen.queryByRole('group',{name:'Recognized items'})).toBeNull();
  expect(screen.queryByText(/SAM score/)).toBeNull();
  await waitFor(()=>expect(isWorldARSupported).toHaveBeenCalled());
});

it('explains empty detections without reporting a successful inventory and provides a fresh scan',async()=>{
  Object.assign(camera,{status:'live',steady:true,recognitionStatus:'ready',analysis:{objects:[],concepts:[],summary:'A dimly lit surface.',warnings:[],message:'No objects.',provider:'meta',model:'sam-3.1',live_request:true}});
  render(<LiveSpace/>);
  expect(screen.getByRole('heading',{name:'No items located yet'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Scan this view again'}));
  expect(camera.retry).toHaveBeenCalledOnce();
  await waitFor(()=>expect(isWorldARSupported).toHaveBeenCalled());
});

it('keeps a slow result on its captured photo without placing old outlines over the live camera',async()=>{
  const analysis={objects:[{id:'phone',label:'smartphone',box:{x:.1,y:.2,width:.15,height:.3},locked:false}],concepts:['smartphone'],summary:'A phone in the captured view.',warnings:[],message:'One item',provider:'meta',model:'sam-3.1',live_request:true};
  Object.assign(camera,{status:'live',steady:false,recognitionStatus:'stabilizing',lastScan:{analysis,frame:{image_url:'data:image/jpeg;base64,fixture',width:1280,height:720,name:'Captured camera frame'},capturedAt:Date.now()}});
  render(<LiveSpace/>);
  expect(screen.getByAltText('The captured camera frame used for these recognition results')).toBeTruthy();
  expect(screen.getByText(/Labels from the last captured view/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Highlight smartphone in camera'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Highlight smartphone in captured view'}));
  expect(within(screen.getByRole('group',{name:'Recognized items'})).getByRole('button',{name:/smartphone/}).getAttribute('aria-pressed')).toBe('true');
  await waitFor(()=>expect(isWorldARSupported).toHaveBeenCalled());
});

it('shows bounded automatic retry feedback while preserving the camera preview',async()=>{
  Object.assign(camera,{status:'live',error:'Temporary connection problem.',recognitionStatus:'retrying',retryInSeconds:4});
  render(<LiveSpace/>);
  expect(screen.getByRole('heading',{name:'Reconnecting to recognition…'})).toBeTruthy();
  expect(screen.getByText(/Trying again in 4 seconds/)).toBeTruthy();
  expect(screen.getByLabelText('Live camera preview')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Retry recognition now'}));
  expect(camera.retry).toHaveBeenCalledOnce();
  expect(camera.start).not.toHaveBeenCalled();
  await waitFor(()=>expect(isWorldARSupported).toHaveBeenCalled());
});

it('retries the AR session after an AR error instead of starting a different camera mode',async()=>{
  vi.mocked(isWorldARSupported).mockResolvedValue(true);
  vi.mocked(startWorldAR).mockRejectedValueOnce(new Error('AR tracking unavailable.'));
  render(<LiveSpace/>);
  fireEvent.click(await screen.findByRole('button',{name:'Measure a space in AR'}));
  fireEvent.click(await screen.findByRole('button',{name:'Retry spatial AR'}));
  await screen.findByRole('button',{name:'End AR'});
  expect(startWorldAR).toHaveBeenCalledTimes(2);
  expect(camera.start).not.toHaveBeenCalled();
});
