import { furnitureMeshes } from './furnitureGeometry';
import { orientedSize } from './layout';
import type { FurnitureItem, FurniturePlacement, RoomSize } from './layout';
import { validFloorCorners } from './photoPlane';
import type { RoomReference } from './photoPlane';

type Vec=[number,number,number];
export interface PhotoVertex {x:number;y:number;depth:number}
export interface PhotoFace {points:PhotoVertex[];color:[number,number,number,number];depth:number}
export interface PhotoScene {faces:PhotoFace[];shadows:PhotoVertex[][];pins:{id:string;label:string;number:number;point:PhotoVertex}[]}
/** Extend the estimated floor into an upright concept camera. A photo-derived
 * quadrilateral is generally not a calibrated metric homography. Recovering a
 * free camera normal from it can badly lean/stretch vertical furniture. Keep
 * verticals upright and infer their scale from the two horizontal floor axes.
 * This intentionally assumes an upright image, and is an illustrative preview.
 */
export function photoProjection(reference:Pick<RoomReference,'corners'|'width'|'height'|'survey'>,room:RoomSize){
  if(!validFloorCorners(reference.corners)||![reference.width,reference.height,room.width,room.depth].every(n=>Number.isFinite(n)&&n>0))return null;
  const [p0,p1,p2,p3]=reference.corners,W=reference.width,H=reference.height;
  const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dy1=p1.y-p2.y,dy2=p3.y-p2.y;
  const sx=p0.x-p1.x+p2.x-p3.x,sy=p0.y-p1.y+p2.y-p3.y,den=dx1*dy2-dx2*dy1;
  if(Math.abs(den)<1e-9)return null;
  const g=(sx*dy2-dx2*sy)/den,h=(dx1*sy-sx*dy1)/den;
  const a:Vec=[(p1.x-p0.x+g*p1.x)*W/room.width,(p1.y-p0.y+g*p1.y)*H/room.width,g/room.width];
  const b:Vec=[(p3.x-p0.x+h*p3.x)*W/room.depth,(p3.y-p0.y+h*p3.y)*H/room.depth,h/room.depth];
  const t:Vec=[p0.x*W,p0.y*H,1],cx=W/2;
  let verticalScale=Math.hypot(a[0]-cx*a[2],b[0]-cx*b[2]);
  const anchor=reference.survey?.vertical_reference;
  if(anchor){
    const at=reference.corners[anchor.corner],cornerDepth=anchor.corner===0?1:g+1;
    const anchored=(at.y-anchor.ceiling_y)*H*cornerDepth/anchor.height_m;
    // Inferred corners can disagree with an inferred ceiling junction. Reject a
    // grossly stretched vertical extension instead of drawing tower-like furniture.
    if(Number.isFinite(anchored)&&anchored>0&&anchored<=verticalScale*1.6)verticalScale=anchored;
  }
  if(!Number.isFinite(verticalScale)||verticalScale<1e-6)return null;
  const up:Vec=[0,-verticalScale,0];
  return (x:number,y:number,z:number):PhotoVertex|null=>{
    if(![x,y,z].every(Number.isFinite))return null;
    const depth=a[2]*x+up[2]*y+b[2]*z+t[2];
    if(depth<.025)return null;
    const px=(a[0]*x+up[0]*y+b[0]*z+t[0])/depth/W,py=(a[1]*x+up[1]*y+b[1]*z+t[1])/depth/H;
    return Number.isFinite(px)&&Number.isFinite(py)?{x:px,y:py,depth}:null;
  };
}

export function buildPhotoScene(reference:RoomReference,room:RoomSize,items:readonly FurnitureItem[],placements:readonly FurniturePlacement[]):PhotoScene{
  const result:PhotoScene={faces:[],shadows:[],pins:[]},project=photoProjection(reference,room);
  if(!project)return result;
  for(const placement of placements){
    const item=items.find(i=>i.id===placement.itemId);if(!item)continue;
    const size=orientedSize(item,placement.rotation),x=placement.x,z=placement.z;
    const shadow=[[x,z],[x+size.width,z],[x+size.width,z+size.depth],[x,z+size.depth]].map(([xx,zz])=>project(xx,0,zz));
    if(shadow.every(p=>p))result.shadows.push(shadow as PhotoVertex[]);
    for(const mesh of furnitureMeshes(item,placement)){
      const color=mesh.color.map(c=>Math.round(c*255)) as PhotoFace['color'];
      for(let i=0;i<mesh.vertices.length;i+=9){
        const points=[0,3,6].map(offset=>project(mesh.vertices[i+offset],mesh.vertices[i+offset+1],mesh.vertices[i+offset+2]));
        if(points.some(p=>!p))continue;
        const tri=points as PhotoVertex[];
        if(tri.every(p=>p.x<0)||tri.every(p=>p.x>1)||tri.every(p=>p.y<0)||tri.every(p=>p.y>1))continue;
        result.faces.push({points:tri,color,depth:tri.reduce((sum,p)=>sum+p.depth,0)/3});
      }
    }
    const point=project(x+size.width/2,item.height,z+size.depth/2);
    if(point&&point.x>.02&&point.x<.98&&point.y>.04&&point.y<.96)result.pins.push({id:item.id,label:item.label,number:items.indexOf(item)+1,point});
  }
  result.faces.sort((a,b)=>b.depth-a.depth);
  return result;
}

export function drawPhotoScene(context:CanvasRenderingContext2D,scene:PhotoScene,width:number,height:number){
  const path=(points:PhotoVertex[])=>{context.beginPath();points.forEach((p,i)=>{if(i)context.lineTo(p.x*width,p.y*height);else context.moveTo(p.x*width,p.y*height);});context.closePath();};
  context.save();context.fillStyle='rgba(30,25,19,.2)';context.shadowColor='rgba(25,23,18,.3)';context.shadowBlur=width*.009;
  for(const points of scene.shadows){path(points);context.fill();}
  context.restore();
  if(!scene.faces.length)return;
  const frame=context.getImageData(0,0,width,height);
  rasterizePhotoFaces(frame.data,scene.faces,width,height);
  context.putImageData(frame,0,0);
}

/** Per-pixel depth prevents long furniture faces from covering closer surfaces.
 * Interpolate reciprocal camera depth for correct perspective visibility.
 */
export function rasterizePhotoFaces(pixels:Uint8ClampedArray,faces:readonly PhotoFace[],width:number,height:number){
  const depth=new Float32Array(width*height);
  for(const face of faces){
    const [a,b,c]=face.points.map(p=>({x:p.x*width,y:p.y*height,z:1/p.depth}));
    const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(Math.abs(den)<1e-8)continue;
    const left=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),right=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x)));
    const top=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),bottom=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
      const u=((b.y-c.y)*(x+.5-c.x)+(c.x-b.x)*(y+.5-c.y))/den;
      const v=((c.y-a.y)*(x+.5-c.x)+(a.x-c.x)*(y+.5-c.y))/den,w=1-u-v;
      if(u< -1e-7||v< -1e-7||w< -1e-7)continue;
      const inverse=u*a.z+v*b.z+w*c.z,index=y*width+x;
      if(inverse<=depth[index]+1e-5)continue;
      depth[index]=inverse;const offset=index*4;
      pixels[offset]=face.color[0];pixels[offset+1]=face.color[1];pixels[offset+2]=face.color[2];pixels[offset+3]=face.color[3];
    }
  }
}
