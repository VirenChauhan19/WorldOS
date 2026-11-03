import { afterEach, describe, expect, it, vi } from 'vitest';
import { addObject, createScene, createStarterScene, duplicateObject, loadScene, MAX_SCENE_OBJECTS, parseScene, removeObject, resizeScene, saveScene, SCENE_STORAGE_KEY, updateObject } from './scene';

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
