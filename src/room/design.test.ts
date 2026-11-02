import { describe, expect, it, vi } from 'vitest';
vi.mock('../api',()=>({request:vi.fn()}));
import { request } from '../api';
import { assessRoomLayout, planRoom } from './layout';
import type { FurnitureItem } from './layout';
import { furnitureMeshes } from './furnitureGeometry';
import { surveyRoom, validDesign } from './design';

const sofa:FurnitureItem={id:'sofa',kind:'sofa',label:'Sofa',width:1.8,depth:.8,height:.8,color:'#718b65'};
describe('photo design geometry',()=>{
  it('honors a feasible placement preference instead of the generic furniture position',()=>{
    const preferred={itemId:'sofa',x:.2,z:1.3,rotation:90 as const};
    const result=planRoom({width:4,depth:5},[sofa],.3,[],[preferred]);
    expect(result.status).toBe('fits');expect(result.placements).toEqual([preferred]);
  });
  it.each([180,270] as const)('preserves seating facing %i degrees in a feasible preference',rotation=>{
    const preferred={itemId:'sofa',x:1,z:2,rotation};
    const result=planRoom({width:4,depth:5},[sofa],.3,[],[preferred]);
    expect(result.placements).toEqual([preferred]);
    expect(assessRoomLayout({width:4,depth:5},[sofa],result.placements,.3).status).toBe('fits');
  });
  it('moves an AI preference away from a door access zone and never accepts overlapping pieces',()=>{
    const room={width:4,depth:5},items=[sofa,{...sofa,id:'second'}];
    const zones=[{id:'door',label:'Door access',kind:'access' as const,x:0,z:0,width:1,depth:5}];
    const result=planRoom(room,items,.3,zones,items.map(i=>({itemId:i.id,x:0,z:0,rotation:0})));
    expect(result.status).toBe('fits');expect(result.placements.every(p=>p.x>=1-1e-8)).toBe(true);
    expect(assessRoomLayout(room,items,result.placements,.3,zones).status).toBe('fits');
  });
  it('retains an oversized requested item as unplaced without shrinking it',()=>{
    const big={...sofa,width:8,depth:8};
    const result=planRoom({width:3,depth:3},[big],.3,[],[{itemId:big.id,x:0,z:0,rotation:0}]);
    expect(result.status).toBe('conflict');expect(result.unplacedIds).toContain(big.id);expect(big.width).toBe(8);
  });
  it.each(['sofa','shelf','plant','custom'] as const)('renders %s geometry inside its declared footprint in all four rotations',kind=>{
    const item={...sofa,kind,width:1.2,depth:.7,height:1.6};
    for(const rotation of [0,90,180,270] as const){
      const meshes=furnitureMeshes(item,{itemId:item.id,x:2,z:3,rotation});
      const vertices=meshes.flatMap(m=>m.vertices);expect(vertices.length).toBeGreaterThan(0);
      vertices.forEach((n,index)=>{expect(Number.isFinite(n)).toBe(true);const axis=index%3;
        expect(n).toBeGreaterThanOrEqual([2,0,3][axis]-1e-8);
        expect(n).toBeLessThanOrEqual([2+(rotation%180===0?item.width:item.depth),item.height,3+(rotation%180===0?item.depth:item.width)][axis]+1e-8);
      });
    }
  });
  it('rejects duplicate or missing design identities and invalid model kinds',()=>{
    const value={title:'Room',summary:'A sofa.',items:[sofa],placements:[{itemId:'sofa',x:0,z:0,rotation:0,reason:'Along the wall.'}],tradeoffs:[]};
    expect(validDesign(value)).toBe(true);
    expect(validDesign({...value,items:[sofa,sofa]})).toBe(false);
    expect(validDesign({...value,placements:[{...value.placements[0],itemId:'unknown'}]})).toBe(false);
    expect(validDesign({...value,items:[{...sofa,kind:'unknown'}]})).toBe(false);
  });
});

it('normalizes an unobserved ceiling height before passing a live survey to the geometry solver',async()=>{
  vi.mocked(request).mockResolvedValue({status:'ready',summary:'An open room.',room:{width:4,depth:5,height:null,width_min:3,width_max:5,depth_min:4,depth_max:6},floor_corners:[{x:.2,y:.4},{x:.8,y:.4},{x:.95,y:.95},{x:.05,y:.95}],evidence:['Door scale assumption.'],uncertainty:'Hidden floor is unknown.',confidence:'low',features:[],zones:[],ideas:[],image_url:'data:image/jpeg;base64,cGhvdG8=',image_width:1000,image_height:750});
  const result=await surveyRoom('data:image/jpeg;base64,cGhvdG8=',new AbortController().signal);
  expect(result.room?.height).toBeUndefined();
  expect(planRoom(result.room,[sofa]).status).toBe('fits');
});
