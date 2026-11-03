// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DeviceSpaces from './DeviceSpaces';
import { deleteDeviceSpace, listDeviceSpaces, loadRoomReference } from './store';
import { loadRoomDraft } from './roomDraft';
import type { DeviceSpace } from './store';
import type { RoomReference } from '../room/photoPlane';
import { deleteLegacyRoomPlan, deleteRoomProject, emptyRoom, hasRoomProjectHistory, listRoomProjects } from './roomProjects';
import type { RoomProject } from './roomProjects';
import { createScene, SCENE_STORAGE_KEY } from '../ar/scene';
vi.mock('./roomProjects',async original=>({...await original<typeof import('./roomProjects')>(),listRoomProjects:vi.fn(async()=>[]),hasRoomProjectHistory:vi.fn(async()=>false),deleteRoomProject:vi.fn(async()=>{}),deleteLegacyRoomPlan:vi.fn(async()=>{})}));

vi.mock('./store',async original=>({...await original<typeof import('./store')>(),listDeviceSpaces:vi.fn(),loadRoomReference:vi.fn(),deleteDeviceSpace:vi.fn(async()=>{})}));
vi.mock('./roomDraft',()=>({loadRoomDraft:vi.fn()}));

function deferred<T>() {
  let resolve!:(value:T)=>void, reject!:(reason:Error)=>void;
  const promise=new Promise<T>((accept,decline)=>{resolve=accept;reject=decline;});
  return {promise,resolve,reject};
}
const saved:DeviceSpace={id:'desk',name:'Evening desk',notes:'',photo:'',after:'',steps:[],updatedAt:'2026-11-02T10:00:00Z'};
beforeEach(()=>{
  localStorage.clear();window.history.replaceState(null,'','/#/history');
  vi.mocked(deleteRoomProject).mockResolvedValue(undefined);
  vi.mocked(hasRoomProjectHistory).mockResolvedValue(false);
  vi.mocked(deleteDeviceSpace).mockResolvedValue(undefined);vi.mocked(deleteLegacyRoomPlan).mockResolvedValue(undefined);
  vi.mocked(listRoomProjects).mockResolvedValue([]);
  vi.mocked(listDeviceSpaces).mockResolvedValue([]);
  vi.mocked(loadRoomReference).mockResolvedValue(undefined);
  vi.mocked(loadRoomDraft).mockReturnValue(null);
});
it('shows a project storage error instead of claiming saved rooms are absent',async()=>{
  vi.mocked(listRoomProjects).mockRejectedValueOnce(new Error('Storage unavailable.'));
  render(<DeviceSpaces/>);expect((await screen.findByRole('alert')).textContent).toContain('Room projects could not be opened');
  expect(screen.queryByText('Nothing saved yet')).toBeNull();
});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.restoreAllMocks();localStorage.clear();});

it.each(['setups first','room first'])('waits for both storage reads before showing an empty state: %s',async order=>{
  const setups=deferred<DeviceSpace[]>(),room=deferred<RoomReference|undefined>();
  vi.mocked(listDeviceSpaces).mockReturnValue(setups.promise);
  vi.mocked(loadRoomReference).mockReturnValue(room.promise);
  render(<DeviceSpaces/>);
  expect(screen.getByRole('status').textContent).toBe('Loading saved work…');
  expect(screen.queryByText('Nothing saved yet')).toBeNull();
  await act(async()=>{if(order==='setups first')setups.resolve([]);else room.resolve(undefined);});
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.queryByText('Nothing saved yet')).toBeNull();
  await act(async()=>{if(order==='setups first')room.resolve(undefined);else setups.resolve([]);});
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('heading',{name:'Nothing saved yet'})).toBeTruthy();
});

it('keeps the compact list hidden while opening saved work',async()=>{
  const setups=deferred<DeviceSpace[]>(),room=deferred<RoomReference|undefined>();
  vi.mocked(listDeviceSpaces).mockReturnValue(setups.promise);
  vi.mocked(loadRoomReference).mockReturnValue(room.promise);
  const {container}=render(<DeviceSpaces compact/>);
  expect(container.childElementCount).toBe(0);
  await act(async()=>{setups.resolve([saved]);room.resolve(undefined);});
  expect(screen.getByRole('button',{name:/^Evening desk/})).toBeTruthy();
  expect(screen.queryByText('Nothing saved yet')).toBeNull();
});

it('retains loaded rows while a storage refresh is pending',async()=>{
  vi.mocked(listDeviceSpaces).mockResolvedValueOnce([saved]);
  render(<DeviceSpaces/>);
  await screen.findByRole('button',{name:/^Evening desk/});
  const setups=deferred<DeviceSpace[]>(),room=deferred<RoomReference|undefined>();
  vi.mocked(listDeviceSpaces).mockReturnValueOnce(setups.promise);
  vi.mocked(loadRoomReference).mockReturnValueOnce(room.promise);
  act(()=>window.dispatchEvent(new Event('worldos:device-saved')));
  expect(screen.getByRole('button',{name:/^Evening desk/})).toBeTruthy();
  expect(screen.queryByText('Nothing saved yet')).toBeNull();
  await act(async()=>{setups.resolve([saved]);room.resolve(undefined);});
  expect(screen.getByRole('button',{name:/^Evening desk/})).toBeTruthy();
});

