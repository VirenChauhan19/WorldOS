import type { FurnitureItem, FurniturePlacement } from './layout';

export type SceneMesh = { vertices: number[]; color: [number, number, number, number] };
type Color = SceneMesh['color'];
type Point = [number, number, number];

export function material(hex: string, shade = 1): Color {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '81917a';
  return [0, 2, 4].map(index => Math.min(1, parseInt(value.slice(index, index + 2), 16) / 255 * shade)).concat(1) as Color;
}
const tint = (color: Color, factor: number): Color => [Math.min(1,color[0] * factor), Math.min(1,color[1] * factor), Math.min(1,color[2] * factor), color[3]];
function face(a: Point, b: Point, c: Point, d: Point, color: Color): SceneMesh {
  return { vertices: [...a, ...b, ...c, ...a, ...c, ...d], color };
}

/** Axis-aligned solid. Coordinates are in metres; face colors provide soft directional light. */
export function boxMeshes(x: number, y: number, z: number, width: number, height: number, depth: number, color: Color): SceneMesh[] {
  const X = x + width, Y = y + height, Z = z + depth;
  return [
    face([x,Y,z],[X,Y,z],[X,Y,Z],[x,Y,Z], tint(color,1)),
    face([x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z], tint(color,.83)),
    face([X,y,z],[X,y,Z],[X,Y,Z],[X,Y,z], tint(color,.72)),
    face([x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z], tint(color,.9)),
    face([x,y,z],[X,y,z],[X,Y,z],[x,Y,z], tint(color,.78)),
    face([x,y,z],[X,y,z],[X,y,Z],[x,y,Z], tint(color,.6)),
  ];
}

/** Rounded horizontal rectangle extruded vertically, used for soft furnishings. */
function rounded(x: number,y: number,z: number,w: number,h: number,d: number,r: number,color: Color): SceneMesh[] {
  r = Math.min(r,w/2,d/2);
  const outline: [number,number][] = [];
  for(const [cx,cz,start] of [[x+w-r,z+r,-Math.PI/2],[x+w-r,z+d-r,0],[x+r,z+d-r,Math.PI/2],[x+r,z+r,Math.PI]]) {
    for(let i=0;i<=4;i++){const angle=start+i*Math.PI/8;outline.push([cx+Math.cos(angle)*r,cz+Math.sin(angle)*r]);}
  }
  const meshes:SceneMesh[]=[];
  const top:SceneMesh={vertices:[],color},bottom:SceneMesh={vertices:[],color:tint(color,.6)};
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length];
    top.vertices.push(x+w/2,y+h,z+d/2,a[0],y+h,a[1],b[0],y+h,b[1]);
    bottom.vertices.push(x+w/2,y,z+d/2,b[0],y,b[1],a[0],y,a[1]);
    meshes.push(face([a[0],y,a[1]],[b[0],y,b[1]],[b[0],y+h,b[1]],[a[0],y+h,a[1]],tint(color,.78+.12*(Math.sin(i/outline.length*Math.PI*2)+1)/2)));
  }
  meshes.push(top,bottom);
  return meshes;
}

function cylinder(x:number,y:number,z:number,rx:number,rz:number,h:number,color:Color):SceneMesh[] {
  const meshes:SceneMesh[]=[],top:SceneMesh={vertices:[],color},bottom:SceneMesh={vertices:[],color:tint(color,.6)};
  for(let i=0;i<32;i++){
    const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
    const p:[number,number]=[x+Math.cos(a)*rx,z+Math.sin(a)*rz],q:[number,number]=[x+Math.cos(b)*rx,z+Math.sin(b)*rz];
    top.vertices.push(x,y+h,z,p[0],y+h,p[1],q[0],y+h,q[1]);
    bottom.vertices.push(x,y,z,q[0],y,q[1],p[0],y,p[1]);
    meshes.push(face([p[0],y,p[1]],[q[0],y,q[1]],[q[0],y+h,q[1]],[p[0],y+h,p[1]],tint(color,.74+.12*(Math.sin(a)+1)/2)));
  }
  meshes.push(top,bottom);return meshes;
}

