// Node 22.18+ (native TypeScript stripping); validate live provider output locally.
import { readFileSync, writeFileSync } from 'node:fs';
import { planRoom, assessRoomLayout } from '../src/room/layout.ts';

const path=process.argv[2];
if(!path)throw new Error('Usage: node scripts/check_room_recording.mjs <live-result.json>');
const result=JSON.parse(readFileSync(path,'utf8'));
const room={...result.survey.room};if(room.height===null)delete room.height;
const plan=planRoom(room,result.design.items,.3,result.survey.zones,result.design.placements);
const checked=assessRoomLayout(room,result.design.items,plan.placements,.3,result.survey.zones);
result.checked_placements=plan.placements;
result.layout_check={status:checked.status,issues:checked.issues,unplaced:checked.unplacedIds};
if(result.previous_design){
  result.layout_check.existing_pieces_preserved=result.previous_design.items.every(original=>{
    const item=result.design.items.find(i=>i.id===original.id);
    const before=result.previous_design.placements.find(p=>p.itemId===original.id),after=plan.placements.find(p=>p.itemId===original.id);
    return item&&before&&after&&['width','depth','height'].every(k=>item[k]===original[k])&&Math.hypot(before.x-after.x,before.z-after.z)<1e-5&&before.rotation===after.rotation;
  });
}
writeFileSync(path,JSON.stringify(result,null,2));
console.log(JSON.stringify({file:path,...result.layout_check,placements:plan.placements},null,2));
if(checked.status!=='fits')process.exitCode=1;
