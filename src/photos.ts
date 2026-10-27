import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export async function nativePhoto(source:'camera'|'library'):Promise<File|null> {
  if(!Capacitor.isNativePlatform())throw new Error('Use the browser photo controls.');
  try {
    const photo=await Camera.getPhoto({source:source==='camera'?CameraSource.Camera:CameraSource.Photos,resultType:CameraResultType.Uri,quality:90,width:1800,height:1800,correctOrientation:true,saveToGallery:false,allowEditing:false});
    if(!photo.webPath)throw new Error('unavailable');
    const response=await fetch(photo.webPath,{cache:'no-store',credentials:'omit'});
    if(!response.ok)throw new Error('unavailable');
    const blob=await response.blob();
    if(blob.size>12*1024*1024)throw new Error('too large');
    const file=new File([blob],`workspace-${Date.now()}.${photo.format}`,{type:`image/${photo.format==='jpg'?'jpeg':photo.format}`});
    return blob.size>6*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)?await normalizePhoto(file):file;
  }catch(error){
    if(error instanceof Error&&/cancel/i.test(error.message))return null;
    throw new Error('Photo access is unavailable. Check camera/photo permissions in device settings, or choose another photo.');
  }
}

export async function normalizePhoto(file:File):Promise<File> {
  const heic=['image/heic','image/heif'].includes(file.type)||(!file.type&&/\.hei[cf]$/i.test(file.name));
  const supported=['image/jpeg','image/png','image/webp'].includes(file.type);
  const unspecified=!file.type&&/\.(jpe?g|png|webp)$/i.test(file.name);
  if(!supported&&!heic&&!unspecified)throw new Error('Choose a JPEG, PNG, WebP, or HEIC photo. Export RAW photos as JPEG first.');
  if(file.size>30*1024*1024)throw new Error('Choose a photo under 30 MB.');
  const url=URL.createObjectURL(file);
  let canvas:HTMLCanvasElement|undefined;
  try {
    const img=await new Promise<HTMLImageElement>((resolve,reject)=>{
      const image=new Image();image.decoding='async';
      const timer=setTimeout(()=>reject(new Error('Photo preparation timed out. Try a smaller JPEG.')),30000);
      image.onload=()=>{clearTimeout(timer);resolve(image);};
      image.onerror=()=>{clearTimeout(timer);reject(new Error(heic?'This browser cannot open this HEIC photo. Open WorldOS in Safari 17 or later, export as JPEG, or use Take photo.':'This photo could not be opened. Choose another image.'));};image.src=url;
    });
    if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>60_000_000)throw new Error('Choose a photo up to 60 megapixels, or export a smaller JPEG.');
    const factor=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
    if(supported&&factor===1&&file.size<=6*1024*1024)return file;
    // Give pending feedback a rendering opportunity before the bounded canvas draw.
    await new Promise(resolve=>setTimeout(resolve,0));
    canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*factor));canvas.height=Math.max(1,Math.round(img.naturalHeight*factor));
    const context=canvas.getContext('2d');if(!context)throw new Error('This browser cannot prepare the photo. Try a smaller JPEG.');
    context.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas!.toBlob(value=>value?resolve(value):reject(new Error('Photo conversion failed. Try a smaller JPEG.')),'image/jpeg',.9));
    if(blob.type!=='image/jpeg'||blob.size>6*1024*1024)throw new Error('Prepared photo exceeds the supported upload size. Export a smaller JPEG.');
    return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
  }finally{if(canvas){canvas.width=1;canvas.height=1;}URL.revokeObjectURL(url);}
}
