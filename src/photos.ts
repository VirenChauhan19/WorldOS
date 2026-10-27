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
    return new File([blob],`workspace-${Date.now()}.${photo.format}`,{type:`image/${photo.format==='jpg'?'jpeg':photo.format}`});
  }catch(error){
    if(error instanceof Error&&/cancel/i.test(error.message))return null;
    throw new Error('Photo access is unavailable. Check camera/photo permissions in device settings, or choose another photo.');
  }
}

export async function normalizePhoto(file:File):Promise<File> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPEG, PNG, or WebP photo. For HEIC/RAW, export as JPEG or use Take photo.');
  if(file.size>30*1024*1024)throw new Error('Choose a photo under 30 MB.');
  const url=URL.createObjectURL(file);
  try {
    const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This photo could not be opened. Choose another image.'));image.src=url;});
    const factor=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
    if(factor===1&&file.size<=12*1024*1024)return file;
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*factor));canvas.height=Math.max(1,Math.round(img.naturalHeight*factor));
    const context=canvas.getContext('2d');if(!context)throw new Error('This browser cannot prepare the photo. Try a smaller JPEG.');
    context.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Photo conversion failed. Try a smaller JPEG.')),'image/jpeg',.9));
    return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
  }finally{URL.revokeObjectURL(url);}
}
