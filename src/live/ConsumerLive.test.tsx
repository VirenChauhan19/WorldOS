// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeviceWorkspaceContext } from '../device/context';
import type { useLiveCamera as CameraHook } from './useLiveCamera';
vi.mock('./useLiveCamera',()=>({useLiveCamera:vi.fn()}));
vi.mock('./xr',()=>({isWorldARSupported:vi.fn(async()=>false),startWorldAR:vi.fn()}));
vi.mock('../device/store',()=>({readPhoto:vi.fn(async()=> 'data:image/webp;base64,Zml4dHVyZQ=='),saveDeviceSpace:vi.fn(async()=>undefined)}));
vi.mock('../api',()=>({askScene:vi.fn()}));
import { askScene } from '../api';
import { prepareCaptureHandoff } from './captureHandoff';
import { useLiveCamera } from './useLiveCamera';
import { saveDeviceSpace } from '../device/store';
import LiveSpace from './LiveSpace';

let camera:ReturnType<typeof CameraHook>;
beforeEach(()=>{
  window.history.replaceState(null,'','/#/live');
  camera={memory:{places:[],items:[],location:null,full:false},forgetMemory:vi.fn(),renamePlace:vi.fn(),trackedObjects:[],latencyMs:null,localStatus:'off',localStabilizing:false,localLatencyMs:null,resultAgeMs:null,status:'idle',error:'',analysis:null,analysisFrame:null,lastScan:null,steady:false,analyzing:false,recognitionStatus:'waiting',retryInSeconds:0,lastRecognizedAt:null,start:vi.fn(async()=>{}),stop:vi.fn(),retry:vi.fn()};
  vi.mocked(useLiveCamera).mockReturnValue(camera);
});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();vi.unstubAllGlobals();});
const content=(active=true)=><DeviceWorkspaceContext.Provider value={true}><LiveSpace active={active}/></DeviceWorkspaceContext.Provider>;

