import { request } from '../api';
import type { Mission, MissionIndex, Routine } from './types';

const send=<T,>(path:string,body:unknown,signal?:AbortSignal)=>request<T>(`missions${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal},130000);
export const listMissions=(signal?:AbortSignal)=>request<MissionIndex>('missions',{signal});
export const getMission=(id:string,signal?:AbortSignal)=>request<Mission>(`missions/${encodeURIComponent(id)}`,{signal});
export const getRoutine=(id:string,signal?:AbortSignal)=>request<Routine>(`missions/routines/${encodeURIComponent(id)}`,{signal});
export const importRoutine=(body:{name:string;goal:string;constraints:string;image_url:string;keep_preferences:string[]})=>send<Routine>('/routines/import',body);
export const createMission=(body:{id:string;goal:string;constraints:string;image_url:string;routine_id?:string},signal?:AbortSignal)=>send<Mission>('',body,signal);
export const observeMission=(value:Mission,image_url?:string,signal?:AbortSignal)=>send<Mission>(`/${encodeURIComponent(value.id)}/observe`,{revision:value.revision,image_url},signal);
export const planMission=(value:Mission,protected_ids:string[],feedback:string,signal?:AbortSignal)=>send<Mission>(`/${encodeURIComponent(value.id)}/plan`,{revision:value.revision,protected_ids,feedback},signal);
export const progressMission=(value:Mission,step_id:string,done:boolean,signal?:AbortSignal)=>send<Mission>(`/${encodeURIComponent(value.id)}/progress`,{revision:value.revision,step_id,done},signal);
export const checkMission=(value:Mission,image_url:string,signal?:AbortSignal)=>send<Mission>(`/${encodeURIComponent(value.id)}/check`,{revision:value.revision,image_url},signal);
export const saveRoutine=(value:Mission,name:string,signal?:AbortSignal)=>send<{routine:Routine;mission:Mission}>(`/${encodeURIComponent(value.id)}/routine`,{revision:value.revision,name,preferred_setup_confirmed:true},signal);
export const removeMission=(id:string,routine=false)=>request<{deleted:boolean}>(`missions/${routine?'routines/':''}${encodeURIComponent(id)}`,{method:'DELETE'});
