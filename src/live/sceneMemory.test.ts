import { expect,it } from 'vitest';
import type { AIAnalysis, SceneImage } from '../types';
import type { TrackingFrame } from './imageTracking';
import { describeView, matchViews, projectBox } from './viewMatching';
import { SceneMemory } from './sceneMemory';

function texture(seed=1,dx=0,dy=0,at=0):TrackingFrame {
  const width=128,height=96,pixels=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=x-dx,sy=y-dy;
    pixels[y*width+x]=((sx*7349 ^ sy*2939 ^ sx*sy*43 ^ seed*(sx*1327+sy*9869))>>>0)%256;
  }
  return {pixels,width,height,at};
}
const image=(name:string):SceneImage=>({image_url:`data:image/jpeg;base64,${name}`,width:768,height:576,name});
const analysis:AIAnalysis={objects:[{id:'live-0',label:'Keys',box:{x:.3,y:.3,width:.25,height:.25},locked:false}],concepts:['keys'],summary:'Keys on a desk.',details:{'live-0':'A key ring'},message:'',warnings:[],provider:'fixture',model:'fixture',live_request:false};

it('matches a previously seen view after a translation and rejects a different view',()=>{
  const features=describeView(texture());
  expect(features.points.length).toBeGreaterThan(15);
  const match=matchViews(features,describeView(texture(1,4,2,30000)));
  expect(match).not.toBeNull();
  expect(match!.tx).toBeCloseTo(4);expect(match!.ty).toBeCloseTo(2);
  expect(projectBox(analysis.objects[0].box,match!,128,96)?.x).toBeCloseTo(.3+4/128);
  expect(matchViews(features,describeView(texture(7)))).toBeNull();
});

it('remembers A and B and recovers A after looking away, beyond the short tracking TTL',()=>{
  const memory=new SceneMemory();
  const first=memory.remember(analysis,image('desk'),texture(),1000);
  const placeA=memory.snapshot().places[0].id;
  memory.remember({...analysis,objects:[{...analysis.objects[0],label:'Cup'}]},image('shelf'),texture(7),5000);
  expect(memory.snapshot().places).toHaveLength(2);
  expect(memory.snapshot().items).toHaveLength(2);
  expect(memory.observe(texture(11,0,0,9000))).toBeNull();
  const found=memory.observe(texture(1,4,2,60000));
  expect(found?.placeId).toBe(placeA);
  expect(found?.objects[0].id).toBe(first.objects[0].id);
  expect(found?.objects[0].box.x).toBeCloseTo(.3+4/128);
});

it('preserves IDs on a known view and keeps omitted items as last-seen observations',()=>{
  const memory=new SceneMemory();
  const first=memory.remember(analysis,image('desk'),texture(),1000);
  const next=memory.remember(analysis,image('desk2'),texture(),2000);
  expect(next.objects[0].id).toBe(first.objects[0].id);
  expect(memory.snapshot().items).toHaveLength(1);
  memory.remember({...analysis,objects:[]},image('empty'),texture(),3000);
  expect(memory.snapshot().places).toHaveLength(1);
  expect(memory.snapshot().items).toHaveLength(1);
  expect(memory.snapshot().items[0].capturedAt).toBe(2000);
  expect(memory.observe(texture())?.objects).toEqual([]);
  memory.track(texture(1,0,0,80));
  expect(memory.snapshot().location?.placeId).toBe(memory.snapshot().places[0].id);
});

it('never merges same-named objects in different areas',()=>{
  const memory=new SceneMemory();
  const a=memory.remember(analysis,image('one'),texture(),1000);
  const b=memory.remember(analysis,image('two'),texture(7),2000);
  expect(a.objects[0].id).not.toBe(b.objects[0].id);
});

it('finds an omitted item using its own older photo and reuses its identity if seen again',()=>{
  const memory=new SceneMemory();
  const first=memory.remember(analysis,image('keys-present'),texture(),1000);
  const id=first.objects[0].id;
  memory.remember({...analysis,objects:[]},image('later-shifted-view'),texture(1,4,2),2000);
  const found=memory.observe(texture(1,6,4,3000),id);
  expect(found?.objects).toEqual([]);
  expect(found?.target?.id).toBe(id);
  expect(found?.target?.box.x).toBeCloseTo(.3+6/128);
  expect(found?.target?.box.y).toBeCloseTo(.3+4/96);
  expect(memory.snapshot().items[0].frame.name).toBe('keys-present');
  memory.track(texture(1,8,6,3080));
  expect(memory.snapshot().location?.target?.box.x).toBeCloseTo(.3+8/128);
  const returned=memory.remember(analysis,image('keys-again'),texture(),4000);
  expect(returned.objects[0].id).toBe(id);
  expect(memory.snapshot().items).toHaveLength(1);
});

it('retains places after tracking loss, supports naming, and clears everything explicitly',()=>{
  const memory=new SceneMemory();
  memory.remember(analysis,image('one'),texture(),1000);
  const id=memory.snapshot().places[0].id;
  memory.rename(id,'Study desk');memory.observe(texture());memory.loseLocation();
  expect(memory.snapshot().location).toBeNull();
  expect(memory.snapshot().places[0].name).toBe('Study desk');
  memory.clear();
  expect(memory.snapshot()).toEqual({places:[],items:[],location:null,full:false});
});

it('keeps memory bounded and rejects featureless relocalization',()=>{
  const memory=new SceneMemory();
  for(let i=1;i<=20;i++)memory.remember(analysis,image(String(i)),texture(i),i);
  expect(memory.snapshot().places.length).toBeLessThanOrEqual(12);
  expect(memory.snapshot().items.length).toBeLessThanOrEqual(72);
  expect(memory.snapshot().full).toBe(true);
  expect(memory.observe({pixels:new Uint8Array(128*96),width:128,height:96,at:1})).toBeNull();
});
