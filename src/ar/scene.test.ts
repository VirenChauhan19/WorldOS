import { afterEach, describe, expect, it, vi } from 'vitest';
import { addObject, createScene, createStarterScene, defaultMount, duplicateObject, loadScene, MAX_SCENE_OBJECTS, mountObject, parseScene, removeObject, resizeScene, saveScene, SCENE_STORAGE_KEY, surfacePlacement, updateObject } from './scene';

afterEach(() => vi.unstubAllGlobals());

describe('editable design scenes', () => {
  it('adds independent instances and retains earlier snapshots for undo', () => {
    const empty = createScene(), first = addObject(empty, 'sofa'), second = addObject(first, 'sofa');
    const before = structuredClone(second);
    const id = second.objects[0].item.id;
    const updated = updateObject(second, id, { item: { width: 2.5, color: '#123456' }, placement: { x: 99, z: -1 } });
    expect(empty.objects).toEqual([]);
    expect(first.objects).toHaveLength(1);
    expect(new Set(second.objects.map(object => object.item.id)).size).toBe(2);
    expect(second).toEqual(before);
    expect(updated.objects[0].item).toMatchObject({ width: 2.5, color: '#123456' });
    expect(updated.objects[0].placement).toMatchObject({ x: 2.5, z: 0 });
    expect(updated.objects[1]).toEqual(before.objects[1]);
  });

  it('rotates at the plan edge without letting the footprint escape and rejects impossible sizes', () => {
    let scene = addObject(createScene('Small plan', { width: 3, depth: 3 }), 'desk');
    const id = scene.objects[0].item.id;
    scene = updateObject(scene, id, { placement: { x: 2.4, z: 2.4, rotation: 90, elevation: .75 } });
    expect(scene.objects[0].placement).toMatchObject({ x: 2.4, z: 1.8, rotation: 90, elevation: .75 });
    expect(() => updateObject(scene, id, { item: { width: NaN } })).toThrow('finite');
    expect(() => updateObject(scene, id, { item: { width: 4 } })).toThrow('larger than this plan');
    expect(() => updateObject(scene, id, { placement: { rotation: 45 as 0 } })).toThrow('quarter turns');
    expect(() => resizeScene(scene, { width: .5, depth: .5 })).toThrow('larger than this plan');
    const clamped = updateObject(scene, id, { item: { height: -2 }, placement: { elevation: 99 } });
    expect(clamped.objects[0].item.height).toBe(.01);
    expect(clamped.objects[0].placement.elevation).toBe(10);
  });

  it('duplicates edited objects with a new identity and removes only the selected instance', () => {
    const original = addObject(createScene(), 'monitor'), id = original.objects[0].item.id;
    const edited = updateObject(original, id, { item: { color: '#abcdef', width: .7 }, placement: { elevation: .8 } });
    const scene = duplicateObject(edited, id);
    expect(scene.objects).toHaveLength(2);
    expect(scene.objects[1].item).toMatchObject({ label: 'Monitor copy', color: '#abcdef', width: .7 });
    expect(scene.objects[1].placement.elevation).toBe(.8);
    expect(scene.objects[1].item.id).not.toBe(id);
    expect(removeObject(scene, id).objects).toEqual([scene.objects[1]]);
    expect(scene.objects).toHaveLength(2);
  });

  it('bounds the collection before allocating more placed objects', () => {
    let scene = createScene();
    for (let index = 0; index < MAX_SCENE_OBJECTS; index++) scene = addObject(scene, 'storage-box');
    expect(() => addObject(scene, 'chair')).toThrow(`up to ${MAX_SCENE_OBJECTS}`);
    expect(() => duplicateObject(scene, scene.objects[0].item.id)).toThrow(`up to ${MAX_SCENE_OBJECTS}`);
  });

  it.each(['living-room', 'workspace'] as const)('creates a valid %s scene with multiple different models', kind => {
    const scene = createStarterScene(kind);
    expect(scene.objects.length).toBeGreaterThan(3);
    expect(new Set(scene.objects.map(object => object.item.kind)).size).toBeGreaterThan(3);
    expect(parseScene(scene)).toEqual(scene);
    if (kind === 'workspace') expect(scene.objects.find(object => object.item.kind === 'monitor')!.placement.elevation).toBe(.75);
  });
});