it('waits for room storage after a setup read fails and keeps the error visible',async()=>{
  const setups=deferred<DeviceSpace[]>(),room=deferred<RoomReference|undefined>();
  vi.mocked(listDeviceSpaces).mockReturnValue(setups.promise);
  vi.mocked(loadRoomReference).mockReturnValue(room.promise);
  render(<DeviceSpaces/>);
  await act(async()=>setups.reject(new Error('Storage unavailable.')));
  expect(screen.getByRole('alert').textContent).toContain('Storage unavailable.');
  expect(screen.getByRole('status')).toBeTruthy();
  await act(async()=>room.reject(new Error('Room photo unavailable.')));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Storage unavailable.');
  expect(screen.queryByText('Nothing saved yet')).toBeNull();
});

it('still opens the room draft when its reference photo cannot be read',async()=>{
  const room=deferred<RoomReference|undefined>();
  vi.mocked(loadRoomReference).mockReturnValue(room.promise);
  vi.mocked(loadRoomDraft).mockReturnValue({roomFields:{width:'3',depth:'4',height:''},source:'entered',items:[],gap:'0.1',manual:null});
  render(<DeviceSpaces/>);
  expect(screen.getByRole('status')).toBeTruthy();
  await act(async()=>room.reject(new Error('Room photo unavailable.')));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button',{name:'Continue my room plan'})).toBeTruthy();
  expect(screen.queryByText('Nothing saved yet')).toBeNull();
});

