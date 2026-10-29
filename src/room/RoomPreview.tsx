import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import type { FurnitureItem, FurniturePlacement, RoomSize } from './layout';
import { boxMeshes, furnitureMeshes, material } from './furnitureGeometry';
import type { SceneMesh } from './furnitureGeometry';
import './room-preview.css';

type Vector = [number,number,number];
type Orbit = {yaw:number;pitch:number;zoom:number};
type Label = {id:string;name:string;x:number;y:number;depth:number};
type Pick = {id:string;left:number;right:number;top:number;bottom:number;depth:number};
const DEFAULT:Orbit={yaw:.70,pitch:.72,zoom:1};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const normalize=(v:Vector):Vector=>{const l=Math.hypot(...v)||1;return [v[0]/l,v[1]/l,v[2]/l];};
const cross=(a:Vector,b:Vector):Vector=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a:Vector,b:Vector)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function perspective(aspect:number,far:number){const f=1/Math.tan(Math.PI/9),near=.05;return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);}
function lookAt(eye:Vector,target:Vector){const z=normalize([eye[0]-target[0],eye[1]-target[1],eye[2]-target[2]]),x=normalize(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
function transform(m:Float32Array,v:number[]){return [0,1,2,3].map(i=>m[i]*v[0]+m[i+4]*v[1]+m[i+8]*v[2]+m[i+12]*v[3]);}
function project(point:Vector,view:Float32Array,projection:Float32Array){const p=transform(projection,transform(view,[...point,1]));return {x:(p[0]/p[3]+1)/2,y:(1-p[1]/p[3])/2,depth:p[2]/p[3],front:p[3]>0};}
function batch(meshes:SceneMesh[]):SceneMesh[]{const groups=new Map<string,SceneMesh>();for(const mesh of meshes){const key=mesh.color.join(',');const group=groups.get(key);if(group)group.vertices.push(...mesh.vertices);else groups.set(key,{color:mesh.color,vertices:[...mesh.vertices]});}return [...groups.values()];}

/** Fit the complete room to both viewport axes, including narrow phone screens. */
function cameraDistance(room:RoomSize,target:Vector,orbit:Orbit,aspect:number){
  const direction:Vector=[Math.sin(orbit.yaw)*Math.cos(orbit.pitch),Math.sin(orbit.pitch),Math.cos(orbit.yaw)*Math.cos(orbit.pitch)];
  const right=normalize(cross([0,1,0],direction)),up=cross(direction,right);
  const vertical=Math.tan(Math.PI/9)*.88,horizontal=vertical*aspect;
  let distance=0;
  for(const x of [-.08,room.width+.08])for(const y of [-.1,room.height??2.7])for(const z of [-.08,room.depth+.08]){
    const point:Vector=[x-target[0],y-target[1],z-target[2]],depth=dot(point,direction);
    distance=Math.max(distance,depth+Math.abs(dot(point,right))/horizontal,depth+Math.abs(dot(point,up))/vertical);
  }
  return Math.max(distance,.5)*orbit.zoom;
}

function createRenderer(canvas:HTMLCanvasElement){
  const gl=canvas.getContext('webgl',{antialias:true,alpha:false,preserveDrawingBuffer:false});
  if(!gl)throw new Error('3D graphics unavailable');
  const compile=(type:number,source:string)=>{const shader=gl.createShader(type);if(!shader)throw new Error('Shader unavailable');gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw new Error('Shader compilation failed');}return shader;};
  const vertex=compile(gl.VERTEX_SHADER,'attribute vec3 position;uniform mat4 projection;uniform mat4 view;void main(){gl_Position=projection*view*vec4(position,1.0);}');
  let fragment:WebGLShader;
  try{fragment=compile(gl.FRAGMENT_SHADER,'precision mediump float;uniform vec4 color;void main(){gl_FragColor=color;}');}catch(error){gl.deleteShader(vertex);throw error;}
  const program=gl.createProgram();if(!program){gl.deleteShader(vertex);gl.deleteShader(fragment);throw new Error('3D program unavailable');}
  gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);throw new Error('3D rendering unavailable');}
  const buffer=gl.createBuffer();if(!buffer){gl.deleteProgram(program);throw new Error('3D buffer unavailable');}
  const position=gl.getAttribLocation(program,'position'),projection=gl.getUniformLocation(program,'projection'),view=gl.getUniformLocation(program,'view'),color=gl.getUniformLocation(program,'color');
  return {
    begin(p:Float32Array,v:Float32Array){gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.91,.92,.885,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,3,gl.FLOAT,false,0,0);gl.uniformMatrix4fv(projection,false,p);gl.uniformMatrix4fv(view,false,v);},
    draw(meshes:SceneMesh[],lines=false){for(const mesh of meshes){gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh.vertices),gl.DYNAMIC_DRAW);gl.uniform4fv(color,mesh.color);gl.drawArrays(lines?gl.LINES:gl.TRIANGLES,0,mesh.vertices.length/3);}},
    dispose(){gl.deleteBuffer(buffer);gl.deleteProgram(program);},
  };
}

