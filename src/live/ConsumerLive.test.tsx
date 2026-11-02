// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeviceWorkspaceContext } from '../device/context';
import type { useLiveCamera as CameraHook } from './useLiveCamera';
vi.mock('./useLiveCamera',()=>({useLiveCamera:vi.fn()}));
vi.mock('./xr',()=>({isWorldARSupported:vi.fn(async()=>false),startWorldAR:vi.fn()}));
vi.mock('../device/store',()=>({readPhoto:vi.fn(async()=> 'data:image/webp;base64,Zml4dHVyZQ=='),saveDeviceSpace:vi.fn(async()=>undefined)}));
import { useLiveCamera } from './useLiveCamera';
import { saveDeviceSpace } from '../device/store';
import LiveSpace from './LiveSpace';

let camera:ReturnType<typeof CameraHook>;
beforeEach(()=>{
  window.history.replaceState(null,'','/#/live');
  camera={memory:{places:[],items:[],location:null,full:false},forgetMemory:vi.fn(),renamePlace:vi.fn(),trackedObjects:[],latencyMs:null,localStatus:'off',localLatencyMs:null,resultAgeMs:null,status:'idle',error:'',analysis:null,analysisFrame:null,lastScan:null,steady:false,analyzing:false,recognitionStatus:'waiting',retryInSeconds:0,lastRecognizedAt:null,start:vi.fn(async()=>{}),stop:vi.fn(),retry:vi.fn()};
  vi.mocked(useLiveCamera).mockReturnValue(camera);
});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.unstubAllGlobals();});
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