it('ignores reads completed after deactivation and waits for fresh reads on return',async()=>{
  const oldSetups=deferred<DeviceSpace[]>(),oldRoom=deferred<RoomReference|undefined>();
  vi.mocked(listDeviceSpaces).mockReturnValueOnce(oldSetups.promise);
  vi.mocked(loadRoomReference).mockReturnValueOnce(oldRoom.promise);
  const {rerender}=render(<DeviceSpaces/>);
  rerender(<DeviceSpaces active={false}/>);
  await act(async()=>{oldSetups.resolve([saved]);oldRoom.resolve({image_url:'old-room.jpg',width:1,height:1,corners:[],labels:[]});});
  expect(screen.queryByRole('button',{name:/^Evening desk/})).toBeNull();
  expect(screen.queryByRole('button',{name:'Continue my room plan'})).toBeNull();
  expect(screen.getByRole('status')).toBeTruthy();
  const setups=deferred<DeviceSpace[]>(),room=deferred<RoomReference|undefined>();
  vi.mocked(listDeviceSpaces).mockReturnValueOnce(setups.promise);
  vi.mocked(loadRoomReference).mockReturnValueOnce(room.promise);
  rerender(<DeviceSpaces/>);
  await act(async()=>setups.resolve([]));
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.queryByText('Nothing saved yet')).toBeNull();
  await act(async()=>room.resolve(undefined));
  expect(screen.getByRole('heading',{name:'Nothing saved yet'})).toBeTruthy();
});
const roomProject=(name='Reading room',archived=false):RoomProject=>({kind:'room-project',id:name,name,archived,updatedAt:'now',draft:emptyRoom(),reference:null,versions:[]});
it('offers a separate delete action with a named confirmation and cancels without deleting',async()=>{
  vi.mocked(listRoomProjects).mockResolvedValue([roomProject()]);
  const {container}=render(<DeviceSpaces/>);
  fireEvent.click(await screen.findByRole('button',{name:'Delete room Reading room'}));
  const dialog=screen.getByRole('dialog',{name:'Delete this room?'});
  expect(within(dialog).getByText('Reading room')).toBeTruthy();expect(dialog.textContent).toContain('reference photo, and all saved alternatives');
  expect(container.querySelector('button button')).toBeNull();expect(window.location.hash).toBe('#/history');
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));
  expect(screen.queryByRole('dialog')).toBeNull();expect(deleteRoomProject).not.toHaveBeenCalled();
});
it.each([false,true])('deletes a confirmed room from the list, including archived rooms: %s',async archived=>{
  vi.mocked(listRoomProjects).mockResolvedValue([roomProject('Office',archived)]);
  render(<DeviceSpaces/>);
  if(archived)fireEvent.click(await screen.findByText('Archived rooms (1)'));
  fireEvent.click(await screen.findByRole('button',{name:archived?'Delete archived room Office':'Delete room Office'}));
  vi.mocked(listRoomProjects).mockResolvedValue([]);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete room'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(deleteRoomProject).toHaveBeenCalledWith('Office');expect(screen.queryByText('Office')).toBeNull();
});
it('keeps the room and confirmation open when deletion fails, then retries',async()=>{
  vi.mocked(listRoomProjects).mockResolvedValue([roomProject()]);vi.mocked(deleteRoomProject).mockRejectedValueOnce(new Error('Storage unavailable'));
  render(<DeviceSpaces/>);fireEvent.click(await screen.findByRole('button',{name:'Delete room Reading room'}));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete room'}));
  expect((await screen.findByRole('alert')).textContent).toBe('Storage unavailable');expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Delete room Reading room'})).toBeTruthy();
  vi.mocked(listRoomProjects).mockResolvedValue([]);fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete room'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(deleteRoomProject).toHaveBeenCalledTimes(2);
});
it('shows the saved AR design, cancels deletion, and removes only that design after confirmation',async()=>{
  localStorage.setItem(SCENE_STORAGE_KEY,JSON.stringify(createScene('Garden studio')));
  vi.mocked(listRoomProjects).mockResolvedValue([roomProject()]);render(<DeviceSpaces/>);
  fireEvent.click(await screen.findByRole('button',{name:'Delete AR design Garden studio'}));
  const dialog=screen.getByRole('dialog',{name:'Delete this AR design?'});expect(dialog.textContent).toContain('Garden studio');
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));expect(localStorage.getItem(SCENE_STORAGE_KEY)).not.toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Delete AR design Garden studio'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete AR design'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBeNull();
  expect(screen.getByRole('button',{name:'Delete room Reading room'})).toBeTruthy();expect(deleteRoomProject).not.toHaveBeenCalled();
});
it('retains the AR design and displays a storage failure in its confirmation',async()=>{
  localStorage.setItem(SCENE_STORAGE_KEY,JSON.stringify(createScene('Garden studio')));render(<DeviceSpaces/>);
  fireEvent.click(await screen.findByRole('button',{name:'Delete AR design Garden studio'}));
  vi.spyOn(Storage.prototype,'removeItem').mockImplementationOnce(()=>{throw new Error('Storage unavailable');});
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete AR design'}));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be deleted');expect(localStorage.getItem(SCENE_STORAGE_KEY)).not.toBeNull();
});
it.each([{notify:true,name:'New studio'},{notify:false,name:'New studio'},{notify:true,name:'Garden studio'}])('preserves an AR design replaced while its deletion confirmation is open ($name, storage event: $notify)',async({notify,name})=>{
  localStorage.setItem(SCENE_STORAGE_KEY,JSON.stringify(createScene('Garden studio')));render(<DeviceSpaces/>);
  fireEvent.click(await screen.findByRole('button',{name:'Delete AR design Garden studio'}));
  const replacement=createScene(name,{width:6,depth:5});localStorage.setItem(SCENE_STORAGE_KEY,JSON.stringify(replacement));
  if(notify)act(()=>window.dispatchEvent(new StorageEvent('storage',{key:SCENE_STORAGE_KEY,newValue:JSON.stringify(replacement)})));
  const dialog=screen.getByRole('dialog');expect(within(dialog).getByText('Garden studio')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button',{name:'Delete AR design'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Close this confirmation and choose Delete again');
  expect(JSON.parse(localStorage.getItem(SCENE_STORAGE_KEY)!)).toEqual(replacement);expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));fireEvent.click(screen.getByRole('button',{name:`Delete AR design ${name}`}));
  expect(within(screen.getByRole('dialog')).getByText(name)).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete AR design'}));
  expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBeNull();expect(screen.queryByRole('dialog')).toBeNull();
});
it('deletes an older saved room plan through the same named confirmation',async()=>{
  vi.mocked(loadRoomDraft).mockReturnValue({...emptyRoom(),roomFields:{width:'3',depth:'4',height:''}});render(<DeviceSpaces/>);
  fireEvent.click(await screen.findByRole('button',{name:'Delete saved room plan'}));expect(screen.getByRole('dialog').textContent).toContain('Saved room plan');
  vi.mocked(loadRoomDraft).mockReturnValue(null);fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete room'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(deleteLegacyRoomPlan).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:'Continue my room plan'})).toBeNull();
});
it('does not show an old legacy copy after room projects have been deleted',async()=>{
  vi.mocked(hasRoomProjectHistory).mockResolvedValue(true);vi.mocked(loadRoomDraft).mockReturnValue({...emptyRoom(),roomFields:{width:'3',depth:'4',height:''}});
  render(<DeviceSpaces/>);expect(await screen.findByRole('heading',{name:'Nothing saved yet'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Continue my room plan'})).toBeNull();
});
it('provides a visible delete action for checklists and retains the setup after a failed deletion',async()=>{
  vi.mocked(listDeviceSpaces).mockResolvedValue([saved]);vi.mocked(deleteDeviceSpace).mockRejectedValueOnce(new Error('Storage unavailable'));
  render(<DeviceSpaces/>);fireEvent.click(await screen.findByRole('button',{name:'Delete setup Evening desk'}));
  expect(screen.getByRole('dialog').textContent).toContain('Evening desk');fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Cancel'}));expect(deleteDeviceSpace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Delete setup Evening desk'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete setup'}));
  expect((await screen.findByRole('alert')).textContent).toBe('Storage unavailable');
  vi.mocked(listDeviceSpaces).mockResolvedValue([]);fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Delete setup'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.queryByRole('button',{name:'Delete setup Evening desk'})).toBeNull();
});
