// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const records=vi.hoisted(()=>new Map<string,unknown>());
vi.mock('./workspaceStore',()=>({workspaceRecord:async(key:string)=>structuredClone(records.get(key)),updateWorkspaceRecord:async(key:string,update:(value:unknown)=>unknown)=>{const value=update(structuredClone(records.get(key)));records.set(key,structuredClone(value));return structuredClone(value);},workspaceRecords:async()=>[...records.values()].map(v=>structuredClone(v))}));
vi.mock('./store',()=>({loadRoomReference:async()=>undefined}));
import { emptyRoom, getRoomProject, initialRoomProject, listRoomProjects, newRoomProject, parseRoomProjectBackup, recoverRoomProject, restoreRoom, RoomConflict, saveRoomProject, snapshotRoom } from './roomProjects';
import { roomDraftKey } from './roomDraft';
beforeEach(()=>{records.clear();localStorage.clear();});
it('migrates an existing single draft without losing it and creates distinct rooms',async()=>{
  localStorage.setItem(roomDraftKey,JSON.stringify({...emptyRoom(),goal:'My old room'}));
  const old=await initialRoomProject();expect(old.draft.goal).toBe('My old room');
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