describe('scene restoration', () => {
  it('round-trips a saved scene without persisting unrelated tracking data', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    const scene = createStarterScene('workspace');
    saveScene({ ...scene, worldTransform: [1, 2, 3] } as typeof scene);
    expect(loadScene()).toEqual(scene);
    expect(store.get(SCENE_STORAGE_KEY)).not.toContain('worldTransform');
    store.set(SCENE_STORAGE_KEY, '{unfinished');
    expect(loadScene()).toBeNull();
  });

  it('rejects duplicate identities, unsupported models, out-of-plan positions, and excessive input', () => {
    const scene = createStarterScene('living-room'), object = scene.objects[0];
    expect(parseScene({ ...scene, objects: [...scene.objects, object] })).toBeNull();
    expect(parseScene({ ...scene, objects: [{ ...object, item: { ...object.item, kind: 'untrusted' } }] })).toBeNull();
    expect(parseScene({ ...scene, objects: [{ ...object, placement: { ...object.placement, x: -1 } }] })).toBeNull();
    expect(parseScene({ ...scene, objects: [{ ...object, placement: { ...object.placement, elevation: Infinity } }] })).toBeNull();
    expect(parseScene({ ...scene, name: 'x'.repeat(81) })).toBeNull();
    expect(parseScene({ ...scene, objects: new Array(MAX_SCENE_OBJECTS + 1).fill(object) })).toBeNull();
  });

  it('reports failed storage instead of claiming a scene was saved', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } });
    expect(loadScene()).toBeNull();
    expect(() => saveScene(createScene())).toThrow('could not be saved');
  });
});

describe('modeled surface placement',()=>{
  it('centers quarter-turned objects on a raised surface and retains all other attributes',()=>{
    let scene=addObject(addObject(createScene(),'desk'),'laptop');
    const [desk,laptop]=scene.objects;
    scene=updateObject(scene,desk.item.id,{placement:{x:2,z:1,rotation:90,elevation:.3}});
    scene=updateObject(scene,laptop.item.id,{placement:{rotation:90}});
    const before=structuredClone(scene),placement=surfacePlacement(scene,laptop.item.id,desk.item.id);
    expect(placement).toEqual({itemId:laptop.item.id,x:2+(.6-.26)/2,z:1+(1.2-.34)/2,rotation:90,elevation:1.05});
    expect(scene).toEqual(before);
    const stacked=updateObject(scene,laptop.item.id,{placement});
    expect(stacked.objects[0]).toEqual(scene.objects[0]);
    expect(stacked.objects[1].item).toEqual(laptop.item);
    expect(parseScene(stacked)).toEqual(stacked);
  });

  it('rejects self support, undersized or unsuitable tops, and ceiling overflow',()=>{
    let scene=addObject(addObject(addObject(createScene(),'side-table'),'desk'),'chair');
    const [table,desk,chair]=scene.objects;
    expect(()=>surfacePlacement(scene,desk.item.id,desk.item.id)).toThrow('another piece');
    expect(()=>surfacePlacement(scene,desk.item.id,table.item.id)).toThrow('too large');
    expect(()=>surfacePlacement(scene,table.item.id,chair.item.id)).toThrow('table, desk');
    scene=updateObject(scene,desk.item.id,{placement:{elevation:2}});
    expect(()=>surfacePlacement(scene,table.item.id,desk.item.id)).toThrow('ceiling');
  });

  it('prevents moving an existing support on top of its own dependent surface',()=>{
    let scene=addObject(addObject(createScene(),'storage-box'),'storage-box');
    const [base,top]=scene.objects;
    scene=updateObject(scene,top.item.id,{placement:surfacePlacement(scene,top.item.id,base.item.id)});
    expect(()=>surfacePlacement(scene,base.item.id,top.item.id)).toThrow('resting on the selected piece');
  });
});

