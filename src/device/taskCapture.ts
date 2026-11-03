import type { SceneImage } from '../types';
import { readPhoto } from './store';
import { workspaceRecord, saveWorkspaceRecord, updateWorkspaceRecord } from './workspaceStore';

export interface TaskCapture {kind:'task-capture';id:string;sourceSetupId?:string;goal:string;constraints:string;photo:SceneImage|null;reference?:{name:string;image_url:string;steps:string[]};missionId?:string;routineId?:string;updatedAt:string}
export const getTaskCapture=async(sourceSetupId?:string)=>(await workspaceRecord<TaskCapture>(sourceSetupId?`reset-capture:${sourceSetupId}`:'task-capture'))??undefined;
export async function saveTaskCapture(capture:TaskCapture){
  if(capture.sourceSetupId)await saveWorkspaceRecord(`reset-capture:${capture.sourceSetupId}`,capture);
  await saveWorkspaceRecord('task-capture',capture);
}
export async function discardTaskCapture(capture:TaskCapture){
  const clear=(current:TaskCapture|null|undefined)=>current?.id===capture.id?null:current??null;
  if(capture.sourceSetupId)await updateWorkspaceRecord<TaskCapture|null>(`reset-capture:${capture.sourceSetupId}`,clear);
  await updateWorkspaceRecord<TaskCapture|null>('task-capture',clear);
}
export async function localTaskPhoto(file:File):Promise<SceneImage>{
  const image_url=await readPhoto(file),image=new Image();image.src=image_url;await image.decode();
  return {image_url,width:image.naturalWidth,height:image.naturalHeight,name:file.name};
}
