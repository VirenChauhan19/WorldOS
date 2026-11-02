import { expect, it } from 'vitest';
import { buildPhotoScene, photoProjection, rasterizePhotoFaces } from './photoFurniture';
import type { PhotoFace } from './photoFurniture';
import { floorToPhoto } from './photoPlane';
import type { RoomReference } from './photoPlane';
import type { FurnitureItem } from './layout';

const reference:RoomReference={image_url:'',width:1600,height:1067,labels:[],corners:[{x:.216,y:.711},{x:.587,y:.623},{x:.992,y:.854},{x:.008,y:.914}]};
const room={width:4.2,depth:4.6};
const sofa:FurnitureItem={id:'sofa',kind:'sofa',label:'Compact sofa',width:1.8,depth:.8,height:.85,color:'#708769'};

it('keeps all floor anchors and intermediate positions registered to the photograph',()=>{
  const project=photoProjection(reference,room)!;
  for(const [u,v] of [[0,0],[1,0],[1,1],[0,1],[.25,.7],[.5,.5]]){
    const expected=floorToPhoto(reference.corners,u,v)!,actual=project(u*room.width,0,v*room.depth)!;
    expect(actual.x).toBeCloseTo(expected.x,9);expect(actual.y).toBeCloseTo(expected.y,9);
  }
});

it('uses a visible wall-height anchor so furniture height matches the photographed wall',()=>{
  const ref={...reference,survey:{vertical_reference:{corner:1 as const,ceiling_y:.2,height_m:2.7}}} as RoomReference;
  const project=photoProjection(ref,room)!;
  expect(project(room.width,2.7,0)!.y).toBeCloseTo(.2,9);
  expect(project(room.width,0,0)!.y).toBeCloseTo(reference.corners[1].y,9);
});

it('projects furniture height upward and keeps concepts finite on front and oblique floor estimates',()=>{
  for(const corners of [reference.corners,[{x:.2,y:.45},{x:.8,y:.45},{x:1,y:1},{x:0,y:1}]]){
    const ref={...reference,corners},project=photoProjection(ref,room)!;
    expect(project(2,1,2)!.y).toBeLessThan(project(2,0,2)!.y);
    for(const rotation of [0,90,180,270] as const){
      const scene=buildPhotoScene(ref,room,[sofa],[{itemId:'sofa',x:1,z:2,rotation}]);
      expect(scene.faces.length).toBeGreaterThan(20);expect(scene.shadows).toHaveLength(1);expect(scene.pins).toHaveLength(1);
      expect(scene.faces.every(f=>f.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.depth>0))).toBe(true);
      expect(scene.faces.every((f,i)=>i===0||scene.faces[i-1].depth>=f.depth)).toBe(true);
    }
  }
});

it('does not manufacture a scene from missing, crossed, or invalid geometry',()=>{
  for(const corners of [[],[reference.corners[0],reference.corners[2],reference.corners[1],reference.corners[3]]]){
    expect(photoProjection({...reference,corners},room)).toBeNull();
    expect(buildPhotoScene({...reference,corners},room,[sofa],[{itemId:'sofa',x:0,z:0,rotation:0}]).faces).toEqual([]);
  }
  expect(photoProjection(reference,{width:0,depth:5})).toBeNull();
  expect(photoProjection(reference,room)!(NaN,0,0)).toBeNull();
});

it('resolves intersecting surfaces per pixel regardless of drawing order',()=>{
  const near:PhotoFace={points:[{x:0,y:0,depth:1},{x:1,y:0,depth:4},{x:0,y:1,depth:1}],color:[255,0,0,255],depth:2};
  const flat:PhotoFace={points:[{x:0,y:0,depth:2},{x:1,y:0,depth:2},{x:0,y:1,depth:2}],color:[0,0,255,255],depth:2};
  const first=new Uint8ClampedArray(10*10*4),second=new Uint8ClampedArray(first.length);
  rasterizePhotoFaces(first,[near,flat],10,10);rasterizePhotoFaces(second,[flat,near],10,10);
  expect(first).toEqual(second);
  expect([...first.slice((1*10+1)*4,(1*10+1)*4+4)]).toEqual([255,0,0,255]);
  expect([...first.slice((0*10+8)*4,(0*10+8)*4+4)]).toEqual([0,0,255,255]);
});
