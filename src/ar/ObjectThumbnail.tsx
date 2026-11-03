import { useMemo } from 'react';
import { furnitureMeshes } from '../room/furnitureGeometry';
import type { FurnitureItem } from '../room/layout';

/** Catalog thumbnails use the same model geometry as the 3D and AR views. */
export default function ObjectThumbnail({item}:{item:FurnitureItem}) {
  const faces=useMemo(()=>{
    const layeredWall=['wall-art','wall-mirror','wall-clock','wall-tv'].includes(item.model??'');
    const project=(x:number,y:number,z:number)=>({x:(x-z)*.87,y:(x+z)*.36-y});
    const meshes=furnitureMeshes(item,{itemId:item.id,x:0,z:0,rotation:0});
    const all=meshes.flatMap(mesh=>Array.from({length:mesh.vertices.length/3},(_,i)=>project(...mesh.vertices.slice(i*3,i*3+3) as [number,number,number])));
    const left=Math.min(...all.map(p=>p.x)),right=Math.max(...all.map(p=>p.x)),top=Math.min(...all.map(p=>p.y)),bottom=Math.max(...all.map(p=>p.y));
    const scale=Math.min(92/Math.max(.01,right-left),77/Math.max(.01,bottom-top));
    return meshes.map(mesh=>{
      let d='';
      for(let i=0;i<mesh.vertices.length;i+=9){
        const points=[0,3,6].map(j=>project(mesh.vertices[i+j],mesh.vertices[i+j+1],mesh.vertices[i+j+2]));
        d+=points.map((p,j)=>`${j?'L':'M'}${(64+(p.x-(left+right)/2)*scale).toFixed(2)},${(52+(p.y-(top+bottom)/2)*scale).toFixed(2)}`).join('')+'Z';
      }
      // Thin mounted panels need their front layers painted after the backing.
      // Otherwise a broad backing face can cover a small inset artwork detail.
      const depth=mesh.vertices.reduce((sum,v,i)=>sum+(layeredWall?(i%3===2?v/item.depth:i%3===0?v/item.width*.04:v/item.height*.01):(i%3===1?v*.15:v)),0)/(mesh.vertices.length/3);
      return {d,color:`rgb(${mesh.color.slice(0,3).map(v=>Math.round(v*255)).join(',')})`,depth};
    }).sort((a,b)=>a.depth-b.depth);
  },[item.kind,item.model,item.width,item.depth,item.height,item.color,item.light?.enabled,item.light?.temperature,item.light?.brightness]);
  return <svg className="object-thumbnail" viewBox="0 0 128 104" aria-hidden="true" focusable="false"><ellipse cx="64" cy="90" rx="38" ry="5" fill="#183d2e08"/>{faces.map((face,i)=><path key={i} d={face.d} fill={face.color} stroke={face.color} strokeWidth=".3" strokeLinejoin="round"/>)}</svg>;
}
