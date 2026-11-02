import type { FurnitureItem, FurniturePlacement, ReservedZone } from '../room/layout';

export interface RoomDraft {
  roomFields: {width:string;depth:string;height:string};
  source: 'unmeasured'|'entered'|'ar';
  items: FurnitureItem[];
  gap: string;
  manual: FurniturePlacement[]|null;
  zones?: ReservedZone[];
  reviewed?: boolean;
}
export const roomDraftKey='worldos.device.room.v1';
export function loadRoomDraft():RoomDraft|null {
  try {
    const d=JSON.parse(localStorage.getItem(roomDraftKey)??'null') as RoomDraft|null;
    if(!d||!['unmeasured','entered','ar'].includes(d.source)||typeof d.gap!=='string'||!d.roomFields||[d.roomFields.width,d.roomFields.depth,d.roomFields.height].some(v=>typeof v!=='string')||!Array.isArray(d.items)||d.items.length>12)return null;
    if(d.items.some(i=>!i||typeof i.id!=='string'||typeof i.label!=='string'||typeof i.color!=='string'||!['bed','desk','table','wardrobe','chair'].includes(i.kind)||![i.width,i.depth,i.height].every(v=>v===null||typeof v==='number'&&Number.isFinite(v))))return null;
    if(d.manual!==null&&(!Array.isArray(d.manual)||d.manual.length>12||d.manual.some(p=>!p||typeof p.itemId!=='string'||![p.x,p.z].every(Number.isFinite)||![0,90].includes(p.rotation))))return null;
    if(d.zones!==undefined&&(!Array.isArray(d.zones)||d.zones.length>12||d.zones.some(z=>!z||typeof z.id!=='string'||typeof z.label!=='string'||!['obstacle','access'].includes(z.kind)||![z.x,z.z,z.width,z.depth].every(n=>n===null||typeof n==='number'&&Number.isFinite(n)))))return null;
    // JSON represents unfinished numeric fields as null. Keep them empty on reload
    // instead of discarding all furniture when one dimension is being edited.
    return {...d,reviewed:d.reviewed===true,zones:d.zones?.map(z=>({...z,x:z.x??NaN,z:z.z??NaN,width:z.width??NaN,depth:z.depth??NaN}))??[],items:d.items.map(i=>({...i,width:i.width??NaN,depth:i.depth??NaN,height:i.height??NaN}))};
  } catch { return null; }
}
