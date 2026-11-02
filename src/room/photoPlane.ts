export interface FloorPoint {x:number;y:number}
export interface RoomReference {image_url:string;width:number;height:number;corners:FloorPoint[];labels:string[];survey?:import('./design').RoomSurvey}

/** A convex floor quadrilateral. Perspective alone does not establish metric scale. */
export function validFloorCorners(points:readonly FloorPoint[]):boolean {
  if(!Array.isArray(points)||points.length!==4||points.some(p=>!p||![p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1)))return false;
  const cross=points.map((p,i)=>{const q=points[(i+1)%4],r=points[(i+2)%4];return (q.x-p.x)*(r.y-q.y)-(q.y-p.y)*(r.x-q.x);});
  const area=Math.abs(points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%4].y-p.y*points[(i+1)%4].x,0))/2;
  return area>.015&&(cross.every(n=>n>1e-6)||cross.every(n=>n< -1e-6));
}

/** Project a normalized floor point through the planar perspective transform. */
export function floorToPhoto(points:readonly FloorPoint[],u:number,v:number):FloorPoint|null {
  if(!validFloorCorners(points)||![u,v].every(Number.isFinite))return null;
  const [p0,p1,p2,p3]=points;
  const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dy1=p1.y-p2.y,dy2=p3.y-p2.y;
  const sx=p0.x-p1.x+p2.x-p3.x,sy=p0.y-p1.y+p2.y-p3.y,den=dx1*dy2-dx2*dy1;
  if(Math.abs(den)<1e-9)return null;
  const g=(sx*dy2-dx2*sy)/den,h=(dx1*sy-sx*dy1)/den;
  const scale=g*u+h*v+1;if(Math.abs(scale)<1e-6)return null;
  return {x:((p1.x-p0.x+g*p1.x)*u+(p3.x-p0.x+h*p3.x)*v+p0.x)/scale,y:((p1.y-p0.y+g*p1.y)*u+(p3.y-p0.y+h*p3.y)*v+p0.y)/scale};
}
export function footprintPolygon(corners:readonly FloorPoint[],room:{width:number;depth:number},rect:{x:number;z:number;width:number;depth:number}):string|null {
  if(![room.width,room.depth].every(n=>Number.isFinite(n)&&n>0))return null;
  const values=[[rect.x,rect.z],[rect.x+rect.width,rect.z],[rect.x+rect.width,rect.z+rect.depth],[rect.x,rect.z+rect.depth]].map(([x,z])=>floorToPhoto(corners,x/room.width,z/room.depth));
  return values.some(p=>!p)?null:values.map(p=>`${p!.x*1000},${p!.y*1000}`).join(' ');
}
