import { APIError, request } from '../api';
export interface RoomJob {id:string;stage:'survey'|'design';surveyId?:string}
interface JobResult<T> extends RoomJob {status:'queued'|'running'|'completed'|'failed'|'cancelled';result:T|null;error:string}
export class RoomJobFailure extends Error {constructor(message:string,public readonly result?:unknown){super(message);}}
export class RoomJobRejected extends APIError {}
function delay(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
  const cancel=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);
  if(signal.aborted){cancel();return;}signal.addEventListener('abort',cancel,{once:true});
});}
export async function watchRoomJob<T>(id:string,signal:AbortSignal,onStatus?:(status:string)=>void):Promise<T>{
  for(;;){
    let job:JobResult<T>;
    try{job=await request<JobResult<T>>(`ai/room/jobs/${encodeURIComponent(id)}`,{signal},15000);}
    catch(error){
      if(error instanceof APIError&&error.status===429){onStatus?.('waiting');await delay(Math.max(1200,error.retryAfterMs??60000),signal);continue;}
      if(error instanceof APIError&&[404,410].includes(error.status))throw new RoomJobFailure(error.message);
      throw error;
    }
    onStatus?.(job.status);
    if(job.id!==id||!['queued','running','completed','failed','cancelled'].includes(job.status))throw new RoomJobFailure('The saved request status was incomplete. Retry this stage.');
    if(job.status==='completed'){if(!job.result)throw new RoomJobFailure('The saved room result is incomplete. Retry this stage.');return job.result;}
    if(job.status==='failed'||job.status==='cancelled')throw new RoomJobFailure(job.error||'This room request stopped. Retry this stage.',job.result);
    await delay(1200,signal);
  }
}
export async function startRoomJob<T>(id:string,body:unknown,signal:AbortSignal,onStatus?:(status:string)=>void){
  try{await request('ai/room/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,request:body}),signal},30000);}
  catch(error){if(error instanceof APIError&&[400,401,403,404,409,413,422,429].includes(error.status))throw new RoomJobRejected(error.message,error.status,error.retryAfterMs,error.errorCode);throw error;}
  onStatus?.('queued');
  return watchRoomJob<T>(id,signal,onStatus);
}
export const cancelRoomJob=(id:string)=>request(`ai/room/jobs/${encodeURIComponent(id)}/cancel`,{method:'POST'},15000);
