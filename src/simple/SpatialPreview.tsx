import { useState } from 'react';
import { ArrowUpRight, Layers2, MoveUpRight } from 'lucide-react';
import PhotoStage from './PhotoStage';
import type { Movement, SceneImage, SceneObject } from '../types';

// Hand-positioned illustration, never submitted as recognition or verification evidence.
const image:SceneImage={image_url:'/desk-preview.webp',width:1600,height:1067,name:'Illustrative desk preview'};
const objects:SceneObject[]=[
  {id:'keyboard',label:'Keyboard',box:{x:.535,y:.45,width:.405,height:.18},locked:true},
  {id:'trackpad',label:'Trackpad',box:{x:.378,y:.455,width:.158,height:.17},locked:false},
  {id:'phone',label:'Phone',box:{x:.435,y:.647,width:.075,height:.216},locked:false},
  {id:'mouse',label:'Mouse',box:{x:.551,y:.737,width:.09,height:.182},locked:false},
];
const move:Movement={number:1,object_id:'phone',label:'Phone',source:objects[2].box,destination:{x:.715,y:.704,width:.075,height:.216},instruction:'Lift the phone and place it in the outlined spot.'};

export default function SpatialPreview(){
  const [mode,setMode]=useState<'objects'|'guide'>('guide');
  return <figure className="spatial-preview">
    <div className="preview-photo"><PhotoStage key={mode} image={image} imageAlt="Desk photograph with illustrative object outlines" toolbarLabel="Interactive example" objects={objects} move={mode==='guide'?move:undefined}/></div>
    <div className="preview-controls" role="group" aria-label="Explore the photo preview">
      <button aria-pressed={mode==='objects'} onClick={()=>setMode('objects')}><Layers2 size={15}/>Objects</button>
      <button aria-pressed={mode==='guide'} onClick={()=>setMode('guide')}><MoveUpRight size={15}/>Guidance</button>
    </div>
    <figcaption>
      <div className="preview-instruction" aria-live="polite"><span className="preview-step">{mode==='guide'?'01':'04'}</span><div><strong>{mode==='guide'?'A clear place to put it.':'The familiar things in your space.'}</strong><p>{mode==='guide'?'Lift your phone into the outlined spot.':'Four example outlines. Your setup, at a glance.'}</p></div><ArrowUpRight size={22}/></div>
      <div className="preview-provenance"><span>Illustrative photo guidance · not a live scan</span><a href="https://unsplash.com/photos/ElFBCgOfoIM" target="_blank" rel="noreferrer" aria-label="Desk photo by Jakub Żerdzicki on Unsplash">Photo credit <ArrowUpRight size={11}/></a></div>
    </figcaption>
  </figure>;
}
