// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {LOCAL_LABEL_HOLD_MS,LocalDetector,LocalObjectStabilizer,localObjects,mergeLiveObjects} from './localDetector';
import type {LocalResult} from './localDetector';
import type {SceneObject} from '../types';
const detection:LocalResult={latencyMs:42,detections:[{boundingBox:{originX:20,originY:30,width:40,height:50},categories:[{categoryName:'cup',score:.9}]}]};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

it('normalizes real detector coordinates, rejects invalid outputs, and keeps spatial identities separate',()=>{
  let serial=0;const id=()=>`device-${++serial}`;
  const first=localObjects(detection,200,100,[],id);
  expect(first[0].box).toMatchObject({x:.1,y:.3,height:.5});
  expect(first[0].box.width).toBeCloseTo(.2);
  expect(first[0].source).toBe('on_device');
  expect(localObjects(detection,200,100,first,id)[0].id).toBe(first[0].id);
  const two=localObjects({...detection,detections:[...detection.detections,{boundingBox:{originX:140,originY:30,width:40,height:50},categories:[{categoryName:'cup',score:.8}]}]},200,100,first,id);
  expect(new Set(two.map(object=>object.id)).size).toBe(2);
  expect(localObjects({...detection,detections:[{...detection.detections[0],categories:[{categoryName:'cup',score:.3}]}]},200,100,[],id)).toEqual([]);
  expect(localObjects({...detection,detections:[{...detection.detections[0],boundingBox:{originX:NaN,originY:0,width:20,height:20}}]},200,100,[],id)).toEqual([]);
});

it('keeps fast positions when a slower cloud box overlaps while preserving other cloud objects',()=>{
  const local=localObjects(detection,200,100,[],()=> 'local-cup');
  const remote={...local[0],id:'cloud-cup',source:'muse_spark' as const};
  const other={...remote,id:'cloud-book',label:'Book',box:{x:.7,y:.2,width:.1,height:.1}};
  expect(mergeLiveObjects(local,[remote,other])).toEqual([...local,other]);
});

function detections(label='laptop',score=.8,x=20):LocalResult{
  return {latencyMs:40,detections:[{boundingBox:{originX:x,originY:20,width:80,height:50},categories:[{categoryName:label,score}]}]};
}
function recognition(){
  const evidence=new LocalObjectStabilizer();let serial=0,at=0;
  return {evidence,observe(result:LocalResult,elapsed=160){
    at+=elapsed;const tracked=evidence.trackingObjects;
    return evidence.observe(localObjects(result,200,100,tracked,()=>`track-${++serial}`),tracked,at);
  },get at(){return at;}};
}

it('requires repeated class evidence before admitting even a strong one-frame detection',()=>{
  const {observe,evidence}=recognition();
  expect(observe(detections('laptop',.99))).toEqual([]);
  expect(evidence.stabilizing).toBe(true);
  expect(observe(detections('book',.9))).toEqual([]);
  const admitted=observe(detections('book',.8));
  expect(admitted).toHaveLength(1);expect(admitted[0].label).toBe('Book');
  expect(admitted[0].confidence).toBeCloseTo(.85);expect(evidence.stabilizing).toBe(false);
});

it('keeps the same label and identity through alternating laptop/book outputs and brief misses',()=>{
  const {observe}=recognition();observe(detections());const [first]=observe(detections());
  for(let i=0;i<8;i++){
    const [current]=observe(detections(i%2?'laptop':'book',i%2?.8:.99));
    expect(current.id).toBe(first.id);expect(current.label).toBe('Laptop');
    expect(current.confidence).toBeCloseTo(.8);
  }
  expect(observe({latencyMs:40,detections:[]})[0]).toEqual(first);
  expect(observe(detections())[0].id).toBe(first.id);
});

it('changes an established label after three consecutive observations without changing physical identity',()=>{
  const {observe}=recognition();observe(detections());const [first]=observe(detections());
  expect(observe(detections('book',.6))[0].label).toBe('Laptop');
  expect(observe(detections('book',.65))[0].label).toBe('Laptop');
  const [changed]=observe(detections('book',.7));
  expect(changed.id).toBe(first.id);expect(changed.label).toBe('Book');
  expect(changed.confidence).toBeCloseTo(.65);
});

