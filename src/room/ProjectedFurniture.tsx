import { useEffect, useRef } from 'react';
import { drawPhotoScene } from './photoFurniture';
import type { PhotoScene } from './photoFurniture';

export default function PhotoFurniture({scene,width,height}:{scene:PhotoScene;width:number;height:number}){
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    canvas.width=Math.min(width,1800);canvas.height=Math.round(canvas.width*height/width);
    const context=canvas.getContext('2d');if(!context)return;
    context.clearRect(0,0,canvas.width,canvas.height);drawPhotoScene(context,scene,canvas.width,canvas.height);
  },[scene,width,height]);
  return <canvas ref={ref} className="room-photo-furniture" aria-label="Furniture concept projected into your room photo"/>;
}
