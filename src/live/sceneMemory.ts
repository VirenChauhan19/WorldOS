import type { AIAnalysis, SceneImage, SceneObject } from '../types';
import { trackObjects, type TrackingFrame } from './imageTracking';
import { describeView, matchViews, projectBox } from './viewMatching';
import type { ViewFeatures, ViewMatch } from './viewMatching';

export type RememberedPlace={id:string;name:string;summary:string;frame:SceneImage;objects:SceneObject[];details:Record<string,string>;capturedAt:number;features:ViewFeatures};
export type MemoryLocation={placeId:string;objects:SceneObject[];target?:SceneObject|null;matchedAt:number;match:ViewMatch};
export type RememberedItem={object:SceneObject;placeId:string;frame:SceneImage;detail:string;capturedAt:number};
export type MemorySnapshot={places:RememberedPlace[];items:RememberedItem[];location:MemoryLocation|null;full:boolean};
const MAX_PLACES=12;
const iou=(a:SceneObject['box'],b:SceneObject['box'])=>{const intersection=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return intersection/(a.width*a.height+b.width*b.height-intersection);};

export class SceneMemory {
  private places:RememberedPlace[]=[];
  private location:MemoryLocation|null=null;
  private items:RememberedItem[]=[];
  private itemFeatures=new Map<string,ViewFeatures>();
  private serial=0;
  private previous:TrackingFrame|null=null;

  snapshot():MemorySnapshot{return {places:this.places,items:this.items,location:this.location,full:this.places.length>=MAX_PLACES||this.items.length>=72};}
  clear(){this.places=[];this.items=[];this.itemFeatures.clear();this.location=null;this.previous=null;}
  loseLocation(){this.location=null;this.previous=null;}
  rename(id:string,name:string){const clean=name.trim().slice(0,60);if(clean)this.places=this.places.map(place=>place.id===id?{...place,name:clean}:place);}
  private locate(features:ViewFeatures){
    const matches=this.places.flatMap(place=>{const match=matchViews(place.features,features);return match?[{place,match}]:[];}).sort((a,b)=>b.match.score-a.match.score);
    if(!matches.length)return null;
    // Similar-looking areas are not interchangeable. Ask for more context
    // rather than putting remembered labels into an ambiguous location.
    if(matches[1]&&matches[0].match.score-matches[1].match.score<.12)return null;
    return matches[0];
  }
  observe(frame:TrackingFrame,findingId:string|null=null):MemoryLocation|null {
    const features=describeView(frame),found=this.locate(features);
    let target:SceneObject|null=null;
    const item=this.items.find(value=>value.object.id===findingId);
    const reference=item&&this.itemFeatures.get(item.object.id);
    // A newer observation can omit an item. Finding it must use its own
    // last-seen frame, not the newer view's coordinates or a fresh detection.
    if(found&&item?.placeId===found.place.id&&reference){
      const match=reference===found.place.features?found.match:matchViews(reference,features);
      const box=match&&projectBox(item.object.box,match,frame.width,frame.height);
      if(box)target={...item.object,box};
    }
    this.location=found?{placeId:found.place.id,matchedAt:frame.at,match:found.match,target,objects:found.place.objects.flatMap(object=>{const box=projectBox(object.box,found.match,frame.width,frame.height);return box?[{...object,box}]:[];})}:null;
    this.previous=frame;
    return this.location;
  }
  track(frame:TrackingFrame){
    if(this.location&&this.previous&&(this.location.objects.length||this.location.target)){
      const objects=trackObjects(this.location.objects,this.previous,frame);
      const target=this.location.target?trackObjects([this.location.target],this.previous,frame)[0]??null:null;
      this.location=objects.length||target?{...this.location,objects,target}:null;
    }
    this.previous=frame;
  }
  remember(analysis:AIAnalysis,frame:SceneImage,captured:TrackingFrame,capturedAt:number):AIAnalysis {
    const features=describeView(captured),found=this.locate(features);
    if(!found&&!analysis.objects.length)return analysis;
    if(!found&&this.places.length>=MAX_PLACES)return analysis;
    const id=found?.place.id??`place-${++this.serial}`;
    const used=new Set<string>();
    const transforms=new Map<ViewFeatures,ViewMatch|null>();
    if(found)transforms.set(found.place.features,found.match);
    const objects=analysis.objects.map(object=>{
      const candidates=this.items.filter(item=>found&&item.placeId===id&&!used.has(item.object.id)&&item.object.label.toLowerCase()===object.label.toLowerCase()).flatMap(item=>{
        const old=item.object,reference=this.itemFeatures.get(old.id);
        if(!reference)return [];
        if(!transforms.has(reference))transforms.set(reference,matchViews(reference,features));
        const transform=transforms.get(reference);
        const projected=transform&&projectBox(old.box,transform,captured.width,captured.height);
        return projected?[{old,score:iou(projected,object.box)}]:[];
      }).sort((a,b)=>b.score-a.score);
      const match=candidates[0];
      // Never merge two same-named objects merely because their labels agree.
      const stableId=match&&match.score>.3&&(!candidates[1]||match.score-candidates[1].score>.15)?match.old.id:`${id}-item-${++this.serial}`;
      used.add(stableId);return {...object,id:stableId};
    });
    const details=Object.fromEntries(objects.map((object,i)=>[object.id,analysis.details?.[analysis.objects[i].id]??'']));
    const place:RememberedPlace={id,name:found?.place.name??`View ${this.places.length+1}`,summary:analysis.summary,frame,objects,details,capturedAt,features};
    // Replace this area's latest observation; don't label omitted objects
    // as moved or gone. Other areas remain remembered when out of view.
    this.places=found?this.places.map(old=>old.id===id?place:old):[...this.places,place];
    for(const object of objects){
      const item:RememberedItem={object,placeId:id,frame,detail:details[object.id],capturedAt};
      const index=this.items.findIndex(old=>old.object.id===object.id);
      if(index>=0){this.items=this.items.map((old,i)=>i===index?item:old);this.itemFeatures.set(object.id,features);}
      else if(this.items.length<72){this.items=[...this.items,item];this.itemFeatures.set(object.id,features);}
    }
    return {...analysis,objects,details};
  }
}
