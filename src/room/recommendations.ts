import { additionalPlacement, FURNITURE_PRESETS } from './layout';
import type { FurnitureItem, FurniturePlacement, ReservedZone, RoomSize } from './layout';

export const ROOM_OPTIONS:readonly FurnitureItem[]=[
  {id:'compact-desk',kind:'desk',label:'Compact desk',width:.8,depth:.5,height:.75,color:'#b59a73'},
  {id:'small-storage',kind:'wardrobe',label:'Small cabinet',width:.6,depth:.4,height:1.2,color:'#b5bca6'},
  {id:'side-table',kind:'table',label:'Side table',width:.45,depth:.45,height:.5,color:'#c4a47e'},
  ...FURNITURE_PRESETS,
];
export interface RoomSuggestion {item:FurnitureItem;placement:FurniturePlacement|null}
export function recommendFurniture(room:RoomSize|null,items:readonly FurnitureItem[],placements:readonly FurniturePlacement[],gap:number,zones:readonly ReservedZone[]):RoomSuggestion[]{
  return ROOM_OPTIONS.map((example,index)=>{
    let id=`option-${index}`;while(items.some(i=>i.id===id))id+='-new';
    const item={...example,id};
    return {item,placement:additionalPlacement(room,items,placements,item,gap,zones)};
  });
}
