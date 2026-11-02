import type { SceneObject } from '../types';

export type LocalDetection={boundingBox?:{originX:number;originY:number;width:number;height:number};categories:{categoryName:string;score:number}[]};
export type LocalResult={detections:LocalDetection[];latencyMs:number};
export type LocalDetectorStatus='off'|'loading'|'ready'|'unavailable';

/** One worker, one frame in flight. No inference runs on the UI thread. */
export class LocalDetector {
  private worker:Worker;
  private ready=false;
  private closed=false;
  private serial=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private pending:{id:number;resolve:(result:LocalResult)=>void;reject:(reason:Error)=>void}|null=null;
  constructor(private onStatus:(status:LocalDetectorStatus)=>void){
    this.worker=new Worker(new URL(`${import.meta.env.BASE_URL}vision-worker.js`,location.href));
    onStatus('loading');
    this.timer=setTimeout(()=>this.fail(),20000);
    this.worker.onerror=()=>this.fail();
    this.worker.onmessage=({data})=>{
      if(this.closed)return;
      if(data.type==='ready'){clearTimeout(this.timer);this.ready=true;this.onStatus('ready');}
      else if(data.type==='error')this.fail();
      else if(data.type==='result'&&this.pending&&this.pending.id===data.id){
        clearTimeout(this.timer);const request=this.pending;this.pending=null;
        request.resolve({detections:data.detections,latencyMs:data.latencyMs});
      }
    };
    this.worker.postMessage({type:'init'});
  }
  get available(){return this.ready&&!this.closed&&!this.pending;}
  detect(image:ImageBitmap,at:number):Promise<LocalResult>{
    if(!this.available){image.close();return Promise.reject(new Error('Fast labels are busy or unavailable.'));}
    return new Promise((resolve,reject)=>{
      const id=++this.serial;this.pending={id,resolve,reject};
      this.timer=setTimeout(()=>this.fail(),5000);
      try{this.worker.postMessage({type:'frame',id,image,at},[image]);}
      catch{image.close();this.fail();}
    });
  }
  private fail(){if(this.closed)return;this.close();this.onStatus('unavailable');}
  close(){
    if(this.closed)return;
    this.closed=true;this.ready=false;clearTimeout(this.timer);this.worker.terminate();
    this.pending?.reject(new Error('Fast labels stopped.'));this.pending=null;
  }
}

export function overlap(a:SceneObject,b:SceneObject){
  const x=Math.max(0,Math.min(a.box.x+a.box.width,b.box.x+b.box.width)-Math.max(a.box.x,b.box.x));
  const y=Math.max(0,Math.min(a.box.y+a.box.height,b.box.y+b.box.height)-Math.max(a.box.y,b.box.y));
  const intersection=x*y;
  return intersection/(a.box.width*a.box.height+b.box.width*b.box.height-intersection||1);
}

export function localObjects(result:LocalResult,width:number,height:number,previous:SceneObject[],nextId:()=>string):SceneObject[]{
  const used=new Set<string>();
  return result.detections.flatMap(detection=>{
    const box=detection.boundingBox,category=detection.categories[0];
    if(!box||!category||category.score<.55||!Number.isFinite(category.score)||!category.categoryName||![box.originX,box.originY,box.width,box.height].every(Number.isFinite))return [];
    const x=Math.max(0,box.originX/width),y=Math.max(0,box.originY/height);
    const right=Math.min(1,(box.originX+box.width)/width),bottom=Math.min(1,(box.originY+box.height)/height);
    if(right<=x||bottom<=y)return [];
    const label=category.categoryName[0].toUpperCase()+category.categoryName.slice(1);
    const object:SceneObject={id:'',label,box:{x,y,width:right-x,height:bottom-y},locked:false,source:'on_device',confidence:category.score};
    const candidates=previous.filter(old=>!used.has(old.id)&&old.label.toLowerCase()===label.toLowerCase()).map(old=>({old,score:overlap(old,object)})).sort((a,b)=>b.score-a.score);
    const best=candidates[0];
    object.id=best&&best.score>.35&&(!candidates[1]||best.score-candidates[1].score>.15)?best.old.id:nextId();
    used.add(object.id);return [object];
  }).slice(0,8);
}

// Local positions arrive first and remain authoritative for overlapping boxes.
export function mergeLiveObjects(local:SceneObject[],cloud:SceneObject[]):SceneObject[]{
  return [...local,...cloud.filter(object=>!local.some(fast=>fast.id===object.id||overlap(fast,object)>.5))].slice(0,12);
}
