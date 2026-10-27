import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';

export default function Photo({src,alt,className='',...props}:ImgHTMLAttributes<HTMLImageElement>) {
  const ref=useRef<HTMLImageElement>(null);
  const [loaded,setLoaded]=useState<string>(),[failed,setFailed]=useState<string>();
  useEffect(()=>{
    const image=ref.current;let active=true;
    if(image?.complete&&image.naturalWidth){
      const ready=()=>{if(active)setLoaded(src);};
      if(image.decode)void image.decode().then(ready,ready);else ready();
    }
    return()=>{active=false;};
  },[src]);
  return <><img {...props} ref={ref} src={src} alt={alt} decoding="async" draggable={false}
    className={`decoded-photo ${loaded===src?'is-decoded':''} ${className}`}
    onLoad={()=>setLoaded(src)} onError={()=>setFailed(src)}/>
    {failed===src&&src&&<span className="photo-load-error" role="alert">This photo could not load. Reconnect or choose another photo.</span>}</>;
}
