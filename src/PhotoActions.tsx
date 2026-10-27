import { useRef, useState } from 'react';
import { Camera, ImagePlus, LoaderCircle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { nativePhoto, normalizePhoto } from './photos';

export default function PhotoActions({label,cameraLabel='Take photo',disabled,onPhoto}:{label:string;cameraLabel?:string;disabled:boolean;onPhoto:(file:File)=>Promise<void>}) {
  const camera=useRef<HTMLInputElement>(null),library=useRef<HTMLInputElement>(null);
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const lock=useRef(false);
  async function receive(file:File|undefined,native=false){
    if(!file||disabled||lock.current)return;lock.current=true;setPending(true);setError('');
    try{await onPhoto(native?file:await normalizePhoto(file));}catch(e){setError(e instanceof Error?e.message:'Photo preparation failed.');}finally{lock.current=false;setPending(false);}
  }
  async function choose(source:'camera'|'library'){
    if(disabled||lock.current)return;setError('');
    if(!Capacitor.isNativePlatform()){(source==='camera'?camera:library).current?.click();return;}
    lock.current=true;setPending(true);
    try{const file=await nativePhoto(source);if(file)await onPhoto(file);}catch(e){setError((e as Error).message);}finally{lock.current=false;setPending(false);}
  }
  return <div className="photo-actions">
    <button className="secondary" disabled={disabled||pending} onClick={()=>void choose('camera')}>{pending?<LoaderCircle size={16} className="spin"/>:<Camera size={16}/>} {cameraLabel}</button>
    <button className="secondary" disabled={disabled||pending} onClick={()=>void choose('library')}><ImagePlus size={16}/>{label}</button>
    <input className="hidden" aria-label={`${cameraLabel} camera input`} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" ref={camera} onChange={e=>{void receive(e.target.files?.[0]);e.target.value='';}}/>
    <input className="hidden" aria-label={`${label} library input`} type="file" accept="image/jpeg,image/png,image/webp" ref={library} onChange={e=>{void receive(e.target.files?.[0]);e.target.value='';}}/>
    {pending&&<span className="photo-pending" role="status">Preparing your photo…</span>}
    {error&&<p className="photo-error" role="alert">{error}</p>}
  </div>;
}
