// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { listDeviceSpaces, parseDeviceBackup } from './store';
const space={name:'Desk',notes:'Keep my book here',photo:'data:image/png;base64,aGVsbG8=',after:'',steps:[{id:'old',text:'Clear the desk',done:true}],id:'old',updatedAt:'old'};
it('restores photos and completed steps under fresh identities without overwriting a setup',()=>{
  const first=parseDeviceBackup({format:'worldos-device-space-v1',space}),second=parseDeviceBackup({format:'worldos-device-space-v1',space});
  expect(first.photo).toBe(space.photo);expect(first.steps[0].done).toBe(true);
  expect(first.id).not.toBe(space.id);expect(first.id).not.toBe(second.id);expect(first.steps[0].id).not.toBe('old');
});
it.each(['https://example.com/private.png','data:image/svg+xml;base64,aGVsbG8=','javascript:alert(1)'])('rejects non-photo image content from backups: %s',photo=>{
  expect(()=>parseDeviceBackup({format:'worldos-device-space-v1',space:{...space,photo}})).toThrow('valid WorldOS device setup');
});
it('rejects malformed or oversized backups',()=>{
  for(const value of [null,{}, {format:'worldos-device-space-v1',space:{...space,steps:[null]}},{format:'worldos-device-space-v1',space:{...space,name:'x'.repeat(121)}}])expect(()=>parseDeviceBackup(value)).toThrow();
});
it('reports unavailable storage instead of pretending data was saved',async()=>{
  vi.stubGlobal('indexedDB',undefined);
  await expect(listDeviceSpaces()).rejects.toThrow('could not save');vi.unstubAllGlobals();
});