/** Shared by the WebXR and room renderers. The oriented footprint starts at placement.x/z. */
export function furnitureMeshes(item: FurnitureItem, placement: FurniturePlacement): SceneMesh[] {
  if(![item.width,item.depth,item.height,placement.x,placement.z].every(Number.isFinite)||Math.min(item.width,item.depth,item.height)<=0||![0,90].includes(placement.rotation))return [];
  const w=item.width,d=item.depth,h=item.height,meshes:SceneMesh[]=[];
  const wood=material('#b69a77'),lightWood=material('#c8ae8a'),dark=material('#414a40'),fabric=material(item.color),cream=material('#eee9dc');
  const box=(x:number,y:number,z:number,width:number,height:number,depth:number,color:Color)=>meshes.push(...boxMeshes(x,y,z,width,height,depth,color));
  const soft=(x:number,y:number,z:number,width:number,height:number,depth:number,r:number,color:Color)=>meshes.push(...rounded(x,y,z,width,height,depth,r,color));
  if(item.kind==='bed'){
    // The entire model, including the headboard, stays within its declared dimensions.
    box(w*.035,h*.1,d*.025,w*.93,h*.23,d*.975,wood);
    for(const x of [w*.09,w*.85])for(const z of [d*.08,d*.86])box(x,0,z,w*.06,h*.16,d*.06,dark);
    box(0,h*.15,0,w,h*.85,d*.045,lightWood);
    soft(w*.025,h*.33,d*.06,w*.95,h*.21,d*.91,Math.min(w,d)*.045,cream);
    soft(w*.03,h*.54,d*.35,w*.94,h*.07,d*.60,Math.min(w,d)*.025,fabric);
    // Folded cuff and two pillows give the bed an immediately readable silhouette.
    soft(w*.035,h*.60,d*.35,w*.93,h*.025,d*.09,Math.min(w,d)*.012,tint(fabric,1.08));
    for(const x of [w*.08,w*.54])soft(x,h*.54,d*.105,w*.38,h*.075,d*.18,Math.min(w,d)*.035,material('#faf7ee'));
    box(w*.03,h*.49,d*.86,w*.94,h*.08,d*.075,tint(fabric,.78));
  } else if(item.kind==='desk'){
    box(0,h*.92,0,w,h*.08,d,fabric);
    const leg=Math.min(w,d)*.07;
    for(const x of [w*.065,w*.935-leg])for(const z of [d*.1,d*.9-leg])box(x,0,z,leg,h*.92,leg,dark);
    box(w*.07,h*.76,d*.075,w*.86,h*.10,d*.05,wood);
    box(w*.63,h*.68,d*.13,w*.28,h*.24,d*.73,wood);
    box(w*.66,h*.79,d*.875,w*.22,h*.015,d*.012,dark);
  } else if(item.kind==='table'){
    if(Math.max(w,d)/Math.min(w,d)<1.18){
      meshes.push(...cylinder(w/2,h*.91,d/2,w/2,d/2,h*.09,fabric));
      meshes.push(...cylinder(w/2,h*.09,d/2,w*.075,d*.075,h*.82,dark));
      meshes.push(...cylinder(w/2,0,d/2,w*.28,d*.28,h*.09,wood));
    }else{
      soft(0,h*.92,0,w,h*.08,d,Math.min(w,d)*.06,fabric);
      const leg=Math.min(w,d)*.07;
      for(const x of [w*.08,w*.92-leg])for(const z of [d*.12,d*.88-leg])box(x,0,z,leg,h*.92,leg,wood);
    }
  } else if(item.kind==='wardrobe'){
    box(w*.035,0,d*.04,w*.93,h*.04,d*.91,dark);
    box(0,h*.04,0,w,h*.96,d*.96,wood);
    const gap=w*.012;
    box(w*.025,h*.055,d*.96,w*.475-gap,h*.92,d*.025,fabric);
    box(w*.5+gap,h*.055,d*.96,w*.475-gap,h*.92,d*.025,tint(fabric,.96));
    box(w*.452,h*.43,d*.985,w*.013,h*.16,d*.015,material('#505343'));
    box(w*.535,h*.43,d*.985,w*.013,h*.16,d*.015,material('#505343'));
  } else if(item.kind==='chair'){
    const leg=Math.min(w,d)*.075;
    for(const x of [w*.10,w*.825])for(const z of [d*.12,d*.80])box(x,0,z,leg,h*.45,leg,wood);
    soft(0,h*.44,d*.04,w,h*.09,d*.96,Math.min(w,d)*.08,fabric);
    box(w*.08,h*.45,d*.04,w*.08,h*.55,d*.065,wood);
    box(w*.84,h*.45,d*.04,w*.08,h*.55,d*.065,wood);
    soft(0,h*.67,0,w,h*.30,d*.12,Math.min(w,d)*.04,fabric);
  }
  return meshes.map(mesh=>({color:mesh.color,vertices:mesh.vertices.map((value,index)=>{
    if(index%3===1)return value;
    const start=index-index%3,x=mesh.vertices[start],z=mesh.vertices[start+2];
    return index%3===0?placement.x+(placement.rotation===90?d-z:x):placement.z+(placement.rotation===90?x:z);
  })}));
}
