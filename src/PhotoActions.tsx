import { useRef, useState } from 'react';
import { Camera, ImagePlus, LoaderCircle } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { nativePhoto, normalizePhoto } from './photos';

export default function PhotoActions({label,cameraLabel='Take photo',disabled,onPhoto}:{label:string;cameraLabel?:string;disabled:boolean;onPhoto:(file:File)=>Promise<void>}) {
  const camera=useRef<HTMLInputElement>(null),library=useRef<HTMLInputElement>(null);
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  async function receive(file:File|undefined,native=false){
    if(!file)return;setPending(true);setError('');
    try{await onPhoto(native?file:await normalizePhoto(file));}catch(e){setError(e instanceof Error?e.message:'Photo preparation failed.');}finally{setPending(false);}
  }
  async function choose(source:'camera'|'library'){
    setError('');
    if(!Capacitor.isNativePlatform()){(source==='camera'?camera:library).current?.click();return;}
    setPending(true);
    try{const file=await nativePhoto(source);if(file)await receive(file,true);}catch(e){setError((e as Error).message);}finally{setPending(false);}
  }
  return <div className="photo-actions">
    <button className="secondary" disabled={disabled||pending} onClick={()=>void choose('camera')}>{pending?<LoaderCircle size={16} className="spin"/>:<Camera size={16}/>} {cameraLabel}</button>
    <button className="secondary" disabled={disabled||pending} onClick={()=>void choose('library')}><ImagePlus size={16}/>{label}</button>
    <input className="hidden" aria-label={`${cameraLabel} camera input`} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" ref={camera} onChange={e=>{void receive(e.target.files?.[0]);e.target.value='';}}/>
    <input className="hidden" aria-label={`${label} library input`} type="file" accept="image/jpeg,image/png,image/webp" ref={library} onChange={e=>{void receive(e.target.files?.[0]);e.target.value='';}}/>
    {error&&<p className="photo-error" role="alert">{error}</p>}
  </div>;
}
