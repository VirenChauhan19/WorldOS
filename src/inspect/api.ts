import type { Alignment, AlignedImage, InspectionRecord, InspectionReview, TemplateSummary, WorkspaceTemplate, EvaluationTrial, EvaluationSummary, EvaluationReport } from './types';
import { apiFetch, requestScope } from '../backend';

const pending = new Map<string,Promise<unknown>>();
async function perform<T>(path:string, method='GET', body?:unknown):Promise<T> {
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),135000);
  try {
    const response=await apiFetch(`inspect/${path}`,{method,signal:controller.signal,...(body !== undefined ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
    const data=await response.json().catch(()=>{throw new Error('Inspect returned unreadable data. Retry or reload the workspace.');});
    if(!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : Array.isArray(data.detail) ? data.detail.map((d:{msg:string})=>d.msg).join('; ') : `Inspect request failed (${response.status}).`);
    if(!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Inspect returned an invalid response. Reload the workspace.');
    return data as T;
  } catch(error) {
    if(error instanceof DOMException && error.name==='AbortError') throw new Error('Inspection timed out. Retry explicitly, narrow the concepts, or review annotations manually.');
    if(error instanceof TypeError) throw new Error('Cannot reach WorldOS Inspect. Check your connection and backend address, then retry.');
    throw error;
  } finally {window.clearTimeout(timeout);}
}
function request<T>(path:string,method='GET',body?:unknown):Promise<T> {
  const key=JSON.stringify([requestScope(),path,method,body]);
  const existing=pending.get(key);
  if(existing) return existing as Promise<T>;
  const operation=perform<T>(path,method,body); pending.set(key,operation);
  const clear=()=>{pending.delete(key);}; void operation.then(clear,clear); return operation;
}
export const listTemplates=()=>request<{templates:TemplateSummary[]}>('templates');
export const getTemplate=(id:string)=>request<WorkspaceTemplate>(`templates/${encodeURIComponent(id)}`);
export const saveTemplate=(body:unknown,id?:string)=>request<WorkspaceTemplate>(id ? `templates/${encodeURIComponent(id)}` : 'templates',id?'PUT':'POST',body);
export const deleteTemplate=(id:string)=>request<{deleted:boolean}>(`templates/${encodeURIComponent(id)}`,'DELETE');
export const templateHistory=(id:string)=>request<{inspections:{id:string;revision:number;created_at:string}[]}>(`templates/${encodeURIComponent(id)}/history`);
export const getInspection=(id:string)=>request<InspectionRecord>(`scans/${encodeURIComponent(id)}`);
export const alignPhoto=(template_id:string,image_url:string,alignment:Alignment,automatic=false,previous_inspection_id:string|null=null,evaluation_trial_id:string|null=null)=>request<Omit<Partial<AlignedImage>,'alignment'> & {status?:string;message?:string;fit?:{matches:number;inliers:number;rms_error_pixels_at_900:number};alignment:Alignment|null}>('alignment','POST',{template_id,image_url,alignment,automatic,previous_inspection_id,evaluation_trial_id});
export const scanWorkspace=(body:unknown)=>request<InspectionRecord>('scans','POST',body);
export const manualScan=(body:unknown)=>request<InspectionRecord>('manual-scans','POST',body);
export const reviewInspection=(id:string,body:InspectionReview)=>request<InspectionRecord>(`scans/${encodeURIComponent(id)}/review`,'POST',body);
export const planCorrections=(id:string,revision:number)=>request<InspectionRecord>(`scans/${encodeURIComponent(id)}/corrections`,'POST',{revision});
export const explainInspection=(id:string,revision:number)=>request<InspectionRecord>(`scans/${encodeURIComponent(id)}/explain`,'POST',{revision});
export const inspectionReport=(id:string)=>request<Record<string,unknown>>(`scans/${encodeURIComponent(id)}/report`);
export const listEvaluationTrials=(id:string)=>request<{trials:EvaluationSummary[];scenarios:string[]}>(`evaluation/trials?template_id=${encodeURIComponent(id)}`);
export const getEvaluationTrial=(id:string)=>request<EvaluationTrial>(`evaluation/trials/${encodeURIComponent(id)}`);
export const createEvaluationTrial=(body:unknown)=>request<EvaluationTrial>('evaluation/trials','POST',body);
export const saveEvaluationCapture=(id:string,body:unknown)=>request<EvaluationTrial>(`evaluation/trials/${encodeURIComponent(id)}/captures`,'POST',body);
export const evaluationReport=()=>request<EvaluationReport>('evaluation/report');
export const exportEvaluationTrial=(id:string)=>request<Record<string,unknown>>(`evaluation/trials/${encodeURIComponent(id)}/export`);
export const listDrafts=()=>request<{drafts:import('../simple/types').DraftSummary[]}>('drafts');
export const getDraft=(id:string)=>request<import('../simple/types').SavedDraft>(`drafts/${encodeURIComponent(id)}`);
export const saveDraft=(id:string,revision:number,state:import('../simple/types').WizardState)=>request<{id:string;revision:number;updated_at:string}>(`drafts/${encodeURIComponent(id)}`,'PUT',{revision,state});
export const deleteDraft=(id:string)=>request<{deleted:boolean}>(`drafts/${encodeURIComponent(id)}`,'DELETE');