describe('wall and ceiling placement',()=>{
  it.each(['wall-art','wall-mirror','wall-clock','wall-shelf','wall-sconce','curtains','wall-tv'])('adds %s upright against the back wall above floor level',catalogId=>{
    const scene=addObject(createScene(),catalogId),object=scene.objects[0];
    expect(defaultMount(object.item)).toBe('back-wall');
    expect(object.placement).toMatchObject({mount:'back-wall',z:0,rotation:0});
    expect(object.placement.elevation).toBeGreaterThan(0);
    expect((object.placement.elevation??0)+object.item.height).toBeLessThanOrEqual(scene.room.height!);
    expect(parseScene(scene)).toEqual(scene);
  });

  it.each([
    ['back-wall',0,2.175,0],['front-wall',180,2.175,3.955],['left-wall',270,0,1.675],['right-wall',90,4.955,1.675],
  ] as const)('faces inward on %s and stays attached while editing', (mount,rotation,x,z)=>{
    const first=addObject(createScene(),'wall-art'),id=first.objects[0].item.id,before=structuredClone(first);
    const mounted=mountObject(first,id,mount),placement=mounted.objects[0].placement;
    expect(placement.rotation).toBe(rotation);
    expect(placement.x).toBeCloseTo(x);expect(placement.z).toBeCloseTo(z);
    const moved=updateObject(mounted,id,{placement:{x:99,z:99,rotation:180,elevation:1.5}});
    expect(moved.objects[0].placement.rotation).toBe(rotation);
    if(mount==='back-wall')expect(moved.objects[0].placement).toMatchObject({x:4.35,z:0});
    if(mount==='front-wall'){expect(moved.objects[0].placement.x).toBeCloseTo(4.35);expect(moved.objects[0].placement.z).toBeCloseTo(3.955);}
    if(mount==='left-wall')expect(moved.objects[0].placement).toMatchObject({x:0,z:3.35});
    if(mount==='right-wall'){expect(moved.objects[0].placement.x).toBeCloseTo(4.955);expect(moved.objects[0].placement.z).toBeCloseTo(3.35);}
    expect(parseScene(moved)).toEqual(moved);expect(first).toEqual(before);
  });

  it.each(['pendant-light','ceiling-light'])('keeps %s attached when room or fixture height changes',catalogId=>{
    let scene=addObject(createScene(),catalogId),object=scene.objects[0];
    expect(defaultMount(object.item)).toBe('ceiling');
    expect(object.placement.mount).toBe('ceiling');
    expect(object.placement.elevation).toBeCloseTo(2.7-object.item.height);
    scene=updateObject(scene,object.item.id,{item:{height:.9},placement:{x:2,z:1,elevation:0}});
    expect(scene.objects[0].placement).toMatchObject({x:2,z:1,mount:'ceiling'});
    expect(scene.objects[0].placement.elevation).toBeCloseTo(1.8);
    const before=structuredClone(scene);
    scene=resizeScene(scene,{width:4,depth:3,height:3.4});
    expect(scene.objects[0].placement.elevation).toBeCloseTo(2.5);
    expect(parseScene(scene)).toEqual(scene);expect(before.objects[0].placement.elevation).toBeCloseTo(1.8);
    expect(()=>resizeScene(scene,{width:4,depth:3,height:.5})).toThrow('too tall');
  });

  it('retains a wall relationship through room resize and rejects a piece larger than that wall',()=>{
    const first=addObject(createScene(),'wall-art'),id=first.objects[0].item.id;
    const right=mountObject(first,id,'right-wall');
    const resized=resizeScene(right,{width:3,depth:2,height:2.1});
    expect(resized.objects[0].placement.x).toBeCloseTo(2.955);
    expect(resized.objects[0].placement.elevation).toBeCloseTo(1.2);
    expect(parseScene(resized)).toEqual(resized);
    expect(()=>updateObject(resized,id,{item:{width:2.2}})).toThrow('larger than this plan');
    expect(()=>updateObject(resized,id,{item:{height:2.2}})).toThrow('too tall');
    expect(()=>mountObject(resized,id,'invalid' as 'free')).toThrow('supported mounting');
  });

  it('centers on a newly chosen wall while preserving a placement on its current wall',()=>{
    const first=addObject(createScene(),'wall-art'),id=first.objects[0].item.id;
    const edited=updateObject(first,id,{placement:{x:.2,elevation:.9}});
    const unchanged=mountObject(edited,id,'back-wall');
    expect(unchanged.objects[0].placement).toEqual(edited.objects[0].placement);
    const left=mountObject(edited,id,'left-wall');
    expect(left.objects[0].placement).toMatchObject({x:0,z:1.675,elevation:.9,rotation:270});
    const front=mountObject(left,id,'front-wall');
    expect(front.objects[0].placement.x).toBeCloseTo(2.175);
    expect(front.objects[0].placement.elevation).toBe(.9);
  });

  it('duplicates mounting and independent light settings, and explicitly detaches onto modeled surfaces',()=>{
    let scene=addObject(addObject(createScene(),'desk'),'wall-sconce');
    const [desk,sconce]=scene.objects;
    scene=updateObject(scene,sconce.item.id,{item:{light:{enabled:false,temperature:6500,brightness:32}}});
    const duplicate=duplicateObject(scene,sconce.item.id),copy=duplicate.objects[2];
    expect(copy.placement.mount).toBe('back-wall');
    expect(copy.placement.elevation).toBe(sconce.placement.elevation);
    expect(copy.item.light).toEqual(scene.objects[1].item.light);
    expect(copy.item.light).not.toBe(scene.objects[1].item.light);
    expect(copy.placement.x).toBeGreaterThan(sconce.placement.x);
    const placed=updateObject(scene,sconce.item.id,{placement:surfacePlacement(scene,sconce.item.id,desk.item.id)});
    expect(placed.objects[1].placement).toMatchObject({mount:'free',elevation:.75});
    expect(parseScene(placed)).toEqual(placed);
    const freeCopy=duplicateObject(placed,sconce.item.id).objects[2];
    expect(freeCopy.placement.mount).toBe('free');expect(freeCopy.placement.elevation).toBe(.75);
  });

  it('detaches ceiling pieces before floor placement without altering previous undo data',()=>{
    const first=addObject(createScene(),'pendant-light'),id=first.objects[0].item.id,before=structuredClone(first);
    const free=mountObject(first,id,'free');
    const lowered=updateObject(free,id,{placement:{elevation:0}});
    expect(lowered.objects[0].placement).toMatchObject({mount:'free',elevation:0});
    expect(first).toEqual(before);expect(parseScene(first)).toEqual(before);
  });
});