it('starts with a useful camera invitation and keeps measurement forms optional',async()=>{
  render(content());
  expect(await screen.findByRole('heading',{name:'Identify objects'})).toBeTruthy();
  expect(screen.queryByRole('group',{name:'Try an item to add'})).toBeNull();
  expect(camera.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Try an interactive example'}));
  const dock=screen.getByRole('group',{name:'Camera actions'});
  expect(within(dock).getByRole('button',{name:'Close example'})).toBeTruthy();
  expect(within(dock).getByRole('button',{name:'Save view'})).toBeTruthy();
  expect(screen.getAllByRole('button',{name:'Hide labels'})).toHaveLength(1);
  expect(screen.queryByRole('group',{name:'Recognized items'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Check fit'}));
  expect(screen.getByRole('group',{name:'Try an item to add'})).toBeTruthy();
});

it('opens the recorded example from Home without camera permission and does not reopen it after closing',async()=>{
  window.history.replaceState(null,'','/#/live?demo=1');
  const view=render(content());
  expect(await screen.findByAltText('Recorded desk example')).toBeTruthy();
  expect(camera.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Close example'}));
  view.rerender(content());
  expect(screen.queryByAltText('Recorded desk example')).toBeNull();
  expect(screen.getByRole('button',{name:'Open camera & recognize'})).toBeTruthy();
});

it('saves a sample from the preview dock and gives a clear route to the saved view',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Blob(['fixture'],{type:'image/webp'}))));
  render(content());
  fireEvent.click(await screen.findByRole('button',{name:'Try an interactive example'}));
  fireEvent.click(within(screen.getByRole('group',{name:'Camera actions'})).getByRole('button',{name:'Save view'}));
  await screen.findByText('Saved on this device in My Spaces.');
  expect(saveDeviceSpace).toHaveBeenCalledWith(expect.objectContaining({name:'Example desk',photo:'data:image/webp;base64,Zml4dHVyZQ=='}));
  fireEvent.click(screen.getByRole('button',{name:'Open saved view'}));
  expect(window.location.hash).toContain('#/mission?device=');
});

it('keeps saving available when local labels cannot run',async()=>{
  camera.status='live';camera.localStatus='unavailable';
  render(content());
  await waitFor(()=>expect(screen.getByText('Camera ready. Hold or save a view, or try the example.')).toBeTruthy());
  const dock=screen.getByRole('group',{name:'Camera actions'});
  expect(within(dock).getByRole('button',{name:'Save view'})).toHaveProperty('disabled',false);
  expect(screen.queryByText(/Connecting to AI/)).toBeNull();
});

it('captures an unlabeled camera view for an explicit AI question without uploading on opening Ask',async()=>{
  camera.status='live';camera.localStatus='ready';
  vi.mocked(askScene).mockResolvedValue({answer:'The photograph shows a workspace with a screen on the left.',observations:['A clear surface is visible in front.'],object_ids:[],next_action:'none',limitation:'The exact device model is not readable.',provider:'fixture',model:'fixture',source:'captured_view'});
  render(content());
  const video=screen.getByLabelText('Live camera preview');
  Object.defineProperties(video,{videoWidth:{value:1280},videoHeight:{value:720}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,Y2FtZXJh');
  fireEvent.click(screen.getByRole('button',{name:'Ask AI'}));
  expect(screen.getByAltText('Held camera view').getAttribute('src')).toBe('data:image/jpeg;base64,Y2FtZXJh');
  expect(screen.getByText(/Choosing a question sends this held photo/)).toBeTruthy();
  expect(askScene).not.toHaveBeenCalled();
  expect(vi.mocked(useLiveCamera).mock.lastCall?.[0].pauseRecognition).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Explain this view'}));
  await screen.findByText('The photograph shows a workspace with a screen on the left.');
  expect(askScene).toHaveBeenCalledWith('data:image/jpeg;base64,Y2FtZXJh',[],expect.stringContaining('Recheck the suggested labels'),expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button',{name:'Resume live'}));
  expect(screen.queryByAltText('Held camera view')).toBeNull();
  expect(screen.queryByText('The photograph shows a workspace with a screen on the left.')).toBeNull();
});

it('lets a person correct or remove a held label and saves their correction',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Blob(['fixture'],{type:'image/webp'}))));
  render(content());
  fireEvent.click(await screen.findByRole('button',{name:'Try an interactive example'}));
  fireEvent.click(within(screen.getByRole('group',{name:'Quick object selection'})).getByRole('button',{name:'smartphone'}));
  fireEvent.click(screen.getByRole('button',{name:'Correct label'}));
  fireEvent.change(screen.getByLabelText('Object label'),{target:{value:'Calculator'}});
  fireEvent.click(screen.getByRole('button',{name:'Apply label'}));
  expect(screen.getByRole('button',{name:'Highlight Calculator in camera'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Highlight smartphone in camera'})).toBeNull();
  expect(screen.getByText('Your corrected label')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Save view'}));
  await screen.findByText('Saved on this device in My Spaces.');
  expect(saveDeviceSpace).toHaveBeenCalledWith(expect.objectContaining({notes:expect.stringContaining('Calculator')}));
  fireEvent.click(screen.getByRole('button',{name:'Remove label'}));
  expect(screen.queryByRole('button',{name:'Highlight Calculator in camera'})).toBeNull();
  expect(screen.getByRole('button',{name:'Save view'})).toHaveProperty('disabled',false);
});

it('does not mark a corrected capture as saved when an older save completes',async()=>{
  let finish!:()=>void;
  vi.mocked(saveDeviceSpace).mockImplementationOnce(()=>new Promise<IDBValidKey>(resolve=>{finish=()=>resolve('saved');}));
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Blob(['fixture'],{type:'image/webp'}))));
  render(content());
  fireEvent.click(await screen.findByRole('button',{name:'Try an interactive example'}));
  fireEvent.click(within(screen.getByRole('group',{name:'Quick object selection'})).getByRole('button',{name:'smartphone'}));
  fireEvent.click(screen.getByRole('button',{name:'Save view'}));
  await waitFor(()=>expect(saveDeviceSpace).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button',{name:'Correct label'}));
  fireEvent.change(screen.getByLabelText('Object label'),{target:{value:'Calculator'}});
  fireEvent.click(screen.getByRole('button',{name:'Apply label'}));
  await act(async()=>finish());
  expect(screen.getByRole('button',{name:'Save view'})).toHaveProperty('disabled',false);
  expect(screen.queryByRole('button',{name:'Open saved view'})).toBeNull();
});

it('never restores a lost on-device label from remembered background or an older analysis',async()=>{
  const laptop={id:'old-laptop',label:'Laptop',box:{x:.2,y:.2,width:.4,height:.4},locked:false};
  camera.status='live';camera.localStatus='ready';camera.localStabilizing=true;
  camera.analysis={objects:[laptop],summary:'A laptop on the desk.',concepts:[],warnings:[],message:'',provider:'on_device',model:'fixture',live_request:false};
  camera.memory.location={placeId:'desk',objects:[laptop],target:null,matchedAt:1,match:{a:1,b:0,tx:0,ty:0,inliers:20,score:1}};
  render(content());
  expect(screen.getByText('Checking object labels. Hold the view steady.')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Highlight Laptop in camera'})).toBeNull();
  expect(within(screen.getByRole('group',{name:'Quick object selection'})).queryAllByRole('button')).toHaveLength(0);
  const details=screen.getByText('View details & recognition notes').closest('details')!;
  details.open=true;fireEvent(details,new Event('toggle'));
  await screen.findByText('No confirmed objects in this view.');
  expect(screen.queryByText('A laptop on the desk.')).toBeNull();
});

it('restores the chosen photo and corrected labels after connecting AI without submitting automatically',async()=>{
  const image='data:image/jpeg;base64,Y2FtZXJh';
  const token=prepareCaptureHandoff({frame:{image_url:image,width:1280,height:720,name:'Captured view'},analysis:{objects:[{id:'calculator',label:'Calculator',source:'ai_corrected',confidence:null,locked:false,box:{x:.1,y:.2,width:.2,height:.2}}],summary:'Labels reviewed.',concepts:[],warnings:[],message:'',provider:'on_device',model:'fixture'}});
  window.history.replaceState(null,'',`/#/live?workspace=connected&capture=${token}`);
  render(content());
  expect(await screen.findByRole('button',{name:'Explain this view'})).toBeTruthy();
  expect(screen.getByAltText('Captured frame used for your question').getAttribute('src')).toBe(image);
  expect(screen.getByRole('button',{name:'Highlight Calculator in camera'})).toBeTruthy();
  expect(camera.start).not.toHaveBeenCalled();
  expect(askScene).not.toHaveBeenCalled();
});
