// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { nativePhoto, normalizePhoto } from './photos';
vi.mock('@capacitor/camera',()=>({Camera:{getPhoto:vi.fn()},CameraSource:{Camera:'CAMERA',Photos:'PHOTOS'},CameraResultType:{Uri:'uri'}}));
beforeEach(()=>{vi.spyOn(Capacitor,'isNativePlatform').mockReturnValue(true);vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:photo'),revokeObjectURL:vi.fn()}));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it.each(['camera','library'] as const)('uses native %s and uploads only the returned photo',async source=>{
  vi.mocked(Camera.getPhoto).mockResolvedValue({webPath:'capacitor://localhost/local-photo',format:'jpeg',saved:false});
  const fetcher=vi.fn().mockResolvedValue(new Response(new Blob(['image'],{type:'image/jpeg'})));vi.stubGlobal('fetch',fetcher);
  const file=await nativePhoto(source);expect(file?.type).toBe('image/jpeg');
  expect(Camera.getPhoto).toHaveBeenCalledWith(expect.objectContaining({source:source==='camera'?'CAMERA':'PHOTOS',resultType:'uri',width:1800,correctOrientation:true,saveToGallery:false}));
  expect(fetcher).toHaveBeenCalledWith('capacitor://localhost/local-photo',{cache:'no-store',credentials:'omit'});
});
it('treats cancellation as no photo and permission denial as recoverable',async()=>{
  vi.mocked(Camera.getPhoto).mockRejectedValueOnce(new Error('User cancelled photos'));expect(await nativePhoto('library')).toBeNull();
  vi.mocked(Camera.getPhoto).mockRejectedValueOnce(new Error('permission denied'));await expect(nativePhoto('camera')).rejects.toThrow('device settings');
});
it('rejects RAW before decoding',async()=>{await expect(normalizePhoto(new File(['raw'],'photo.dng',{type:'image/dng'}))).rejects.toThrow('Export RAW');});
it('gives an actionable fallback when HEIC decoding is unavailable',async()=>{
  vi.stubGlobal('Image',class{onerror=()=>{};set src(_value:string){queueMicrotask(()=>this.onerror());}});
  await expect(normalizePhoto(new File(['heic'],'photo.heic',{type:'image/heic'}))).rejects.toThrow('export as JPEG');
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it('converts browser-decodable HEIC to a bounded JPEG and releases canvas memory',async()=>{
  vi.stubGlobal('Image',class{naturalWidth=3024;naturalHeight=4032;onload=()=>{};set src(_value:string){queueMicrotask(()=>this.onload());}});
  const draw=vi.fn();let canvas:HTMLCanvasElement|undefined;
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(this:HTMLCanvasElement){canvas=this;return {drawImage:draw} as unknown as CanvasRenderingContext2D;});
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(callback){callback(new Blob(['jpeg'],{type:'image/jpeg'}));});
  const result=await normalizePhoto(new File(['heic'],'phone.HEIC',{type:'image/heic'}));
  expect(result.type).toBe('image/jpeg');expect(result.name).toBe('phone.jpg');
  expect(draw).toHaveBeenCalledWith(expect.anything(),0,0,1350,1800);
  expect(canvas?.width).toBe(1);expect(canvas?.height).toBe(1);
});
it('keeps a small supported image and releases its local preview URL',async()=>{
  vi.stubGlobal('Image',class{naturalWidth=640;naturalHeight=480;onload=()=>{};set src(_value:string){queueMicrotask(()=>this.onload());}});
  const file=new File(['png'],'photo.png',{type:'image/png'});expect(await normalizePhoto(file)).toBe(file);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
});
it('resizes a phone image proportionally before upload',async()=>{
  vi.stubGlobal('Image',class{naturalWidth=4000;naturalHeight=3000;onload=()=>{};set src(_value:string){queueMicrotask(()=>this.onload());}});
  const draw=vi.fn();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:draw} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(callback){callback(new Blob(['jpeg'],{type:'image/jpeg'}));});
  const result=await normalizePhoto(new File(['photo'],'phone.png',{type:'image/png'}));expect(result.name).toBe('phone.jpg');
  expect(draw).toHaveBeenCalledWith(expect.anything(),0,0,1800,1350);expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it('reports corrupt images and releases preview URLs',async()=>{
  vi.stubGlobal('Image',class{onerror=()=>{};set src(_value:string){queueMicrotask(()=>this.onerror());}});
  await expect(normalizePhoto(new File(['bad'],'bad.png',{type:'image/png'}))).rejects.toThrow('could not be opened');expect(URL.revokeObjectURL).toHaveBeenCalled();
});
