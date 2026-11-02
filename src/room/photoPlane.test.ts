import { expect, it } from 'vitest';
import { floorToPhoto, footprintPolygon, validFloorCorners } from './photoPlane';
const quad=[{x:.25,y:.2},{x:.75,y:.2},{x:.95,y:.9},{x:.05,y:.9}];
it('maps each measured corner and preserves straight floor lines under perspective',()=>{
  for(const [i,[u,v]] of [[0,0],[1,0],[1,1],[0,1]].entries()){
    const p=floorToPhoto(quad,u,v)!;expect(p.x).toBeCloseTo(quad[i].x);expect(p.y).toBeCloseTo(quad[i].y);
  }
  const a=floorToPhoto(quad,.2,.3)!,b=floorToPhoto(quad,.5,.3)!,c=floorToPhoto(quad,.8,.3)!;
  expect((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)).toBeCloseTo(0);
  expect(footprintPolygon(quad,{width:4,depth:3},{x:0,z:0,width:4,depth:3})?.split(' ')).toHaveLength(4);
});
it('rejects folded, degenerate, incomplete or nonfinite floor outlines',()=>{
  for(const points of [quad.slice(0,3),[quad[0],quad[2],quad[1],quad[3]],Array(4).fill({x:.5,y:.5}),[{x:NaN,y:.2},...quad.slice(1)]]){
    expect(validFloorCorners(points)).toBe(false);expect(floorToPhoto(points,.5,.5)).toBeNull();
  }
});