function roomMeshes(room:RoomSize,eye:Vector,showWalls:boolean):SceneMesh[]{
  const {width:w,depth:d}=room,h=room.height??2.7,result:SceneMesh[]=[];
  // A neutral cutaway shell is conceptual; doors and windows are never invented.
  result.push(...boxMeshes(-.08,-.10,-.08,w+.16,.10,d+.16,material('#a99a83')));
  const planks=Math.min(90,Math.ceil(w/.20));
  for(let i=0;i<planks;i++)result.push(...boxMeshes(i*w/planks,.001,0,w/planks-.004,.012,d,material(i%3===0?'#cbb899':i%3===1?'#d3c2a6':'#cdbc9e')));
  if(!showWalls)return result;
  const wallX=eye[0]>w/2?-.07:w,wallZ=eye[2]>d/2?-.07:d;
  const sideWall=boxMeshes(wallX,0,0,.07,h,d,material('#e1e3d9'));
  const backWall=boxMeshes(0,0,wallZ,w,h,.07,material('#eaece4'));
  sideWall[wallX<0?2:3].color=material('#d5dacf');
  backWall[wallZ<0?1:4].color=material('#e2e5db');
  result.push(...sideWall,...backWall);
  result.push(...boxMeshes(wallX<0?0:w-.018,0,0,.018,.10,d,material('#f5f4ec')));
  result.push(...boxMeshes(0,0,wallZ<0?0:d-.018,w,.10,.018,material('#f5f4ec')));
  return result;
}

