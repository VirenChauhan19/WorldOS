/** Device-owned projects and pending captures. Never contains server credentials. */
export async function workspaceRecord<T>(key:string):Promise<T|undefined> {
  return operate('readonly',store=>store.get(key));
}
export async function saveWorkspaceRecord<T>(key:string,value:T):Promise<void> {
  await operate('readwrite',store=>store.put(value,key));
}
export async function removeWorkspaceRecord(key:string):Promise<void> {
  await operate('readwrite',store=>store.delete(key));
}
export async function workspaceRecords<T>():Promise<T[]> {
  return operate('readonly',store=>store.getAll());
}
/** Read, compare and replace in one transaction, including across browser tabs. */
export function updateWorkspaceRecord<T>(key:string,update:(current:T|undefined)=>T):Promise<T>{
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Device storage is unavailable. Enable site storage to keep your work.'));return;}
    const opening=indexedDB.open('worldos-projects',1);let blocked=false;
    opening.onupgradeneeded=()=>opening.result.createObjectStore('records');
    opening.onerror=()=>reject(new Error('Device storage is unavailable. Export your work before leaving.'));
    opening.onblocked=()=>{blocked=true;reject(new Error('Close other WorldOS tabs and try again.'));};
    opening.onsuccess=()=>{
      const db=opening.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();
      const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');let value:T,reason:unknown;
      const read=store.get(key);
      read.onsuccess=()=>{try{value=update(read.result);store.put(value,key);}catch(error){reason=error;tx.abort();}};
      tx.oncomplete=()=>{db.close();resolve(value);};
      tx.onabort=tx.onerror=()=>{db.close();reject(reason??new Error('Device storage is full or unavailable. Export your work and try again.'));};
    };
  });
}
function operate<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Device storage is unavailable. Enable site storage to keep your work.'));return;}
    const opening=indexedDB.open('worldos-projects',1);let blocked=false;
    opening.onupgradeneeded=()=>opening.result.createObjectStore('records');
    opening.onerror=()=>reject(new Error('Your work could not be saved on this device. Export a backup before leaving.'));
    opening.onblocked=()=>{blocked=true;reject(new Error('Close other WorldOS tabs and try again.'));};
    opening.onsuccess=()=>{
      const db=opening.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();
      const tx=db.transaction('records',mode);let request:IDBRequest<T>;
      try{request=action(tx.objectStore('records'));}catch(error){tx.abort();db.close();reject(error);return;}
      tx.oncomplete=()=>{db.close();resolve(request.result);};
      tx.onabort=tx.onerror=()=>{db.close();reject(new Error('Device storage is full or unavailable. Export your work and try again.'));};
    };
  });
}
