import { expect, it } from 'vitest';
import { ImageTracker, trackObjects, type TrackingFrame } from './imageTracking';
import type { SceneObject } from '../types';

const object: SceneObject = { id:'cup', label:'Cup', locked:false, box:{x:.25,y:.25,width:.4,height:.4} };
function frame(dx=0, dy=0, at=0, blank=false): TrackingFrame {
  const width=128, height=96, pixels=new Uint8Array(width*height);
  // Deterministic textured image, translated without changing its appearance.
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const sx=x-dx, sy=y-dy;
    pixels[y*width+x]=blank?0:((sx*7349 ^ sy*2939 ^ sx*sy*43)>>>0)%256;
  }
  return {pixels,width,height,at};
}
it('follows image translation without changing the model label or size',()=>{
  const result=trackObjects([object],frame(),frame(3,-2,80));
  expect(result).toHaveLength(1);
  expect(result[0].box.x).toBeCloseTo(.25+3/128);
  expect(result[0].box.y).toBeCloseTo(.25-2/96);
  expect(result[0].box.width).toBe(.4);
});
it('drops occluded objects, featureless images and long frame gaps',()=>{
  expect(trackObjects([object],frame(),frame(0,0,80,true))).toEqual([]);
  expect(trackObjects([object],frame(0,0,0,true),frame(0,0,80))).toEqual([]);
  expect(trackObjects([object],frame(),frame(0,0,500))).toEqual([]);
});
it('replays motion during an API call and never reattaches after tracking was lost',()=>{
  const tracker=new ImageTracker(), capture=frame();
  tracker.push(capture);
  tracker.push(frame(3,1,80)); tracker.push(frame(6,2,160));
  expect(tracker.seed([object],capture)[0].box.x).toBeCloseTo(.25+6/128);
  tracker.push(frame(0,0,240,true));
  tracker.push(frame(0,0,320));
  expect(tracker.seed([object],capture)).toEqual([]);
});
it('expires old detections and clears history on a new camera session',()=>{
  const tracker=new ImageTracker(), capture=frame();
  tracker.push(capture); tracker.seed([object],capture);
  expect(tracker.push(frame(0,0,8100))).toEqual([]);
  expect(tracker.seed([object],capture)).toEqual([]);
  tracker.clear();
  expect(tracker.seed([object],capture)).toEqual([]);
});
it('validates completed detections without replacing active tracks and rejects old unchanged captures',()=>{
  const tracker=new ImageTracker(1200),capture=frame();
  tracker.push(capture);tracker.seed([object],capture);
  tracker.push(frame(3,1,80));
  const other={...object,id:'new-cup'};
  expect(tracker.project([other],capture)[0].box.x).toBeCloseTo(.25+3/128);
  expect(tracker.push(frame(3,1,160))[0].id).toBe('cup');
  for(let at=240;at<=1280;at+=80)tracker.push(frame(3,1,at));
  expect(tracker.project([other],capture)).toEqual([]);
  expect(tracker.seed([other],capture)).toEqual([]);
});
