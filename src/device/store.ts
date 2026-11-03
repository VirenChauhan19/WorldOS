import type { RoomReference } from '../room/photoPlane';

export interface DeviceSpace {
  id: string;
  revision?: number;
  name: string;
  notes: string;
  photo: string;
  after: string;
  steps: { id: string; text: string; done: boolean }[];
  updatedAt: string;
}

const failure = 'This device could not save your work. Browser storage may be full or unavailable. Export a backup before leaving.';
export class DeviceSpaceConflict extends Error {
  constructor(){super('This setup changed in another tab. Your changes need a separate recovered setup.');}
}
export class DeviceSpaceDeleted extends Error {constructor(){super('This setup was removed from My Spaces. Create a new setup to continue.');}}
type StoredSetup=DeviceSpace|{id:string;deleted:true};

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error(failure)); return; }
    let blocked=false;
    const request = indexedDB.open('worldos-device', 2);
    request.onupgradeneeded = () => { if(!request.result.objectStoreNames.contains('spaces'))request.result.createObjectStore('spaces', { keyPath: 'id' });if(!request.result.objectStoreNames.contains('room'))request.result.createObjectStore('room'); };
    request.onerror = () => reject(new Error(failure));
    request.onblocked = () => { blocked=true; reject(new Error('Close other WorldOS tabs, then try again.')); };
    request.onsuccess = () => { if(blocked){request.result.close();return;} request.result.onversionchange=()=>request.result.close();resolve(request.result); };
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>, storeName='spaces'): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let request:IDBRequest<T>;
    try{request=operation(tx.objectStore(storeName));}catch{tx.abort();db.close();reject(new Error(failure));return;}
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(new Error(failure)); };
    tx.onerror = () => { db.close(); reject(new Error(failure)); };
  });
}

const setupWrites=new Map<string,Promise<unknown>>();
function announceSetupChange(){if(typeof window!=='undefined'){window.dispatchEvent(new Event('worldos:device-saved'));if(typeof window.BroadcastChannel==='function'){const channel=new BroadcastChannel('worldos-rooms');channel.postMessage('changed');channel.close();}}}
export const listDeviceSpaces = async (): Promise<DeviceSpace[]> => { await Promise.allSettled([...setupWrites.values()]);return (await transaction<StoredSetup[]>('readonly', s => s.getAll())).filter((space):space is DeviceSpace=>!('deleted' in space)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); };
export const getDeviceSpace = async(id: string) => {await setupWrites.get(id)?.catch(()=>{});const space=await transaction<StoredSetup|undefined>('readonly', s => s.get(id));return space&&!('deleted' in space)?space:undefined;};
export function saveDeviceSpace(space:DeviceSpace):Promise<IDBValidKey>{
  const snapshot=structuredClone(space);
  const operation=(setupWrites.get(space.id)??Promise.resolve()).catch(()=>{}).then(async()=>{
    const db=await database();
    return new Promise<IDBValidKey>((resolve,reject)=>{
      const tx=db.transaction('spaces','readwrite'),store=tx.objectStore('spaces'),read=store.get(snapshot.id);
      let reason:unknown;
      read.onsuccess=()=>{try{
        if(read.result?.deleted)throw new DeviceSpaceDeleted();
        if((read.result?.revision??0)!==(snapshot.revision??0))throw new DeviceSpaceConflict();
        snapshot.revision=(snapshot.revision??0)+1;store.put(snapshot);
      }catch(error){reason=error;tx.abort();}};
      tx.oncomplete=()=>{db.close();space.revision=snapshot.revision;resolve(snapshot.id);};
      tx.onabort=tx.onerror=()=>{db.close();reject(reason instanceof DeviceSpaceConflict||reason instanceof DeviceSpaceDeleted?reason:new Error(failure));};
    });
  });
  setupWrites.set(space.id,operation);
  void operation.then(()=>{if(setupWrites.get(space.id)===operation)setupWrites.delete(space.id);announceSetupChange();},()=>{if(setupWrites.get(space.id)===operation)setupWrites.delete(space.id);});
  return operation;
}
export function deleteDeviceSpace(id:string):Promise<void>{
  const operation=(setupWrites.get(id)??Promise.resolve()).catch(()=>{}).then(async()=>{await transaction('readwrite',store=>store.put({id,deleted:true}));});
  setupWrites.set(id,operation);
  void operation.then(()=>{if(setupWrites.get(id)===operation)setupWrites.delete(id);announceSetupChange();},()=>{if(setupWrites.get(id)===operation)setupWrites.delete(id);});
  return operation;
}
export const loadRoomReference=()=>transaction<RoomReference|undefined>('readonly',s=>s.get('reference'),'room');
export const saveRoomReference=(value:RoomReference|null)=>value?transaction('readwrite',s=>s.put(value,'reference'),'room'):transaction('readwrite',s=>s.delete('reference'),'room');

export function readPhoto(file: File): Promise<string> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 6*1024*1024) return Promise.reject(new Error('Choose a JPEG, PNG, or WebP photo under 6 MB.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('This photo could not be opened. Try another photo.'));
    reader.readAsDataURL(file);
  });
}

/** Imported text is rendered as text; image values cannot reference remote URLs or SVG. */
export function parseDeviceBackup(input: unknown): DeviceSpace {
  const value = input as { format?: string; space?: DeviceSpace } | null;
  const s = value?.space;
  const image = (v: unknown) => typeof v === 'string' && v.length <= 9*1024*1024 && (v === '' || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v));
  if (value?.format !== 'worldos-device-space-v1' || !s || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 120 || typeof s.notes !== 'string' || s.notes.length > 4000 || !image(s.photo) || !image(s.after) || !Array.isArray(s.steps) || s.steps.length > 30 || s.steps.some(step => !step || typeof step.text !== 'string' || !step.text.trim() || step.text.length > 500 || typeof step.done !== 'boolean')) {
    throw new Error('Choose a valid WorldOS device setup backup.');
  }
  // Imports always get new identities, so restoring never overwrites existing work.
  return { id: crypto.randomUUID(), name: s.name.trim(), notes: s.notes, photo: s.photo, after: s.after, steps: s.steps.map(step => ({id:crypto.randomUUID(),text:step.text,done:step.done})), updatedAt: new Date().toISOString() };
}
