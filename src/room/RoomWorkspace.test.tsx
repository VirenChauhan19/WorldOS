// @vitest-environment jsdom
// The record transport is in memory; deletion, revision checks, routing and autosaves are real.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RoomProject } from '../device/roomProjects';
import type { RoomDraft } from '../device/roomDraft';
const records=vi.hoisted(()=>new Map<string,unknown>());
const transport=vi.hoisted(()=>({beforeUpdate:vi.fn(async()=>{})}));
vi.mock('../device/workspaceStore',()=>({
  workspaceRecord:async(key:string)=>structuredClone(records.get(key)),
  workspaceRecords:async()=>[...records.values()].map(value=>structuredClone(value)),
  updateWorkspaceRecord:async(key:string,update:(value:unknown)=>unknown,guard?:{key:string;check:(value:unknown)=>void})=>{await transport.beforeUpdate();guard?.check(structuredClone(records.get(guard.key)));const value=update(structuredClone(records.get(key)));records.set(key,structuredClone(value));return structuredClone(value);},
}));
vi.mock('../device/store',()=>({loadRoomReference:async()=>undefined,saveRoomReference:async()=>undefined}));
vi.mock('./RoomStudio',()=>({default:({initialProject,onProjectChange}:{initialProject:RoomProject;onProjectChange:(draft:RoomDraft,reference:null)=>void})=><button onClick={()=>onProjectChange({...initialProject.draft,goal:'Latest arrangement'},null)}>Edit room layout</button>}));
vi.mock('./RoomPreview',()=>({default:()=>null}));
import { deleteRoomProject, getRoomProject, listRoomProjects, newRoomProject } from '../device/roomProjects';
import RoomWorkspace from './RoomWorkspace';
beforeEach(()=>{records.clear();localStorage.clear();transport.beforeUpdate.mockReset();transport.beforeUpdate.mockResolvedValue();});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function open(){const project=await newRoomProject('Reading room');window.history.replaceState(null,'',`/#/room?project=${project.id}`);const view=render(<RoomWorkspace/>);await screen.findByLabelText('Room name');return {project,...view};}
it('does not recreate a deleted room from its pending autosave or unmount flush',async()=>{
  const {project}=await open();fireEvent.click(screen.getByRole('button',{name:'Edit room layout'}));
  await act(async()=>deleteRoomProject(project.id));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('deleted from My Spaces'));
  expect(screen.queryByRole('button',{name:'Edit room layout'})).toBeNull();
  await act(async()=>new Promise(resolve=>setTimeout(resolve,450)));
  expect(await getRoomProject(project.id)).toBeUndefined();expect(await listRoomProjects()).toEqual([]);
  expect([...records.values()]).toEqual([{kind:'room-deleted',id:project.id,revision:2}]);
});
it('invalidates an inactive cached editor and cannot restore the room when revisited',async()=>{
  const {project,rerender}=await open();fireEvent.click(screen.getByRole('button',{name:'Edit room layout'}));
  rerender(<RoomWorkspace active={false}/>);
  await act(async()=>deleteRoomProject(project.id));
  expect(screen.queryByRole('button',{name:'Edit room layout'})).toBeNull();expect(await listRoomProjects()).toEqual([]);
  rerender(<RoomWorkspace/>);expect((await screen.findByRole('alert')).textContent).toContain('not found');
  expect(await listRoomProjects()).toEqual([]);
});
it('rejects a stale editor save after another tab deletes the room without creating a recovery copy',async()=>{
  const {project}=await open();records.set(`room:${project.id}`,{kind:'room-deleted',id:project.id,revision:2});
  fireEvent.click(screen.getByRole('button',{name:'Edit room layout'}));
  expect((await screen.findByRole('alert')).textContent).toContain('deleted from My Spaces');
  expect(screen.queryByRole('button',{name:'Edit room layout'})).toBeNull();expect(await listRoomProjects()).toEqual([]);
});
it('closes a cached editor immediately after a deletion broadcast from another tab',async()=>{
  const channels:{onmessage:((event:{data:unknown})=>void)|null;closed:boolean}[]=[];
  vi.stubGlobal('BroadcastChannel',class {onmessage:((event:{data:unknown})=>void)|null=null;closed=false;constructor(){channels.push(this);}postMessage(){}close(){this.closed=true;}});
  const {project,rerender}=await open();rerender(<RoomWorkspace active={false}/>);
  records.set(`room:${project.id}`,{kind:'room-deleted',id:project.id,revision:2});
  act(()=>{for(const channel of channels)if(!channel.closed)channel.onmessage?.({data:{type:'room-deleted',id:project.id}});});
  expect((await screen.findByRole('alert')).textContent).toContain('deleted from My Spaces');expect(screen.queryByRole('button',{name:'Edit room layout'})).toBeNull();
  expect(await listRoomProjects()).toEqual([]);
});
it('keeps edits available after a storage failure and saves them on retry',async()=>{
  const {project}=await open();transport.beforeUpdate.mockRejectedValueOnce(new Error('Storage is full'));
  fireEvent.click(screen.getByRole('button',{name:'Edit room layout'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Storage is full');
  expect(screen.getByRole('button',{name:'Edit room layout'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Retry save'}));
  await waitFor(async()=>expect((await getRoomProject(project.id))?.draft.goal).toBe('Latest arrangement'));
  expect(await screen.findByText('Saved on this device')).toBeTruthy();
});