it('removes an old label when continuing conflicting classes provide no support for it',()=>{
  const {observe,evidence}=recognition();observe(detections());observe(detections());
  for(let i=0;i<4;i++)expect(observe(detections(i%2?'cell phone':'book'))[0].label).toBe('Laptop');
  expect(observe(detections('book'))).toEqual([]);
  expect(evidence.stabilizing).toBe(true);
});

it('expires unsupported labels and removes lost image tracks immediately, including tentative evidence',()=>{
  const run=recognition();run.observe(detections());const [first]=run.observe(detections());
  expect(run.evidence.sync([first],run.at+LOCAL_LABEL_HOLD_MS)).toHaveLength(1);
  expect(run.evidence.sync([first],run.at+LOCAL_LABEL_HOLD_MS+1)).toEqual([]);
  expect(run.evidence.sync([],run.at+LOCAL_LABEL_HOLD_MS+2)).toEqual([]);
  expect(run.evidence.trackingObjects).toEqual([]);
  expect(run.observe(detections())).toEqual([]);
  run.evidence.sync([],run.at+1);
  expect(run.observe(detections())).toEqual([]);
});

it('smooths small detector box jitter and never counts an inference from a stale frame',()=>{
  const run=recognition();run.observe(detections());const [first]=run.observe(detections());
  const [shifted]=run.observe(detections('laptop',.8,24));
  expect(shifted.id).toBe(first.id);expect(shifted.box.x).toBeGreaterThan(first.box.x);
  expect(shifted.box.x).toBeLessThan(.12);
  const evidence=new LocalObjectStabilizer();
  evidence.observe([first],[],0,1300);
  expect(evidence.trackingObjects).toEqual([]);
});

it('uses spatial identity across class changes but refuses ambiguous neighbouring or crossing boxes',()=>{
  const previous=localObjects(detections(),200,100,[],()=> 'laptop');
  expect(localObjects(detections('book'),200,100,previous,()=> 'new')[0].id).toBe('laptop');
  const neighbour:SceneObject={...previous[0],id:'neighbour',box:{...previous[0].box,x:.5}};
  let serial=0;
  const crossing={latencyMs:40,detections:[{boundingBox:{originX:60,originY:20,width:80,height:50},categories:[{categoryName:'laptop',score:.9}]}]};
  const [ambiguous]=localObjects(crossing,200,100,[previous[0],neighbour],()=>`new-${++serial}`);
  expect(ambiguous.id).toBe('new-1');
  const double=localObjects({...detections(),detections:[...detections().detections,...detections('book').detections]},200,100,previous,()=>`new-${++serial}`);
  expect(new Set(double.map(object=>object.id)).size).toBe(2);
  expect(double.every(object=>object.id!=='laptop')).toBe(true);
});

class FakeWorker{
  static latest:FakeWorker;
  onmessage:((event:{data:unknown})=>void)|null=null;
  onerror:(()=>void)|null=null;
  postMessage=vi.fn();terminate=vi.fn();
  constructor(){FakeWorker.latest=this;}
  send(data:unknown){this.onmessage?.({data});}
}
const bitmap=()=>({close:vi.fn()} as unknown as ImageBitmap);

it('warms before accepting frames, allows one in-flight inference, and rejects late work on close',async()=>{
  vi.stubGlobal('Worker',FakeWorker);const status=vi.fn(),detector=new LocalDetector(status),worker=FakeWorker.latest;
  expect(detector.available).toBe(false);worker.send({type:'ready'});expect(detector.available).toBe(true);
  const first=detector.detect(bitmap(),100);
  expect(detector.available).toBe(false);
  const dropped=bitmap();await expect(detector.detect(dropped,200)).rejects.toThrow('busy');expect(dropped.close).toHaveBeenCalledOnce();
  worker.send({type:'result',id:1,...detection});await expect(first).resolves.toEqual(detection);
  const pending=detector.detect(bitmap(),300);const rejected=expect(pending).rejects.toThrow('stopped');detector.close();await rejected;
  worker.send({type:'ready'});expect(detector.available).toBe(false);expect(worker.terminate).toHaveBeenCalledOnce();
});

it('fails an unresponsive worker without leaving inference locked',async()=>{
  vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);const status=vi.fn(),detector=new LocalDetector(status);
  FakeWorker.latest.send({type:'ready'});
  const pending=detector.detect(bitmap(),100);const rejected=expect(pending).rejects.toThrow('stopped');
  await vi.advanceTimersByTimeAsync(5000);await rejected;
  expect(status).toHaveBeenLastCalledWith('unavailable');expect(detector.available).toBe(false);
});
