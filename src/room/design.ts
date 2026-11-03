import { startRoomJob } from './jobs';
import { request } from '../api';
import { FURNITURE_KINDS } from './layout';
import type { FurnitureItem, FurniturePlacement, ReservedZone, RoomSize } from './layout';
import { validFloorCorners } from './photoPlane';
import type { FloorPoint } from './photoPlane';

export interface RoomFeature {label:string;kind:'window'|'door'|'fixed'|'light';x:number;z:number;observation:string}
export interface RoomSurvey {
  status:'ready'|'needs_photo';summary:string;
  room:(RoomSize & {width_min:number;width_max:number;depth_min:number;depth_max:number})|null;
  floor_corners:FloorPoint[];evidence:string[];uncertainty:string;confidence:'low'|'medium';
  features:RoomFeature[];zones:ReservedZone[];ideas:string[];
  vertical_reference?:{corner:0|1;ceiling_y:number;height_m:number}|null;
}
export interface SurveyResponse extends RoomSurvey {image_url:string;image_width:number;image_height:number}
export type DesignStyle='balanced'|'open'|'focus';
export interface RoomDesign {title:string;summary:string;items:FurnitureItem[];placements:(FurniturePlacement & {reason:string})[];tradeoffs:string[]}

export function validDesign(value:unknown):value is RoomDesign {
  if(!value||typeof value!=='object')return false;
  const v=value as RoomDesign;
  return typeof v.title==='string'&&typeof v.summary==='string'&&Array.isArray(v.items)&&v.items.length<=12&&
    v.items.every(i=>i&&typeof i.id==='string'&&typeof i.label==='string'&&FURNITURE_KINDS.includes(i.kind)&&/^#[0-9a-f]{6}$/i.test(i.color)&&[i.width,i.depth,i.height].every(n=>Number.isFinite(n)&&n>0&&n<=30))&&
    new Set(v.items.map(i=>i.id)).size===v.items.length&&Array.isArray(v.placements)&&v.placements.length===v.items.length&&
    new Set(v.placements.map(p=>p?.itemId)).size===v.items.length&&v.placements.every(p=>p&&v.items.some(i=>i.id===p.itemId)&&[p.x,p.z].every(n=>Number.isFinite(n)&&n>=0&&n<=30)&&[0,90,180,270].includes(p.rotation)&&typeof p.reason==='string')&&
    Array.isArray(v.tradeoffs)&&v.tradeoffs.every(s=>typeof s==='string');
}

export async function surveyRoom(image_url:string,signal:AbortSignal,jobId?:string,onStatus?:(status:string)=>void):Promise<SurveyResponse>{
  const v=jobId?await startRoomJob<SurveyResponse>(jobId,{image_url},signal,onStatus):await request<SurveyResponse>('ai/room/survey',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_url}),signal},130000);
  return validateSurvey(v);
}
export function validateSurvey(v:SurveyResponse):SurveyResponse{
  if(!['ready','needs_photo'].includes(v.status)||typeof v.summary!=='string'||typeof v.uncertainty!=='string'||!['low','medium'].includes(v.confidence)||
    !Array.isArray(v.evidence)||!v.evidence.every(s=>typeof s==='string')||!Array.isArray(v.ideas)||!v.ideas.every(s=>typeof s==='string')||
    !Array.isArray(v.features)||!v.features.every(f=>f&&typeof f.label==='string'&&typeof f.observation==='string'&&['window','door','fixed','light'].includes(f.kind)&&[f.x,f.z].every(n=>Number.isFinite(n)&&n>=0&&n<=1))||
    !Array.isArray(v.zones)||v.zones.length>12||!/^data:image\/(jpeg|png|webp);base64,/.test(v.image_url)||![v.image_width,v.image_height].every(n=>Number.isFinite(n)&&n>0))throw new Error('The room analysis was incomplete. Try analyzing the photo again.');
  if(v.status==='ready'){
    const r=v.room;
    if(!r||![r.width,r.depth,r.width_min,r.width_max,r.depth_min,r.depth_max].every(n=>Number.isFinite(n)&&n>0&&n<=30)||
      !(r.width_min<r.width&&r.width<r.width_max&&r.depth_min<r.depth&&r.depth<r.depth_max)||!validFloorCorners(v.floor_corners)||
      new Set(v.zones.map(z=>z?.id)).size!==v.zones.length||v.zones.some(z=>!z||typeof z.id!=='string'||typeof z.label!=='string'||!['obstacle','access'].includes(z.kind)||![z.x,z.z,z.width,z.depth].every(Number.isFinite)||z.x<0||z.z<0||z.width<=0||z.depth<=0||z.x+z.width>r.width+1e-7||z.z+z.depth>r.depth+1e-7))throw new Error('The floor estimate could not be used. Try a wider room photo.');
    // The API represents unobserved height as null; the room renderer uses undefined.
    if(r.height==null)delete r.height;
    else if(!Number.isFinite(r.height)||r.height<=0||r.height>30)throw new Error('The room height estimate was invalid. Try again.');
    const anchor=v.vertical_reference;
    if(anchor&&(![0,1].includes(anchor.corner)||!Number.isFinite(anchor.ceiling_y)||anchor.ceiling_y<0||anchor.ceiling_y>=v.floor_corners[anchor.corner].y-.08||!Number.isFinite(anchor.height_m)||anchor.height_m<1.5||anchor.height_m>6))throw new Error('The wall estimate was invalid. Try another room photo.');
  }else if(v.room!==null||!Array.isArray(v.floor_corners)||v.floor_corners.length||v.zones.length||v.features.length)throw new Error('The room analysis was incomplete. Try a wider photo.');
  return v;
}
export async function designRoom(body:{image_url:string;goal:string;style:DesignStyle;room:RoomSize;zones:ReservedZone[];features:RoomFeature[];items:FurnitureItem[];placements?:FurniturePlacement[];gap:number},signal:AbortSignal,jobId?:string,onStatus?:(status:string)=>void):Promise<RoomDesign>{
  const value=jobId?await startRoomJob<RoomDesign>(jobId,body,signal,onStatus):await request<RoomDesign>('ai/room/design',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal},130000);
  if(!validDesign(value))throw new Error('The design response was incomplete. Your current arrangement is unchanged; try again.');
  return value;
}