export default function RoomPreview({room,items,placements,selectedId,onSelect,showWalls=true}:{room:RoomSize;items:readonly FurnitureItem[];placements:readonly FurniturePlacement[];selectedId?:string;onSelect?:(id:string)=>void;showWalls?:boolean}){
  const canvasRef=useRef<HTMLCanvasElement>(null),graphics=useRef<ReturnType<typeof createRenderer>|null>(null),orbit=useRef<Orbit>({...DEFAULT});
  const frame=useRef(0),drawRef=useRef<()=>void>(()=>{}),picks=useRef<Pick[]>([]);
  const pointers=useRef(new Map<number,{x:number;y:number}>()),gesture=useRef<{x:number;y:number;moved:boolean}|null>(null);
  const [available,setAvailable]=useState(true),[labels,setLabels]=useState<Label[]>([]),[viewMode,setViewMode]=useState<'perspective'|'top'>('perspective');
  const description=useId();
  const valid=Number.isFinite(room.width)&&Number.isFinite(room.depth)&&room.width>0&&room.depth>0&&(room.height===undefined||Number.isFinite(room.height)&&room.height>0);
  const placed=useMemo(()=>placements.flatMap(placement=>{const item=items.find(value=>value.id===placement.itemId);return item?[{item,placement}]:[];}),[items,placements]);
  const furniture=useMemo(()=>batch(placed.flatMap(({item,placement})=>furnitureMeshes(item,placement))),[placed]);
  const redraw=()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;drawRef.current();});};
  drawRef.current=()=>{
    const canvas=canvasRef.current,renderer=graphics.current;if(!canvas||!renderer||!valid)return;
    const rect=canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2);
    if(rect.width<1||rect.height<1)return;
    const width=Math.round(rect.width*ratio),height=Math.round(rect.height*ratio);if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    const target:Vector=[room.width/2,(room.height??2.7)*.21,room.depth/2],o=orbit.current;
    const distance=cameraDistance(room,target,o,width/height);
    const eye:Vector=[target[0]+Math.sin(o.yaw)*Math.cos(o.pitch)*distance,target[1]+Math.sin(o.pitch)*distance,target[2]+Math.cos(o.yaw)*Math.cos(o.pitch)*distance];
    const projection=perspective(width/height,Math.max(100,distance+Math.hypot(room.width,room.depth,room.height??2.7)*2)),view=lookAt(eye,target);
    renderer.begin(projection,view);renderer.draw(batch(roomMeshes(room,eye,showWalls)));
    // Soft grounding shadows are illustrative, not a light simulation.
    for(const {item,placement:p} of placed){const w=p.rotation===90?item.depth:item.width,d=p.rotation===90?item.width:item.depth;renderer.draw([{vertices:[p.x-.025,.016,p.z-.025,p.x+w+.025,.016,p.z-.025,p.x+w+.025,.016,p.z+d+.025,p.x-.025,.016,p.z-.025,p.x+w+.025,.016,p.z+d+.025,p.x-.025,.016,p.z+d+.025],color:[.25,.26,.20,.12]}]);}
    renderer.draw(furniture);
    const nextLabels:Label[]=[],nextPicks:Pick[]=[];
    for(const {item,placement:p} of placed){
      const w=p.rotation===90?item.depth:item.width,d=p.rotation===90?item.width:item.depth;
      const center=project([p.x+w/2,item.height+.08,p.z+d/2],view,projection);
      if(item.id===selectedId&&center.front&&center.x>.02&&center.x<.98&&center.y>.02&&center.y<.94)nextLabels.push({id:item.id,name:item.label,x:center.x*100,y:center.y*100,depth:center.depth});
      const corners=[0,item.height].flatMap(y=>[[p.x,y,p.z],[p.x+w,y,p.z],[p.x+w,y,p.z+d],[p.x,y,p.z+d]] as Vector[]).map(point=>project(point,view,projection));
      if(corners.every(point=>point.front))nextPicks.push({id:item.id,left:Math.min(...corners.map(p=>p.x))*rect.width,right:Math.max(...corners.map(p=>p.x))*rect.width,top:Math.min(...corners.map(p=>p.y))*rect.height,bottom:Math.max(...corners.map(p=>p.y))*rect.height,depth:center.depth});
      if(item.id===selectedId){const x=p.x-.025,z=p.z-.025,W=w+.05,D=d+.05;renderer.draw([{vertices:[x,.025,z,x+W,.025,z,x+W,.025,z,x+W,.025,z+D,x+W,.025,z+D,x,.025,z+D,x,.025,z+D,x,.025,z],color:[.32,.46,.20,1]}],true);}
    }
    picks.current=nextPicks;setLabels(nextLabels.sort((a,b)=>b.depth-a.depth));
  };
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas||!valid)return;
    const restore=()=>{try{graphics.current?.dispose();graphics.current=createRenderer(canvas);setAvailable(true);redraw();}catch{graphics.current=null;setAvailable(false);}};
    const lost=(event:Event)=>{event.preventDefault();cancelAnimationFrame(frame.current);frame.current=0;graphics.current=null;picks.current=[];setAvailable(false);};
    restore();
    const resize=typeof ResizeObserver!=='undefined'?new ResizeObserver(redraw):null;resize?.observe(canvas);
    window.addEventListener('resize',redraw);canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restore);
    const wheel=(event:WheelEvent)=>{event.preventDefault();orbit.current.zoom=clamp(orbit.current.zoom*Math.exp(event.deltaY*.001),.55,1.8);redraw();};
    canvas.addEventListener('wheel',wheel,{passive:false});
    return()=>{cancelAnimationFrame(frame.current);frame.current=0;resize?.disconnect();window.removeEventListener('resize',redraw);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restore);graphics.current?.dispose();graphics.current=null;pointers.current.clear();gesture.current=null;picks.current=[];};
  // The renderer persists as room and furniture data change.
  },[valid]);
  useEffect(redraw,[furniture,room.width,room.depth,room.height,selectedId,showWalls]);

  function reset(top=false){orbit.current=top?{yaw:.001,pitch:1.50,zoom:.95}:{...DEFAULT};setViewMode(top?'top':'perspective');redraw();}
  function pointerDown(event:ReactPointerEvent<HTMLCanvasElement>){if(event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.current.size===1)gesture.current={x:event.clientX,y:event.clientY,moved:false};else if(gesture.current)gesture.current.moved=true;}
  function pointerMove(event:ReactPointerEvent<HTMLCanvasElement>){
    const old=pointers.current.get(event.pointerId);if(!old)return;
    const before=[...pointers.current.values()];pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(gesture.current&&Math.hypot(event.clientX-gesture.current.x,event.clientY-gesture.current.y)>5)gesture.current.moved=true;
    if(pointers.current.size===2){const after=[...pointers.current.values()],a=Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y),b=Math.hypot(after[0].x-after[1].x,after[0].y-after[1].y);if(a>5&&b>5)orbit.current.zoom=clamp(orbit.current.zoom*a/b,.55,1.8);}
    else{orbit.current.yaw-=(event.clientX-old.x)*.008;orbit.current.pitch=clamp(orbit.current.pitch+(event.clientY-old.y)*.007,.20,1.50);setViewMode('perspective');}
    redraw();
  }
  function pointerUp(event:ReactPointerEvent<HTMLCanvasElement>){
    if(pointers.current.size===1&&gesture.current&&!gesture.current.moved){const r=event.currentTarget.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;const target=picks.current.filter(p=>x>=p.left&&x<=p.right&&y>=p.top&&y<=p.bottom).sort((a,b)=>a.depth-b.depth)[0];if(target)onSelect?.(target.id);}
    pointers.current.delete(event.pointerId);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(!pointers.current.size)gesture.current=null;
  }
  function keyDown(event:ReactKeyboardEvent<HTMLCanvasElement>){
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(event.key))return;
    event.preventDefault();
    if(event.key==='Home'){reset();return;}
    if(event.key.startsWith('Arrow'))setViewMode('perspective');
    if(event.key==='ArrowLeft')orbit.current.yaw+=.12;
    if(event.key==='ArrowRight')orbit.current.yaw-=.12;
    if(event.key==='ArrowUp')orbit.current.pitch=clamp(orbit.current.pitch+.08,.2,1.5);
    if(event.key==='ArrowDown')orbit.current.pitch=clamp(orbit.current.pitch-.08,.2,1.5);
    if(event.key==='+'||event.key==='=')orbit.current.zoom=clamp(orbit.current.zoom*.9,.55,1.8);
    if(event.key==='-')orbit.current.zoom=clamp(orbit.current.zoom*1.1,.55,1.8);
    redraw();
  }
  if(!valid)return <div className="room-preview-empty"><strong>Give your room a size.</strong><p>Enter its width and depth to build a room preview.</p></div>;
  return <div className="room-preview">
    <div className="room-render-surface">
      <canvas ref={canvasRef} hidden={!available} tabIndex={0} role="img" aria-label={`Interactive 3D room, ${room.width} by ${room.depth} metres, containing ${placed.length} furniture items.`} aria-describedby={description} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={e=>{pointers.current.delete(e.pointerId);gesture.current=null;}} onLostPointerCapture={e=>{pointers.current.delete(e.pointerId);gesture.current=null;}} onKeyDown={keyDown}/>
      {available?<div className="room-preview-labels">{labels.map(label=><button key={label.id} className={selectedId===label.id?'is-selected':''} style={{left:`${label.x}%`,top:`${label.y}%`}} onClick={()=>onSelect?.(label.id)} aria-label={`Select ${label.name}`}><i/>{label.name}</button>)}</div>:<div className="room-render-fallback"><p>3D graphics are unavailable in this browser. A top-down layout is shown below.</p><svg viewBox={`-.2 -.2 ${room.width+.4} ${room.depth+.4}`} role="img" aria-label="Top-down furniture layout"><rect width={room.width} height={room.depth} fill="#d4c2a4" stroke="#9b927f" strokeWidth=".02"/>{placed.map(({item,placement:p})=><g key={item.id} role="button" tabIndex={0} aria-label={`Select ${item.label}`} onClick={()=>onSelect?.(item.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect?.(item.id);}}}><rect x={p.x} y={p.z} width={p.rotation===90?item.depth:item.width} height={p.rotation===90?item.width:item.depth} fill={/^#[0-9a-f]{6}$/i.test(item.color)?item.color:'#81917a'} stroke={selectedId===item.id?'#294b20':'#57614d'} strokeWidth=".025"/><text x={p.x+.05} y={p.z+.16} fontSize=".12" fill="#20291e">{item.label}</text></g>)}</svg></div>}
      {available&&<><div className="room-camera-angle" role="group" aria-label="3D camera angle"><button aria-pressed={viewMode==='perspective'} onClick={()=>reset()}>Perspective</button><button aria-pressed={viewMode==='top'} onClick={()=>reset(true)}>Top view</button></div><div className="room-zoom-tools"><button aria-label="Zoom in" onClick={()=>{orbit.current.zoom=clamp(orbit.current.zoom*.85,.55,1.8);redraw();}}><Plus size={16}/></button><button aria-label="Zoom out" onClick={()=>{orbit.current.zoom=clamp(orbit.current.zoom*1.15,.55,1.8);redraw();}}><Minus size={16}/></button><button aria-label="Reset room view" onClick={()=>reset()}><RotateCcw size={15}/></button></div></>}
      <p className="room-preview-help" id={description}>{available?<>Drag to orbit · pinch or scroll to zoom<span>Keyboard: arrows, + / −, Home</span></>:'Select a furniture item to inspect its dimensions.'}</p>
    </div>
  </div>;
}
