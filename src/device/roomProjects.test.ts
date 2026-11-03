// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const records=vi.hoisted(()=>new Map<string,unknown>());
const transport=vi.hoisted(()=>({beforeUpdate:vi.fn(async()=>{})}));
vi.mock('./workspaceStore',()=>({workspaceRecord:async(key:string)=>structuredClone(records.get(key)),updateWorkspaceRecord:async(key:string,update:(value:unknown)=>unknown,guard?:{key:string;check:(value:unknown)=>void})=>{await transport.beforeUpdate();guard?.check(structuredClone(records.get(guard.key)));const value=update(structuredClone(records.get(key)));records.set(key,structuredClone(value));return structuredClone(value);},workspaceRecords:async()=>[...records.values()].map(v=>structuredClone(v))}));
vi.mock('./store',()=>({loadRoomReference:async()=>undefined,saveRoomReference:vi.fn(async()=>undefined)}));
import { deleteRoomProject, emptyRoom, getRoomProject, initialRoomProject, listRoomProjects, newRoomProject, parseRoomProjectBackup, recoverRoomProject, restoreRoom, RoomConflict, RoomDeleted, saveRoomProject, snapshotRoom } from './roomProjects';
import { saveRoomReference } from './store';
import { roomDraftKey } from './roomDraft';
beforeEach(()=>{records.clear();localStorage.clear();transport.beforeUpdate.mockResolvedValue();});
afterEach(()=>vi.clearAllMocks());
it('migrates an existing single draft without losing it and creates distinct rooms',async()=>{
  localStorage.setItem(roomDraftKey,JSON.stringify({...emptyRoom(),goal:'My old room'}));
  const old=await initialRoomProject();expect(old.draft.goal).toBe('My old room');
  expect(localStorage.getItem(roomDraftKey)).toBeNull();expect(saveRoomReference).toHaveBeenCalledWith(null);
  const second=await newRoomProject('Bedroom');expect(second.id).not.toBe(old.id);
  expect((await listRoomProjects()).length).toBe(2);expect((await getRoomProject(old.id))?.draft.goal).toBe('My old room');
});
it('snapshots are independent and restoring retains the previous arrangement',async()=>{
  let p=await newRoomProject('Office');p.draft.goal='Read';p=snapshotRoom(p,'Reading');
  p.draft.goal='Work';const restored=restoreRoom(p,p.versions[0].id);
  expect(restored.draft.goal).toBe('Read');expect(restored.versions[1].draft.goal).toBe('Work');
  restored.draft.goal='Changed';expect(restored.versions[0].draft.goal).toBe('Read');
  await saveRoomProject(restored);expect((await getRoomProject(p.id))?.versions).toHaveLength(2);
});
it('duplicates and restores backups under fresh IDs without reconnecting old AI jobs',async()=>{
  const p=await newRoomProject('Office');p.draft.roomJob={id:crypto.randomUUID(),stage:'survey'};
  const restored=parseRoomProjectBackup({format:'worldos-room-project-v1',project:p});
  expect(restored.id).not.toBe(p.id);expect(restored.draft.roomJob).toBeUndefined();
  const copy=await newRoomProject('Office copy',p);copy.draft.goal='New idea';expect(p.draft.goal).toBe('');
  const longCopy=await newRoomProject('A'.repeat(80)+' copy',p);
  expect(parseRoomProjectBackup({format:'worldos-room-project-v1',project:longCopy}).name).toHaveLength(80);
});
it('rejects remote photos and excessive snapshots in imports',async()=>{
  const p=await newRoomProject();
  expect(()=>parseRoomProjectBackup({format:'worldos-room-project-v1',project:{...p,reference:{image_url:'https://private.example/photo.jpg'}}})).toThrow('invalid room photo');
  expect(()=>parseRoomProjectBackup({format:'worldos-room-project-v1',project:{...p,versions:Array(13).fill({})}})).toThrow('valid WorldOS');
});
it('refuses to snapshot an incomplete AI action',async()=>{
  const p=await newRoomProject();p.draft.roomJob={id:crypto.randomUUID(),stage:'design'};
  expect(()=>snapshotRoom(p,'Pending')).toThrow('Wait');
});
it('rejects stale-tab writes and recovers them separately without overwriting newer work',async()=>{
  const first=await newRoomProject('Office'),stale=structuredClone(first);
  first.draft.goal='Keep lamp';await saveRoomProject(first);
  stale.name='Second tab';await expect(saveRoomProject(stale)).rejects.toThrow(RoomConflict);
  const recovered=await recoverRoomProject(stale);
  expect((await getRoomProject(first.id))?.draft.goal).toBe('Keep lamp');
  expect((await getRoomProject(first.id))?.name).toBe('Office');
  expect(recovered.id).not.toBe(first.id);expect(recovered.name).toContain('Second tab');
});
it('keeps archived rooms recoverable while selecting an active room',async()=>{
  const old=await newRoomProject('Archived');old.archived=true;await saveRoomProject(old);
  expect((await initialRoomProject()).id).not.toBe(old.id);
  expect((await listRoomProjects()).find(p=>p.id===old.id)?.archived).toBe(true);
});
it('deletes a room and its alternatives/photo while preserving other rooms and refusing stale-tab saves',async()=>{
  const project=await newRoomProject('Bedroom'),other=await newRoomProject('Office');
  project.reference={image_url:'data:image/png;base64,cGhvdG8=',width:1,height:1,corners:[],labels:[]};
  const saved=snapshotRoom(project,'Window layout');await saveRoomProject(saved);
  localStorage.setItem('worldos.active-room',project.id);localStorage.setItem(roomDraftKey,JSON.stringify({...emptyRoom(),goal:'Old duplicate'}));
  const listener=vi.fn();window.addEventListener('worldos:room-deleted',listener);
  await deleteRoomProject(project.id);
  expect(await getRoomProject(project.id)).toBeUndefined();expect((await listRoomProjects()).map(value=>value.id)).toEqual([other.id]);
  expect(records.get(`room:${project.id}`)).toEqual({kind:'room-deleted',id:project.id,revision:(saved.revision??0)+1});
  expect(localStorage.getItem('worldos.active-room')).toBeNull();expect(JSON.parse(localStorage.getItem(roomDraftKey)!).goal).toBe('Old duplicate');
  await expect(saveRoomProject(saved)).rejects.toThrow(RoomDeleted);
  await expect(saveRoomProject({...project,revision:0})).rejects.toThrow(RoomDeleted);
  await expect(recoverRoomProject(saved)).rejects.toThrow(RoomDeleted);
  expect(listener).toHaveBeenCalledTimes(1);window.removeEventListener('worldos:room-deleted',listener);
});
it('orders deletion after an in-flight save and blocks a save queued behind deletion',async()=>{
  const project=await newRoomProject('Office');
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  transport.beforeUpdate.mockReturnValueOnce(gate);
  project.draft.goal='Pending edit';const saving=saveRoomProject(project),deleting=deleteRoomProject(project.id);
  const staleSave=saveRoomProject({...project,revision:0});
  const rejected=expect(staleSave).rejects.toThrow(RoomDeleted);
  release();await saving;await deleting;await rejected;
  expect(await getRoomProject(project.id)).toBeUndefined();expect(await listRoomProjects()).toEqual([]);
});
it('retains a room when deletion fails and permits a retry',async()=>{
  const project=await newRoomProject('Office');
  transport.beforeUpdate.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(deleteRoomProject(project.id)).rejects.toThrow('Storage unavailable');
  expect((await getRoomProject(project.id))?.name).toBe('Office');
  await deleteRoomProject(project.id);expect(await getRoomProject(project.id)).toBeUndefined();
});
it('does not migrate a legacy duplicate after the last room was deleted',async()=>{
  const project=await newRoomProject('Deleted room');await deleteRoomProject(project.id);
  localStorage.setItem(roomDraftKey,JSON.stringify({...emptyRoom(),goal:'Deleted legacy room'}));
  const fresh=await initialRoomProject();expect(fresh.id).not.toBe(project.id);expect(fresh.draft.goal).toBe('');
});
it('refuses recovery when another tab deletes the original before the recovery write acquires its transaction',async()=>{
  const project=await newRoomProject('Office');let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),begun=new Promise<void>(resolve=>{started=resolve;});
  transport.beforeUpdate.mockImplementationOnce(async()=>{started();await gate;});
  const recovery=recoverRoomProject(project),rejected=expect(recovery).rejects.toThrow(RoomDeleted);
  await begun;await deleteRoomProject(project.id);release();await rejected;
  expect(await listRoomProjects()).toEqual([]);expect([...records.values()]).toEqual([{kind:'room-deleted',id:project.id,revision:2}]);
});
