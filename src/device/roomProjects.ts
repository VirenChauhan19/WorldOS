import { validateSurvey } from '../room/design';
import { loadRoomDraft, parseRoomDraft } from './roomDraft';
import type { RoomDraft } from './roomDraft';
import { loadRoomReference } from './store';
import type { RoomReference } from '../room/photoPlane';
import { updateWorkspaceRecord, workspaceRecord, workspaceRecords } from './workspaceStore';

export interface RoomSnapshot {id:string;name:string;createdAt:string;draft:RoomDraft;reference:RoomReference|null}
export interface RoomProject {kind:'room-project';id:string;revision?:number;archived?:boolean;name:string;updatedAt:string;draft:RoomDraft;reference:RoomReference|null;versions:RoomSnapshot[]}
export class RoomConflict extends Error {constructor(){super('This room changed in another tab. Keep your changes in a separate room.');}}
export const emptyRoom=():RoomDraft=>({roomFields:{width:'',depth:'',height:''},source:'unmeasured',items:[],gap:'0.3',manual:null,zones:[],reviewed:false,design:null,goal:''});
const writes=new Map<string,Promise<RoomProject>>();
function announce(){
  window.dispatchEvent(new Event('worldos:device-saved'));
  if(typeof window.BroadcastChannel==='function'){const channel=new BroadcastChannel('worldos-rooms');channel.postMessage('changed');channel.close();}
}
export async function listRoomProjects(){await Promise.allSettled([...writes.values()]);return (await workspaceRecords<RoomProject>()).filter(p=>p?.kind==='room-project').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
export async function getRoomProject(id:string){await writes.get(id);return workspaceRecord<RoomProject>(`room:${id}`);}
export function saveRoomProject(project:RoomProject){
  const snapshot=structuredClone(project);
  const pending=(writes.get(project.id)??Promise.resolve()).catch(()=>{}).then(()=>updateWorkspaceRecord<RoomProject>(`room:${project.id}`,current=>{
    if((current?.revision??0)!==(snapshot.revision??0))throw new RoomConflict();
    return {...snapshot,revision:(snapshot.revision??0)+1};
  })).then(saved=>{project.revision=saved.revision;return saved;});
  writes.set(project.id,pending);
  void pending.then(()=>{if(writes.get(project.id)===pending)writes.delete(project.id);announce();},()=>{if(writes.get(project.id)===pending)writes.delete(project.id);});
  return pending;
}
export async function recoverRoomProject(project:RoomProject){
  const recovered:RoomProject={...structuredClone(project),id:crypto.randomUUID(),revision:0,name:`Recovered: ${project.name}`.slice(0,80),updatedAt:new Date().toISOString(),draft:{...structuredClone(project.draft),roomJob:undefined,designQueued:false}};
  return saveRoomProject(recovered);
}
export async function newRoomProject(name='Untitled room',from?:RoomProject){
  const project:RoomProject={kind:'room-project',id:crypto.randomUUID(),name:name.trim().slice(0,80)||'Untitled room',updatedAt:new Date().toISOString(),draft:from?{...structuredClone(from.draft),roomJob:undefined,designQueued:false}:emptyRoom(),reference:from?structuredClone(from.reference):null,versions:[]};
  await saveRoomProject(project);return project;
}
export function snapshotRoom(project:RoomProject,name:string):RoomProject {
  if(project.draft.roomJob)throw new Error('Wait for the room request to finish or cancel it before saving an alternative.');
  if(project.versions.length>=12)throw new Error('This room has 12 saved alternatives. Duplicate the room to explore more.');
  const version:RoomSnapshot={id:crypto.randomUUID(),name:name.trim().slice(0,80)||`Layout ${project.versions.length+1}`,createdAt:new Date().toISOString(),draft:structuredClone(project.draft),reference:structuredClone(project.reference)};
  return {...project,versions:[...project.versions,version],updatedAt:version.createdAt};
}
export function parseRoomProjectBackup(value:unknown):RoomProject{
  const input=value as {format?:string;project?:RoomProject};
  const project=input?.project;
  if(input?.format!=='worldos-room-project-v1'||!project||typeof project.name!=='string'||project.name.length>80||!Array.isArray(project.versions)||project.versions.length>12)throw new Error('Choose a valid WorldOS room backup.');
  const capture=(draft:unknown,reference:RoomReference|null)=>{
    const parsed=parseRoomDraft(draft);if(!parsed)throw new Error('This backup contains an invalid room layout.');
    if(reference&&(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(reference.image_url)||reference.image_url.length>9*1024*1024||![reference.width,reference.height].every(n=>Number.isFinite(n)&&n>0&&n<=1800)||!Array.isArray(reference.corners)||reference.corners.length>4||reference.corners.some(p=>!p||![p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))||!Array.isArray(reference.labels)||reference.labels.some(label=>typeof label!=='string'||label.length>100)))throw new Error('This backup contains an invalid room photo.');
    // Restoring a backup never reconnects to a previous private server request.
    if(reference?.survey)validateSurvey({...reference.survey,image_url:reference.image_url,image_width:reference.width,image_height:reference.height});
    return {draft:{...parsed,roomJob:undefined,designQueued:false},reference:reference?{image_url:reference.image_url,width:reference.width,height:reference.height,corners:reference.corners,labels:reference.labels,survey:reference.survey}:null};
  };
  return {kind:'room-project',id:crypto.randomUUID(),name:project.name.trim()||'Restored room',updatedAt:new Date().toISOString(),...capture(project.draft,project.reference),versions:project.versions.map(version=>{
    if(!version||typeof version.name!=='string'||version.name.length>80)throw new Error('This backup contains an invalid layout name.');
    return {id:crypto.randomUUID(),name:version.name,createdAt:new Date().toISOString(),...capture(version.draft,version.reference)};
  })};
}
export function restoreRoom(project:RoomProject,id:string):RoomProject {
  const version=project.versions.find(v=>v.id===id);if(!version)throw new Error('This layout is no longer available.');
  const preserved=snapshotRoom(project,'Before restoring '+version.name);
  return {...preserved,draft:structuredClone(version.draft),reference:structuredClone(version.reference)};
}
export async function initialRoomProject(){
  const projects=await listRoomProjects();
  const selected=localStorage.getItem('worldos.active-room');
  const available=projects.filter(p=>!p.archived);
  if(available.length)return available.find(p=>p.id===selected)??available[0];
  if(projects.length)return newRoomProject();
  const draft=loadRoomDraft(),reference=await loadRoomReference();
  const project=await newRoomProject(draft||reference?'My room':'Untitled room');
  if(draft||reference){project.draft=draft??emptyRoom();project.reference=reference??null;await saveRoomProject(project);}
  return project;
}
