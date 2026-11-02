import type { Box } from '../types';
import type { TrackingFrame } from './imageTracking';

// Visual relocalization of captured views. A 2D similarity transform cannot
// establish world coordinates, depth, or whether a remembered object moved.
export type Feature = { x:number; y:number; bits:number[]; score:number };
export type ViewFeatures = { width:number; height:number; points:Feature[] };
export type ViewMatch = { a:number; b:number; tx:number; ty:number; inliers:number; score:number };
const pairs=Array.from({length:96},(_,i)=>{
  const n=(i+1)*2654435761>>>0;
  return [n%11-5,(n>>>7)%11-5,(n>>>14)%11-5,(n>>>21)%11-5];
});

export function describeView(frame:TrackingFrame):ViewFeatures {
  const {width,height,pixels}=frame, candidates:Feature[]=[];
  for(let y=7;y<height-7;y+=2)for(let x=7;x<width-7;x+=2){
    let xx=0,yy=0,xy=0;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const p=(y+dy)*width+x+dx;
      const gx=pixels[p+1]-pixels[p-1],gy=pixels[p+width]-pixels[p-width];
      xx+=gx*gx;yy+=gy*gy;xy+=gx*gy;
    }
    const score=(xx*yy-xy*xy)/(xx+yy+1);
    if(score>1800)candidates.push({x,y,score,bits:[]});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const points:Feature[]=[];
  for(const point of candidates){
    if(points.some(other=>Math.hypot(other.x-point.x,other.y-point.y)<6))continue;
    const bits=[0,0,0];
    pairs.forEach(([ax,ay,bx,by],index)=>{
      if(pixels[(point.y+ay)*width+point.x+ax]<pixels[(point.y+by)*width+point.x+bx])bits[index>>>5]|=1<<(index%32);
    });
    points.push({...point,bits});
    if(points.length>=100)break;
  }
  return {width,height,points};
}

function distance(a:Feature,b:Feature){
  let count=0;
  for(let i=0;i<3;i++){
    let n=(a.bits[i]^b.bits[i])>>>0;
    n=n-((n>>>1)&0x55555555);
    n=(n&0x33333333)+((n>>>2)&0x33333333);
    count+=((((n+(n>>>4))&0x0f0f0f0f)*0x01010101)>>>24);
  }
  return count;
}

export function matchViews(source:ViewFeatures,target:ViewFeatures):ViewMatch|null {
  if(source.width!==target.width||source.height!==target.height||Math.min(source.points.length,target.points.length)<10)return null;
  const matches:{from:Feature;to:Feature;error:number}[]=[];
  for(const from of source.points){
    let best=97,second=97,index=-1;
    target.points.forEach((to,i)=>{const error=distance(from,to);if(error<best){second=best;best=error;index=i;}else if(error<second)second=error;});
    if(index<0||best>22||best>=second*.75)continue;
    const to=target.points[index];
    if(source.points.some(other=>other!==from&&distance(other,to)<=best))continue;
    matches.push({from,to,error:best});
  }
  if(matches.length<10)return null;
  matches.sort((a,b)=>a.error-b.error);
  let best:ViewMatch|null=null;
  // Deterministic bounded RANSAC: exact descriptors rank first, avoiding an
  // unbounded randomized search on the camera's render loop.
  const seeds=matches.slice(0,22);
  for(let i=0;i<seeds.length;i++)for(let j=i+1;j<seeds.length;j++){
    const p=seeds[i],q=seeds[j],dx=q.from.x-p.from.x,dy=q.from.y-p.from.y;
    const length=dx*dx+dy*dy;
    if(length<200)continue;
    const ux=q.to.x-p.to.x,uy=q.to.y-p.to.y;
    const a=(dx*ux+dy*uy)/length,b=(dx*uy-dy*ux)/length;
    const scale=Math.hypot(a,b);
    if(scale<.75||scale>1.3||Math.abs(Math.atan2(b,a))>.3)continue;
    const tx=p.to.x-a*p.from.x+b*p.from.y,ty=p.to.y-b*p.from.x-a*p.from.y;
    const inliers=matches.filter(({from,to})=>Math.hypot(a*from.x-b*from.y+tx-to.x,b*from.x+a*from.y+ty-to.y)<=2.5);
    if(inliers.length<10||inliers.length/matches.length<.55)continue;
    const xs=inliers.map(v=>v.from.x),ys=inliers.map(v=>v.from.y);
    if(Math.max(...xs)-Math.min(...xs)<source.width*.28||Math.max(...ys)-Math.min(...ys)<source.height*.22)continue;
    const score=inliers.length/matches.length*Math.min(1,inliers.length/30);
    if(!best||score>best.score)best={a,b,tx,ty,inliers:inliers.length,score};
  }
  return best;
}

export function projectBox(box:Box,match:ViewMatch,width:number,height:number):Box|null {
  const corners=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]];
  const transformed=corners.map(([x,y])=>({x:(match.a*x*width-match.b*y*height+match.tx)/width,y:(match.b*x*width+match.a*y*height+match.ty)/height}));
  const x=Math.min(...transformed.map(p=>p.x)),y=Math.min(...transformed.map(p=>p.y));
  const right=Math.max(...transformed.map(p=>p.x)),bottom=Math.max(...transformed.map(p=>p.y));
  if(x<0||y<0||right>1||bottom>1)return null;
  return {x,y,width:right-x,height:bottom-y};
}
