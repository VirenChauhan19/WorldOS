import type { SceneObject } from '../types';

const normalizedLabel=(label:string)=>label.trim().replace(/\s+/g,' ').toLowerCase();

/** Similar current image evidence, not proof of a remembered item's identity. */
export function matchesRememberedObject(live:SceneObject,remembered:SceneObject):boolean{
  const label=normalizedLabel(live.label);
  if(!label||label!==normalizedLabel(remembered.label))return false;
  const a=live.box,b=remembered.box;
  if(![a.x,a.y,a.width,a.height,b.x,b.y,b.width,b.height].every(Number.isFinite)||a.width<=0||a.height<=0||b.width<=0||b.height<=0)return false;
  const intersection=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return intersection/(a.width*a.height+b.width*b.height-intersection)>=.45;
}

export function imageLocation(object:SceneObject):string{
  const x=object.box.x+object.box.width/2,y=object.box.y+object.box.height/2;
  return `${y<.33?'Upper':y>.67?'Lower':'Middle'} ${x<.33?'left':x>.67?'right':'center'}`;
}
