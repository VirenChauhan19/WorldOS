// @vitest-environment jsdom
// Storage is an in-memory transport fixture; routing, editing and save lifecycle are real.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DeviceSetup from './DeviceSetup';
import { navigate, useRoute } from '../navigation';
import type { DeviceSpace } from './store';

const transport=vi.hoisted(()=>({getDeviceSpace:vi.fn(),saveDeviceSpace:vi.fn(),readPhoto:vi.fn()}));
vi.mock('./store',()=>transport);
vi.mock('../PhotoActions',()=>({default:({label,onPhoto}:{label:string;onPhoto:(file:File)=>Promise<void>})=><button onClick={()=>void onPhoto(new File(['fixture'],'photo.jpg',{type:'image/jpeg'}))}>{label}</button>}));
vi.mock('../exportFile',()=>({exportJSON:vi.fn(async()=>{})}));
import { exportJSON } from '../exportFile';

let records:Map<string,DeviceSpace>;
const existing=():DeviceSpace=>({id:'existing-desk',name:'My desk',notes:'Original note',photo:'',after:'',steps:[{id:'step-1',text:'Clear the notebook space',done:false}],updatedAt:'2026-11-02T10:00:00Z'});
beforeEach(()=>{
  window.history.replaceState(null,'','/#/mission');
  records=new Map();
  transport.getDeviceSpace.mockImplementation(async(id:string)=>records.get(id));
  transport.saveDeviceSpace.mockImplementation(async(value:DeviceSpace)=>{records.set(value.id,structuredClone(value));return value.id;});
  transport.readPhoto.mockResolvedValue('data:image/jpeg;base64,cGhvdG8=');
});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.restoreAllMocks();});

function RoutedSetup(){const route=useRoute();return <><DeviceSetup active={route.page==='mission'}/>{route.page==='history'&&<p>Saved setups view</p>}</>;}

it('automatically saves edited name, notes and progress without requiring the save button',async()=>{
  render(<DeviceSetup/>);
  fireEvent.change(screen.getByLabelText('Setup name'),{target:{value:'Evening desk'}});
  fireEvent.change(screen.getByLabelText('Setup notes'),{target:{value:'Keep the lamp on the left.'}});
  fireEvent.click(screen.getByLabelText('Complete step 1'));
  expect(screen.getByText('Saving your changes…')).toBeTruthy();
  await waitFor(()=>expect(transport.saveDeviceSpace).toHaveBeenCalled(),{timeout:2000});
  const saved=Array.from(records.values())[0];
  expect(saved.name).toBe('Evening desk');expect(saved.notes).toBe('Keep the lamp on the left.');expect(saved.steps[0].done).toBe(true);
  await screen.findByText('Saved on this device. You can come back after reloading.');
  expect(window.location.hash).toBe(`#/mission?device=${saved.id}`);
});

it('keeps the same focused input and setup identity when the first autosave updates the route',async()=>{
  render(<DeviceSetup/>);
  const name=screen.getByLabelText('Setup name') as HTMLInputElement;
  name.focus();fireEvent.change(name,{target:{value:'My focus corner'}});
  await waitFor(()=>expect(window.location.hash).toContain('device='),{timeout:2000});
  expect(screen.getByLabelText('Setup name')).toBe(name);expect(document.activeElement).toBe(name);
  expect(name.value).toBe('My focus corner');expect(transport.getDeviceSpace).not.toHaveBeenCalled();
  const firstId=Array.from(records.keys())[0];
  fireEvent.change(screen.getByLabelText('Setup notes'),{target:{value:'No second setup should be created.'}});
  await waitFor(()=>expect(records.get(firstId)?.notes).toBe('No second setup should be created.'),{timeout:2000});
  expect(records.size).toBe(1);expect(window.location.hash).toBe(`#/mission?device=${firstId}`);
});

it('flushes the newest edit when internal navigation leaves before the autosave delay',async()=>{
  records.set('existing-desk',existing());
  window.history.replaceState(null,'','/#/mission?device=existing-desk');
  render(<RoutedSetup/>);
  const notes=await screen.findByLabelText('Setup notes');
  fireEvent.change(notes,{target:{value:'First change'}});
  fireEvent.change(notes,{target:{value:'Latest change before leaving'}});
  fireEvent.click(screen.getByRole('button',{name:'Back to My Spaces'}));
  await screen.findByText('Saved setups view');
  await waitFor(()=>expect(records.get('existing-desk')?.notes).toBe('Latest change before leaving'));
  expect(transport.saveDeviceSpace).toHaveBeenCalledTimes(1);
  await act(async()=>navigate('mission',{device:'existing-desk'}));
  expect(await screen.findByLabelText('Setup notes')).toHaveProperty('value','Latest change before leaving');
});

it('shows recovery for a missing setup and never saves a bogus starter under its broken URL',async()=>{
  window.history.replaceState(null,'','/#/mission?device=missing-setup');
  render(<DeviceSetup/>);
  await screen.findByRole('heading',{name:'Setup not found'});
  expect(screen.queryByLabelText('Setup name')).toBeNull();
  expect(screen.queryByRole('button',{name:'Save on this device'})).toBeNull();
  expect(transport.saveDeviceSpace).not.toHaveBeenCalled();expect(records.size).toBe(0);
  fireEvent.click(screen.getByRole('button',{name:'Create a new setup'}));
  const name=await screen.findByLabelText('Setup name');
  fireEvent.change(name,{target:{value:'Recovered new setup'}});
  await waitFor(()=>expect(transport.saveDeviceSpace).toHaveBeenCalled(),{timeout:2000});
  const saved=Array.from(records.values())[0];expect(saved.id).not.toBe('missing-setup');
  expect(window.location.hash).toBe(`#/mission?device=${saved.id}`);
});

it('exports the same recoverable shape that autosave stores when fields are temporarily blank',async()=>{
  render(<DeviceSetup/>);
  fireEvent.change(screen.getByLabelText('Setup name'),{target:{value:''}});
  fireEvent.change(screen.getByLabelText('Step 1'),{target:{value:''}});
  await waitFor(()=>expect(transport.saveDeviceSpace).toHaveBeenCalled(),{timeout:2000});
  fireEvent.click(screen.getByRole('button',{name:'Export backup'}));
  expect(exportJSON).toHaveBeenCalledWith(expect.objectContaining({format:'worldos-device-space-v1',space:expect.objectContaining({name:'Untitled setup',steps:expect.arrayContaining([expect.objectContaining({text:'Put away things you do not need for that activity.'})])})}),expect.any(String));
  const exported=vi.mocked(exportJSON).mock.calls[0][0] as {space:DeviceSpace};
  expect(exported.space.steps).toHaveLength(2);expect(exported.space.steps.every(step=>step.text.trim())).toBe(true);
});

it('finishes saving a chosen photo even when navigation happens while the photo is opening',async()=>{
  records.set('existing-desk',existing());window.history.replaceState(null,'','/#/mission?device=existing-desk');
  let finish!:(value:string)=>void;transport.readPhoto.mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve;}));
  render(<RoutedSetup/>);await screen.findByLabelText('Setup name');
  fireEvent.click(screen.getByRole('button',{name:'Choose reference photo'}));
  fireEvent.click(screen.getByRole('button',{name:'Back to My Spaces'}));await screen.findByText('Saved setups view');
  await act(async()=>finish('data:image/jpeg;base64,cGhvdG8='));
  await waitFor(()=>expect(records.get('existing-desk')?.photo).toBe('data:image/jpeg;base64,cGhvdG8='));
});
