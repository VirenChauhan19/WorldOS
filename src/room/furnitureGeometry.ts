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
    for(let i=0;i<=8;i++){
      const angle=start+i*Math.PI/16,point:[number,number]=[cx+Math.cos(angle)*r,cz+Math.sin(angle)*r];
      const previous=outline[outline.length-1];
      // A capsule has no straight edge between two semicircles. Keep one seam
      // vertex so its closed mesh has no zero-area side or cap triangles.
      if(!previous||Math.hypot(point[0]-previous[0],point[1]-previous[1])>1e-12)outline.push(point);
    }
  }
  if(outline.length>1&&Math.hypot(outline[0][0]-outline[outline.length-1][0],outline[0][1]-outline[outline.length-1][1])<=1e-12)outline.pop();
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

function foliage(x:number,y:number,z:number,rx:number,ry:number,rz:number,color:Color):SceneMesh[] {
  const meshes:SceneMesh[]=[];
  const point=(latitude:number,longitude:number):Point=>[x+rx*Math.sin(latitude)*Math.cos(longitude),y+ry*Math.cos(latitude),z+rz*Math.sin(latitude)*Math.sin(longitude)];
  for(let row=0;row<8;row++)for(let col=0;col<16;col++){
    const a=row*Math.PI/8,b=(row+1)*Math.PI/8,c=col*Math.PI/8,d=(col+1)*Math.PI/8;
    const shade=.72+.22*Math.max(0,Math.cos((a+b)/2))+.09*Math.sin((c+d)/2);
    if(row>0)meshes.push({vertices:[...point(a,c),...point(b,c),...point(a,d)],color:tint(color,shade)});
    if(row<7)meshes.push({vertices:[...point(a,d),...point(b,c),...point(b,d)],color:tint(color,shade)});
  }
  return meshes;
}

/** A closed shade with two elliptical rims, so every exported part is a solid. */
function shade(x:number,y:number,z:number,bottomX:number,bottomZ:number,topX:number,topZ:number,height:number,color:Color):SceneMesh[] {
  const meshes:SceneMesh[]=[],top:SceneMesh={vertices:[],color},bottom:SceneMesh={vertices:[],color:tint(color,.68)};
  for(let i=0;i<32;i++){
    const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
    const low=(angle:number):Point=>[x+Math.cos(angle)*bottomX,y,z+Math.sin(angle)*bottomZ];
    const high=(angle:number):Point=>[x+Math.cos(angle)*topX,y+height,z+Math.sin(angle)*topZ];
    meshes.push(face(low(a),low(b),high(b),high(a),tint(color,.78+.11*(Math.sin(a)+1)/2)));
    top.vertices.push(x,y+height,z,...high(a),...high(b));
    bottom.vertices.push(x,y,z,...low(b),...low(a));
  }
  meshes.push(top,bottom);return meshes;
}

/** A visual bulb/diffuser tint only; no lux, light casting, or real-room simulation. */
export function fixtureLightColor(item: FurnitureItem): Color {
  const light=item.light;
  if(!light)return material('#eee9dc');
  const amount=light.enabled&&Number.isFinite(light.brightness)?Math.max(0,Math.min(100,light.brightness))/100:0;
  const color=material(light.temperature===6500?'#d4e7ff':light.temperature===4000?'#fff5e0':'#ffd49b');
  const off=material('#898b81');
  return [off[0]+(color[0]-off[0])*amount,off[1]+(color[1]-off[1])*amount,off[2]+(color[2]-off[2])*amount,1];
}

