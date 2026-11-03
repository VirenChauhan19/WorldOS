// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DeviceSpaces from './DeviceSpaces';
import { listDeviceSpaces, loadRoomReference } from './store';
import { loadRoomDraft } from './roomDraft';
import type { DeviceSpace } from './store';
import type { RoomReference } from '../room/photoPlane';
import { listRoomProjects } from './roomProjects';
vi.mock('./roomProjects',async original=>({...await original<typeof import('./roomProjects')>(),listRoomProjects:vi.fn(async()=>[])}));

vi.mock('./store',async original=>({...await original<typeof import('./store')>(),listDeviceSpaces:vi.fn(),loadRoomReference:vi.fn()}));
vi.mock('./roomDraft',()=>({loadRoomDraft:vi.fn()}));

function deferred<T>() {
  let resolve!:(value:T)=>void, reject!:(reason:Error)=>void;
  const promise=new Promise<T>((accept,decline)=>{resolve=accept;reject=decline;});
  return {promise,resolve,reject};
}
const saved:DeviceSpace={id:'desk',name:'Evening desk',notes:'',photo:'',after:'',steps:[],updatedAt:'2026-11-02T10:00:00Z'};
beforeEach(()=>{
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
afterEach(()=>{cleanup();vi.resetAllMocks();});

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
