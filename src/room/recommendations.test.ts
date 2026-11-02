import { describe, expect, it } from 'vitest';
import { additionalPlacement, assessRoomLayout, planRoom } from './layout';
import type { FurnitureItem, ReservedZone } from './layout';
import { recommendFurniture } from './recommendations';
const desk:FurnitureItem={id:'desk',kind:'desk',label:'Desk',width:1,depth:.5,height:.75,color:'#aaaaaa'};
const path:ReservedZone={id:'path',label:'Door path',kind:'access',x:0,z:0,width:.8,depth:2};
describe('occupied room planning',()=>{
  it('finds a plan outside a reserved access strip and counts its occupied area',()=>{
    const room={width:2,depth:2},result=planRoom(room,[desk],.2,[path]);
    expect(result.status).toBe('fits');expect(result.placements[0].x).toBeGreaterThanOrEqual(.8);
    expect(result.occupiedArea).toBeCloseTo(2.1);expect(result.freeArea).toBeCloseTo(1.9);
    expect(assessRoomLayout(room,[desk],[{itemId:'desk',x:0,z:0,rotation:0}],.2,[path]).issues.some(i=>i.type==='reserved-overlap')).toBe(true);
  });
  it('reserves gaps around objects, while a marked access zone already includes its own clearance',()=>{
    const room={width:1.8,depth:.5},zone={...path,width:.8,depth:.5};
    expect(additionalPlacement(room,[],[],desk,.3,[zone])).toEqual({itemId:'desk',x:.8,z:0,rotation:0});
    expect(additionalPlacement(room,[],[],desk,.3,[{...zone,kind:'obstacle'}])).toBeNull();
  });
  it('never suggests furniture in a fully blocked or malformed area',()=>{
    const room={width:2,depth:2};
    for(const zones of [[{...path,width:2}], [{...path,x:-1}], [{...path,width:NaN}], [{...path,depth:3}]])expect(recommendFurniture(room,[],[],.2,zones).every(o=>o.placement===null)).toBe(true);
    expect(recommendFurniture(null,[],[],.2,[]).every(o=>!o.placement)).toBe(true);
  });
  it('adds independent alternatives without moving existing furniture, and rechecks height and capacity',()=>{
    const room={width:2,depth:2,height:1.3},existing=[{itemId:'desk',x:.8,z:0,rotation:0 as const}];
    const options=recommendFurniture(room,[desk],existing,.15,[path]);
    expect(options.some(o=>o.placement)).toBe(true);expect(options.find(o=>o.item.label==='Wardrobe')?.placement).toBeNull();
    for(const o of options.filter(o=>o.placement))expect(assessRoomLayout(room,[desk,o.item],[...existing,o.placement!],.15,[path]).status).toBe('fits');
    expect(existing).toEqual([{itemId:'desk',x:.8,z:0,rotation:0}]);
  });
  it('counts overlapping reserved areas once and retains malformed-zone failures',()=>{
    const zones=[{...path,width:1},{...path,id:'sofa',x:.5,width:1}];
    const result=assessRoomLayout({width:2,depth:2},[],[],0,zones);expect(result.freeArea).toBe(1);
    expect(assessRoomLayout({width:2,depth:2},[],[],0,[path,path]).status).toBe('unknown');
  });
});