describe('interior metadata restoration',()=>{
  it('round-trips mounts, independent fixture settings, and surface finishes without retaining unknown fields',()=>{
    let scene=addObject(createScene(),'wall-sconce');
    const id=scene.objects[0].item.id;
    scene=updateObject(scene,id,{item:{light:{enabled:true,temperature:4000,brightness:45}}});
    scene.finishes={wallColor:'#e5d8c1',floorColor:'#a48761'};
    const extended=structuredClone(scene) as typeof scene & {worldOrigin:number[]};extended.worldOrigin=[1,2,3];
    const parsed=parseScene(extended)!;
    expect(parsed).toEqual(scene);expect(parsed).not.toHaveProperty('worldOrigin');
    expect(parsed.objects[0].item.light).not.toBe(scene.objects[0].item.light);
    expect(parsed.finishes).not.toBe(scene.finishes);
    const store=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value)});
    saveScene(scene);expect(loadScene()).toEqual(scene);
    expect(parseScene(createStarterScene('living-room'))?.finishes).toBeUndefined();
  });

  it.each([
    {model:'unrecognized'}, {model:null}, {light:null}, {light:{enabled:'yes',temperature:2700,brightness:50}},
    {light:{enabled:true,temperature:2800,brightness:50}}, {light:{enabled:true,temperature:2700,brightness:101}},
    {light:{enabled:true,temperature:2700,brightness:NaN}}, {light:{enabled:true,temperature:2700,brightness:-1}},
  ])('rejects malformed model/light metadata %j',patch=>{
    const scene=addObject(createScene(),'wall-sconce'),object=scene.objects[0];
    expect(parseScene({...scene,objects:[{...object,item:{...object.item,...patch}}]})).toBeNull();
  });

  it('rejects inconsistent mounts and malformed surface finishes',()=>{
    const scene=addObject(createScene(),'wall-art'),object=scene.objects[0];
    for(const patch of [{mount:'unknown'},{mount:null},{rotation:180},{z:.4},{elevation:2.5}])expect(parseScene({...scene,objects:[{...object,placement:{...object.placement,...patch}}]})).toBeNull();
    for(const finishes of [null,{wallColor:'red',floorColor:'#123456'},{wallColor:'#123456'},{wallColor:'#123456',floorColor:'javascript:bad'}])expect(parseScene({...scene,finishes})).toBeNull();
    const ceiling=addObject(createScene(),'ceiling-light'),fixture=ceiling.objects[0];
    expect(parseScene({...ceiling,objects:[{...fixture,placement:{...fixture.placement,elevation:.5}}]})).toBeNull();
  });
});
