import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

// Elapsed time is isolated here: ticking must not rerender photos or overlays.
export default function OperationStatus({message,detail}:{message:string;detail?:string}) {
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{setElapsed(0);const start=Date.now();const timer=window.setInterval(()=>setElapsed(Math.floor((Date.now()-start)/1000)),1000);return()=>window.clearInterval(timer);},[message]);
  return <div className="operation-status">
    <div role="status" aria-live="polite"><LoaderCircle className="spin" size={18} aria-hidden="true"/><span>{message}</span></div>
    <small aria-hidden="true">{elapsed}s elapsed · {detail??(elapsed>=15?'Still waiting for a response. You can switch pages; no result is assumed.':'Your workspace stays available while this request runs.')}</small>
    <div className="operation-track" aria-hidden="true"><span/></div>
  </div>;
}
