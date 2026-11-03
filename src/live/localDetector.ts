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
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return [];
  const objects:SceneObject[]=result.detections.flatMap(detection=>{
    const box=detection.boundingBox,category=detection.categories[0];
    if(!box||!category||category.score<.55||category.score>1||!Number.isFinite(category.score)||typeof category.categoryName!=='string'||!category.categoryName.trim()||![box.originX,box.originY,box.width,box.height].every(Number.isFinite))return [];
    const x=Math.max(0,box.originX/width),y=Math.max(0,box.originY/height);
    const right=Math.min(1,(box.originX+box.width)/width),bottom=Math.min(1,(box.originY+box.height)/height);
    if(right<=x||bottom<=y)return [];
    const name=category.categoryName.trim(),label=name[0].toUpperCase()+name.slice(1);
    const object:SceneObject={id:'',label,box:{x,y,width:right-x,height:bottom-y},locked:false,source:'on_device',confidence:category.score};
    return [object];
  }).slice(0,8);
  const scores=objects.map(object=>previous.map(old=>overlap(old,object)));
  return objects.map((object,index)=>{
    // Associate the physical box before deciding its class. A model changing
    // Laptop to Book must not discard the evidence for the same visible item.
    // Require a mutual, unambiguous match so neighbouring objects cannot steal
    // each other's identities when their boxes overlap or cross.
    const candidates=previous.map((old,i)=>({old,i,score:scores[index][i]})).sort((a,b)=>b.score-a.score);
    const best=candidates[0];
    const competitors=best?scores.map((row,i)=>({i,score:row[best.i]})).sort((a,b)=>b.score-a.score):[];
    object.id=best&&best.score>.35&&(!candidates[1]||best.score-candidates[1].score>.15)&&competitors[0].i===index&&(!competitors[1]||best.score-competitors[1].score>.15)?best.old.id:nextId();
    return object;
  });
}

// Detector confidence describes one frame, not temporal certainty. Confirm
// repeated evidence without increasing the reported model score. A short hold
// bridges detector misses only while ImageTracker still sees the same surface.
export const LOCAL_LABEL_HOLD_MS=700;
const LOCAL_EVIDENCE_TTL_MS=1200;
type LabelTrack={object:SceneObject;confirmed:boolean;candidate:string;hits:number;lastSeen:number;supportedAt:number;scores:number[];candidateScores:number[]};
export class LocalObjectStabilizer {
  private tracks=new Map<string,LabelTrack>();
  private at=0;

  clear(){this.tracks.clear();}
  get trackingObjects(){return [...this.tracks.values()].map(track=>track.object);}
  get stabilizing(){return [...this.tracks.values()].some(track=>!track.confirmed||track.hits>0||this.at-track.supportedAt>LOCAL_LABEL_HOLD_MS);}
  private visible(){return [...this.tracks.values()].filter(track=>track.confirmed&&this.at-track.supportedAt<=LOCAL_LABEL_HOLD_MS).map(track=>track.object);}

  sync(tracked:SceneObject[],at:number):SceneObject[]{
    this.at=at;
    const survivors=new Map(tracked.map(object=>[object.id,object]));
    for(const [id,track] of this.tracks){
      const current=survivors.get(id);
      if(!current||at-track.lastSeen>LOCAL_EVIDENCE_TTL_MS)this.tracks.delete(id);
      else track.object={...track.object,box:current.box};
    }
    return this.visible();
  }

  observe(detections:SceneObject[],tracked:SceneObject[],capturedAt:number,at=capturedAt):SceneObject[]{
    this.sync(tracked,at);
    if(at-capturedAt>LOCAL_EVIDENCE_TTL_MS)return this.visible();
    const seen=new Set(detections.map(object=>object.id));
    for(const [id,track] of this.tracks){
      if(!seen.has(id)){
        track.hits=0;track.candidate='';
        // Ambiguous association is not evidence that an old object remains
        // underneath a new one. Reconfirm crossed or merged detections.
        if(detections.some(object=>overlap(track.object,object)>.35))this.tracks.delete(id);
      }
    }
    for(const detection of detections){
      const label=detection.label.toLowerCase(),score=detection.confidence??0;
      let track=this.tracks.get(detection.id);
      if(!track){
        track={object:detection,confirmed:false,candidate:label,hits:1,lastSeen:capturedAt,supportedAt:-Infinity,scores:[],candidateScores:[score]};
        this.tracks.set(detection.id,track);continue;
      }
      const old=track.object,box=overlap(old,detection)>.65?{
        x:old.box.x*.55+detection.box.x*.45,y:old.box.y*.55+detection.box.y*.45,
        width:old.box.width*.55+detection.box.width*.45,height:old.box.height*.55+detection.box.height*.45,
      }:detection.box;
      track.object={...old,box};track.lastSeen=capturedAt;
      if(track.confirmed&&label===old.label.toLowerCase()){
        track.candidate='';track.hits=0;track.supportedAt=capturedAt;
        track.scores=[...track.scores,score].slice(-5);
        track.object.confidence=track.scores.reduce((sum,value)=>sum+value,0)/track.scores.length;
      }else{
        if(track.candidate===label){track.hits++;track.candidateScores=[...track.candidateScores,score].slice(-5);}
        else{track.candidate=label;track.hits=1;track.candidateScores=[score];}
        if(track.hits>=(track.confirmed?3:2)){
          track.scores=track.candidateScores;
          track.object={...track.object,label:detection.label,confidence:track.scores.reduce((sum,value)=>sum+value,0)/track.scores.length};
          track.confirmed=true;track.supportedAt=capturedAt;track.candidate='';track.hits=0;
        }
      }
    }
    return this.visible();
  }
}

// Local positions arrive first and remain authoritative for overlapping boxes.
export function mergeLiveObjects(local:SceneObject[],cloud:SceneObject[]):SceneObject[]{
  return [...local,...cloud.filter(object=>!local.some(fast=>fast.id===object.id||overlap(fast,object)>.5))].slice(0,12);
}
