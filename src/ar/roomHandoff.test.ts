// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { addObject, createScene, createStarterScene } from './scene';
import { consumeRoomHandoff, prepareRoomHandoff, roomScene } from './roomHandoff';

beforeEach(()=>sessionStorage.clear());

describe('room layout handoff',()=>{
  it('preserves current dimensions, quarter turns, heights, and finishes without rearranging',()=>{
    const scene=createStarterScene('workspace');
    scene.room={width:6.2,depth:4.8,height:3.1};
    scene.objects[1].item.color='#abcdef';
    const carried=roomScene('My current layout',scene.room,scene.objects.map(o=>o.item),scene.objects.map(o=>o.placement));
    expect(carried).toEqual({...scene,name:'My current layout'});
    const token=prepareRoomHandoff(carried!);
    expect(consumeRoomHandoff('another route')).toBeNull();
    expect(consumeRoomHandoff(token)).toEqual(carried);
    expect(consumeRoomHandoff(token)).toBeNull();
    carried!.objects[0].item.color='#111111';
    expect(scene.objects[0].item.color).not.toBe('#111111');
  });

  it('includes placed pieces only and rejects unknown, duplicate or out-of-room placements',()=>{
    const scene=createStarterScene('workspace'),items=scene.objects.map(o=>o.item),placements=scene.objects.map(o=>o.placement);
    expect(roomScene('Partial layout',scene.room,items,placements.slice(0,1))?.objects).toEqual(scene.objects.slice(0,1));
    expect(roomScene('Empty',scene.room,items,[])).toBeNull();
    expect(roomScene('Invalid',scene.room,items,[{...placements[0],itemId:'missing'}])).toBeNull();
    expect(roomScene('Invalid',scene.room,items,[placements[0],placements[0]])).toBeNull();
    expect(roomScene('Invalid',scene.room,items,[{...placements[0],x:100}])).toBeNull();
    expect(()=>prepareRoomHandoff({...scene,objects:[]})).toThrow('at least one piece');
  });

  it('validates stored handoffs again and consumes corrupt matching content once',()=>{
    const token=prepareRoomHandoff(createStarterScene('living-room'));
    const key=sessionStorage.key(0)!,value=JSON.parse(sessionStorage.getItem(key)!);
    value.scene.objects[0].placement.x=-100;
    sessionStorage.setItem(key,JSON.stringify(value));
    expect(consumeRoomHandoff(token)).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('preserves wall models, fixture settings, mounts, and room finishes in a prepared handoff',()=>{
    const scene=addObject(addObject(createScene(),'wall-sconce'),'pendant-light');
    scene.finishes={wallColor:'#d7ddca',floorColor:'#b69a77'};
    const token=prepareRoomHandoff(scene),carried=consumeRoomHandoff(token)!;
    expect(carried).toEqual(scene);
    expect(carried.objects[0].placement.mount).toBe('back-wall');
    expect(carried.objects[1].placement.mount).toBe('ceiling');
    expect(carried.objects[0].item.light).not.toBe(scene.objects[0].item.light);
    const fromRoom=roomScene(scene.name,scene.room,scene.objects.map(o=>o.item),scene.objects.map(o=>o.placement));
    expect(fromRoom?.objects).toEqual(scene.objects);
  });
});
