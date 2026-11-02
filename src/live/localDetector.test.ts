// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {LocalDetector,localObjects,mergeLiveObjects} from './localDetector';
import type {LocalResult} from './localDetector';
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