/** Shared by the WebXR and room renderers. The oriented footprint starts at placement.x/z. */
export function furnitureMeshes(item: FurnitureItem, placement: FurniturePlacement): SceneMesh[] {
  const elevation=placement.elevation??0;
  if(![item.width,item.depth,item.height,placement.x,placement.z,elevation].every(Number.isFinite)||Math.min(item.width,item.depth,item.height)<=0||elevation<0||elevation>10||![0,90,180,270].includes(placement.rotation))return [];
  const w=item.width,d=item.depth,h=item.height,meshes:SceneMesh[]=[];
  const wood=material('#b69a77'),lightWood=material('#c8ae8a'),dark=material('#414a40'),fabric=material(item.color),cream=material('#eee9dc');
  const box=(x:number,y:number,z:number,width:number,height:number,depth:number,color:Color)=>meshes.push(...boxMeshes(x,y,z,width,height,depth,color));
  const soft=(x:number,y:number,z:number,width:number,height:number,depth:number,r:number,color:Color)=>meshes.push(...rounded(x,y,z,width,height,depth,r,color));
  const softBack=(x:number,y:number,z:number,width:number,height:number,depth:number,r:number,color:Color)=>{
    for(const mesh of rounded(x,z,y,width,depth,height,r,color)){
      const vertices:number[]=[];
      // Swap the extrusion axis and reverse winding to retain outward faces.
      for(let i=0;i<mesh.vertices.length;i+=9)for(const offset of [0,6,3])vertices.push(mesh.vertices[i+offset],mesh.vertices[i+offset+2],mesh.vertices[i+offset+1]);
      meshes.push({vertices,color:mesh.color});
    }
  };
  const frontDisc=(cx:number,cy:number,z:number,rx:number,ry:number,depth:number,color:Color)=>{
    for(const mesh of cylinder(cx,z,cy,rx,ry,depth,color)){
      const vertices:number[]=[];
      for(let i=0;i<mesh.vertices.length;i+=9)for(const offset of [0,6,3])vertices.push(mesh.vertices[i+offset],mesh.vertices[i+offset+2],mesh.vertices[i+offset+1]);
      meshes.push({vertices,color:mesh.color});
    }
  };
  const light=fixtureLightColor(item);
  if(item.model==='wall-art'){
    // Frame, recessed linen mat, and a small abstract landscape are separate solids.
    box(0,0,0,w,h,d*.58,fabric);
    box(w*.045,h*.035,d*.58,w*.91,h*.93,d*.13,material('#eee8da'));
    box(w*.12,h*.11,d*.71,w*.76,h*.78,d*.08,material('#d8cab5'));
    frontDisc(w*.66,h*.67,d*.79,w*.12,h*.10,d*.035,material('#b97759'));
    box(w*.12,h*.11,d*.825,w*.76,h*.25,d*.045,material('#6f8069'));
    softBack(w*.12,h*.25,d*.825,w*.48,h*.22,d*.04,Math.min(w,h)*.08,material('#98a288'));
    box(w*.12,h*.11,d*.87,w*.76,h*.08,d*.03,material('#b0936f'));
    for(const x of [0,w*.965])box(x,0,d*.58,w*.035,h,d*.42,fabric);
    for(const y of [0,h*.97])box(0,y,d*.58,w,h*.03,d*.42,fabric);
  } else if(item.model==='wall-mirror'){
    softBack(0,0,0,w,h,d*.72,Math.min(w,h)*.10,fabric);
    softBack(w*.045,h*.03,d*.72,w*.91,h*.94,d*.16,Math.min(w,h)*.08,material('#adbec0'));
    // A neutral reflection motif keeps this recognizable without faking a camera reflection.
    softBack(w*.075,h*.055,d*.88,w*.85,h*.89,d*.035,Math.min(w,h)*.06,material('#c8d6d5'));
    box(w*.12,h*.68,d*.915,w*.055,h*.18,d*.045,material('#e6eeea'));
    box(w*.195,h*.77,d*.915,w*.025,h*.09,d*.045,material('#e6eeea'));
    box(w*.11,h*.11,d*.915,w*.78,h*.045,d*.085,material('#9eb2b3'));
  } else if(item.model==='wall-clock'){
    frontDisc(w/2,h/2,0,w/2,h/2,d*.72,fabric);
    frontDisc(w/2,h/2,d*.72,w*.445,h*.445,d*.12,cream);
    for(const [x,y] of [[.48,.84],[.48,.10],[.10,.48],[.84,.48]])box(w*x,h*y,d*.84,w*.04,h*.06,d*.055,dark);
    box(w*.48,h*.48,d*.895,w*.045,h*.26,d*.045,dark);
    box(w*.48,h*.48,d*.94,w*.24,h*.035,d*.035,dark);
    frontDisc(w/2,h/2,d*.975,w*.045,h*.045,d*.025,dark);
  } else if(item.model==='wall-shelf'){
    // A floating slab stays unobstructed so the full declared top is usable.
    box(0,0,0,w,h,d,fabric);
    box(w*.035,h*.08,d*.98,w*.93,h*.03,d*.02,tint(fabric,.88));
  } else if(item.model==='wall-sconce'){
    softBack(w*.27,h*.08,0,w*.46,h*.84,d*.08,Math.min(w,h)*.08,fabric);
    box(w*.44,h*.31,d*.08,w*.12,h*.11,d*.52,fabric);
    meshes.push(...cylinder(w*.5,h*.29,d*.61,w*.07,d*.06,h*.24,dark));
    meshes.push(...shade(w/2,h*.49,d*.61,w*.5,d*.39,w*.36,d*.29,h*.47,fabric));
    meshes.push(...cylinder(w/2,h*.46,d*.61,w*.43,d*.33,h*.03,light));
    meshes.push(...cylinder(w/2,h*.96,d*.61,w*.32,d*.25,h*.04,light));
    box(w*.38,0,0,w*.24,h*.08,d*.06,fabric);
  } else if(item.model==='pendant-light'){
    // The canopy touches the ceiling at h; the shade hangs below its cord.
    meshes.push(...cylinder(w/2,h*.94,d/2,w*.14,d*.14,h*.06,fabric));
    meshes.push(...cylinder(w/2,h*.33,d/2,w*.012,d*.012,h*.61,dark));
    meshes.push(...shade(w/2,h*.03,d/2,w*.5,d*.5,w*.20,d*.20,h*.30,fabric));
    meshes.push(...cylinder(w/2,0,d/2,w*.45,d*.45,h*.03,light));
    meshes.push(...cylinder(w/2,h*.32,d/2,w*.06,d*.06,h*.03,fabric));
  } else if(item.model==='ceiling-light'){
    meshes.push(...cylinder(w/2,h*.75,d/2,w*.44,d*.44,h*.25,fabric));
    meshes.push(...cylinder(w/2,h*.16,d/2,w/2,d/2,h*.59,fabric));
    meshes.push(...cylinder(w/2,0,d/2,w*.46,d*.46,h*.17,light));
    meshes.push(...cylinder(w/2,h*.12,d/2,w*.48,d*.48,h*.06,light));
  } else if(item.model==='curtains'){
    // Two pleated fabric panels frame an opening. The rod and brackets stay in bounds.
    const rodY=h*.97,rodZ=d*.46;
    for(const mesh of cylinder(h*.97,0,rodZ,h*.009,d*.07,w,material('#6f7062'))){
      const vertices:number[]=[];
      // Extrusion changes from y to x. Reverse winding for the swapped axes.
      for(let i=0;i<mesh.vertices.length;i+=9)for(const offset of [0,6,3])vertices.push(mesh.vertices[i+offset+1],mesh.vertices[i+offset],mesh.vertices[i+offset+2]);
      meshes.push({vertices,color:mesh.color});
    }
    for(const x of [w*.03,w*.94])box(x,rodY-h*.012,0,w*.03,h*.024,d*.46,material('#6f7062'));
    for(const panel of [0,.59])for(let fold=0;fold<7;fold++){
      const x=w*(panel+.025+fold*.052),width=w*.052;
      const shadeFactor=fold%2===0?.96:1.07;
      soft(x,0,d*.25,width,h*.94,d*.75,width*.24,tint(fabric,shadeFactor));
      box(x,h*.94,d*.42,width,h*.06,d*.08,tint(fabric,.84));
    }
  } else if(item.model==='wall-tv'){
    softBack(0,0,0,w,h,d*.8,Math.min(w,h)*.018,fabric);
    box(w*.018,h*.027,d*.8,w*.964,h*.946,d*.06,material('#1d3036'));
    box(w*.028,h*.04,d*.86,w*.944,h*.90,d*.035,material('#759295'));
    box(w*.028,h*.04,d*.895,w*.944,h*.32,d*.025,material('#3f6564'));
    softBack(w*.14,h*.29,d*.895,w*.46,h*.26,d*.025,Math.min(w,h)*.07,material('#567b73'));
    frontDisc(w*.78,h*.72,d*.895,w*.06,h*.10,d*.025,material('#c6ceba'));
    box(w*.485,h*.008,d*.92,w*.03,h*.008,d*.08,material('#b0b6a4'));
  } else if(item.kind==='bed'){
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
  } else if(item.kind==='sofa'){
    for(const x of [w*.07,w*.88])for(const z of [d*.12,d*.8])box(x,0,z,w*.05,h*.15,d*.07,wood);
    soft(0,h*.13,0,w,h*.35,d,Math.min(w,d)*.08,fabric);
    softBack(w*.01,h*.35,d*.025,w*.98,h*.65,d*.18,Math.min(w,h)*.12,fabric);
    for(const x of [w*.12,w*.505])softBack(x,h*.57,d*.16,w*.375,h*.39,d*.13,h*.06,tint(fabric,1.08));
    for(const x of [0,w*.89])soft(x,h*.4,d*.1,w*.11,h*.35,d*.9,d*.05,fabric);
    for(const x of [w*.12,w*.505])soft(x,h*.48,d*.23,w*.375,h*.12,d*.72,d*.06,tint(fabric,1.1));
  } else if(item.kind==='ottoman'){
    for(const x of [w*.10,w*.84])for(const z of [d*.12,d*.82])box(x,0,z,w*.06,h*.17,d*.06,wood);
    soft(0,h*.13,0,w,h*.74,d,Math.min(w,d)*.12,fabric);
    soft(w*.02,h*.84,d*.02,w*.96,h*.16,d*.96,Math.min(w,d)*.12,tint(fabric,1.08));
  } else if(item.kind==='shelf'){
    box(0,0,0,w*.06,h,d,wood);box(w*.94,0,0,w*.06,h,d,wood);
    box(0,0,0,w,h,d*.06,tint(fabric,.8));
    for(const y of [0,h*.24,h*.49,h*.74,h*.96])box(0,y,0,w,h*.04,d,fabric);
    for(const [x,y,color] of [[.14,.04,'#8f6c50'],[.23,.04,'#b7b29b'],[.32,.04,'#6d7b6d'],[.55,.53,'#b7b29b'],[.64,.53,'#8f6c50']] as const)box(w*x,h*y,d*.2,w*.07,h*.17,d*.55,material(color));
  } else if(item.kind==='plant'){
    meshes.push(...cylinder(w/2,0,d/2,w*.28,d*.28,h*.3,material('#c28e70')));
    meshes.push(...cylinder(w/2,h*.298,d/2,w*.25,d*.25,h*.009,material('#4d4635')));
    meshes.push(...cylinder(w/2,h*.3,d/2,w*.025,d*.025,h*.63,wood));
    for(const [x,y,z,rx,ry,rz] of [[.3,.43,.5,.28,.12,.21],[.65,.5,.4,.3,.13,.2],[.4,.56,.7,.25,.13,.25],[.3,.64,.35,.28,.13,.25],[.7,.7,.5,.28,.13,.22],[.5,.78,.7,.25,.12,.26],[.35,.84,.45,.27,.12,.24],[.55,.92,.4,.25,.08,.25]])meshes.push(...foliage(w*x,h*y,d*z,w*rx,h*ry,d*rz,fabric));
  } else if(item.kind==='lamp'){
    meshes.push(...cylinder(w/2,0,d/2,w*.34,d*.34,h*.035,dark));
    meshes.push(...cylinder(w/2,h*.035,d/2,w*.027,d*.027,h*.77,dark));
    meshes.push(...cylinder(w/2,h*.77,d/2,w/2,d/2,h*.23,fabric));
    meshes.push(...cylinder(w/2,h*.992,d/2,w*.41,d*.41,h*.008,light));
    meshes.push(...cylinder(w/2,h*.765,d/2,w*.43,d*.43,h*.005,light));
  } else if(item.kind==='rug'){
    soft(0,0,0,w,h*.65,d,Math.min(w,d)*.035,fabric);
    soft(w*.055,h*.65,d*.045,w*.89,h*.25,d*.91,Math.min(w,d)*.025,tint(fabric,1.13));
    for(const x of [.13,.84])box(w*x,h*.92,d*.09,w*.025,h*.08,d*.82,tint(fabric,.83));
  } else if(item.kind==='monitor'){
    soft(w*.18,0,d*.05,w*.64,h*.045,d*.95,Math.min(w,d)*.06,dark);
    box(w*.46,h*.045,d*.10,w*.08,h*.36,d*.16,dark);
    softBack(0,h*.32,0,w,h*.68,d*.15,Math.min(w,h)*.035,fabric);
    box(w*.035,h*.365,d*.15,w*.93,h*.59,d*.012,material('#24363c'));
    box(w*.09,h*.77,d*.163,w*.55,h*.012,d*.003,material('#789f9b'));
    box(w*.09,h*.69,d*.163,w*.32,h*.01,d*.003,material('#526f75'));
  } else if(item.kind==='laptop'){
    soft(0,0,0,w,h*.055,d,Math.min(w,d)*.035,fabric);
    softBack(0,h*.055,0,w,h*.945,d*.055,Math.min(w,h)*.025,fabric);
    box(w*.035,h*.105,d*.055,w*.93,h*.85,d*.01,material('#25383f'));
    box(w*.09,h*.66,d*.065,w*.57,h*.012,d*.003,material('#84a8a3'));
    box(w*.09,h*.59,d*.065,w*.36,h*.01,d*.003,material('#56767a'));
    box(w*.08,h*.055,d*.14,w*.84,h*.009,d*.43,dark);
    soft(w*.36,h*.055,d*.67,w*.28,h*.008,d*.21,Math.min(w,d)*.02,tint(fabric,.87));
    for(let row=0;row<3;row++)box(w*.10,h*.064,d*(.20+row*.12),w*.80,h*.003,d*.012,tint(fabric,1.13));
  } else if(item.kind==='speaker'){
    soft(0,0,0,w,h,d,Math.min(w,d)*.06,fabric);
    const frontDisc=(cx:number,cy:number,rx:number,ry:number,color:Color)=>{
      for(const mesh of cylinder(cx,d*.99,cy,rx,ry,d*.01,color)){
        const vertices:number[]=[];
        for(let i=0;i<mesh.vertices.length;i+=9)for(const offset of [0,6,3])vertices.push(mesh.vertices[i+offset],mesh.vertices[i+offset+2],mesh.vertices[i+offset+1]);
        meshes.push({vertices,color:mesh.color});
      }
    };
    frontDisc(w*.5,h*.34,w*.34,h*.22,dark);
    frontDisc(w*.5,h*.34,w*.21,h*.135,tint(fabric,.65));
    frontDisc(w*.5,h*.78,w*.18,h*.115,dark);
  } else if(item.kind==='custom'){
    soft(0,0,0,w,h,d,Math.min(w,d)*.03,fabric);
  } else if(item.kind==='chair'){
    const leg=Math.min(w,d)*.075;
    for(const x of [w*.10,w*.825])for(const z of [d*.12,d*.80])box(x,0,z,leg,h*.45,leg,wood);
    soft(0,h*.44,d*.04,w,h*.09,d*.96,Math.min(w,d)*.08,fabric);
    box(w*.08,h*.45,d*.04,w*.08,h*.55,d*.065,wood);
    box(w*.84,h*.45,d*.04,w*.08,h*.55,d*.065,wood);
    soft(0,h*.67,0,w,h*.30,d*.12,Math.min(w,d)*.04,fabric);
  }
  return meshes.map(mesh=>({color:mesh.color,vertices:mesh.vertices.map((value,index)=>{
    if(index%3===1)return value+elevation;
    const start=index-index%3,x=mesh.vertices[start],z=mesh.vertices[start+2];
    const rotated=placement.rotation===90?[d-z,x]:placement.rotation===180?[w-x,d-z]:placement.rotation===270?[z,w-x]:[x,z];
    return index%3===0?placement.x+rotated[0]:placement.z+rotated[1];
  })}));
}
