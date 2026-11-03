// @vitest-environment jsdom
// Keep scene editing, storage, and the floor plan real; mock only rendering and device APIs.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FurnitureItem, FurniturePlacement, RoomSize } from '../room/layout';
import type { WorldARController, WorldAROptions, WorldARPlacementPose, WorldARSceneObject } from '../live/xr';
import type { NativeARController } from './native';

interface PreviewProps { room: RoomSize; items: FurnitureItem[]; placements: (FurniturePlacement&{mount?:string})[]; selectedId: string;finishes?:{wallColor:string;floorColor:string} }
vi.mock('../room/RoomPreview', () => ({ default: (props: PreviewProps) => <output data-testid="design-preview">{JSON.stringify(props)}</output> }));
vi.mock('./ObjectThumbnail', () => ({ default: () => <span aria-hidden="true"/> }));
vi.mock('../live/xr', () => ({ isWorldARSupported: vi.fn(), startWorldAR: vi.fn() }));
vi.mock('./native', () => ({ nativeARCapabilities: vi.fn(), startNativeInteriorAR: vi.fn() }));
vi.mock('../room/quickLook', () => ({ supportsQuickLook: vi.fn() }));
vi.mock('../room/QuickLookLink', () => ({
  useQuickLookAsset: vi.fn(),
  QuickLookLink: ({ url, unavailableReason }: { url: string; unavailableReason?: string }) => unavailableReason
    ? <button disabled>{unavailableReason}</button>
    : <a href={url}>View in my room</a>,
}));

import { isWorldARSupported, startWorldAR } from '../live/xr';
import { nativeARCapabilities, startNativeInteriorAR } from './native';
import { supportsQuickLook } from '../room/quickLook';
import { useQuickLookAsset } from '../room/QuickLookLink';
import { addObject, createScene, createStarterScene, deleteScene, loadScene, saveScene, SCENE_STORAGE_KEY } from './scene';
import { prepareRoomHandoff } from './roomHandoff';
import { navigate } from '../navigation';
import SceneDesigner from './SceneDesigner';

let options: WorldAROptions;
let pose: WorldARPlacementPose;
let controller: NativeARController;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null,'','#/ar');
  vi.mocked(isWorldARSupported).mockResolvedValue(false);
  vi.mocked(nativeARCapabilities).mockResolvedValue({ supported: false });
  vi.mocked(supportsQuickLook).mockReturnValue(false);
  vi.mocked(useQuickLookAsset).mockReturnValue({ url: 'blob:design', error: '', retry: vi.fn() });
  pose = { position: { x: 1, y: 0, z: 2 }, rotation: 0 };
  controller = {
    setFootprint: vi.fn(), setRoomLayout: vi.fn(), useDetectedSurface: vi.fn(() => false),
    selectPoint: vi.fn(() => true), reset: vi.fn(), end: vi.fn(async () => {}),
    setScene: vi.fn(), setPlacementSurface: vi.fn(), setPlacementPreview: vi.fn(), getPlacementPose: vi.fn(() => pose),
    selectAt: vi.fn(async () => {}),
  };
  vi.mocked(startWorldAR).mockImplementation(async value => {
    options = value;
    value.onState({ phase: 'searching', points: 0, canSelect: true, message: 'Surface found.' });
    return controller;
  });
  vi.mocked(startNativeInteriorAR).mockImplementation(async value => {
    options = value;
    value.onState({ phase: 'ready', points: 0, canSelect: true, message: 'Native surface found.' });
    return controller;
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function preview(): PreviewProps { return JSON.parse(screen.getByTestId('design-preview').textContent!); }
function setField(label: string, value: string, root: ReturnType<typeof within> = screen) {
  const field = root.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}
function selectPiece(name: string) {
  fireEvent.click(within(screen.getByRole('group', { name: 'Objects in your design' })).getByRole('button', { name }));
}
async function renderDesigner() {
  const view = render(<SceneDesigner/>);
  await waitFor(() => expect(isWorldARSupported).toHaveBeenCalledOnce());
  return view;
}
function liveControls() {
  return within(screen.getByRole('group', { name: 'AR scene objects' }).parentElement!);
}
async function startAR() {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Start interactive AR' }))[0]);
  await waitFor(() => expect(controller.setScene).toHaveBeenCalled());
}
function worldObjects(): readonly WorldARSceneObject[] { return vi.mocked(controller.setScene!).mock.calls.at(-1)![0]; }
function quickAsset() { return vi.mocked(useQuickLookAsset).mock.calls.at(-1)!; }

describe('interior design editing', () => {
  it('opens the phone-friendly collection dialog, filters pieces, and returns to the selected addition', async () => {
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add pieces' }));
    const collection = within(screen.getByRole('dialog', { name: 'Add pieces to your design' }));
    fireEvent.click(collection.getByRole('button', { name: 'Lighting' }));
    fireEvent.change(collection.getByRole('searchbox', { name: 'Search objects' }), { target: { value: 'lamp' } });
    expect(collection.getByRole('button', { name: 'Add Floor lamp' })).toBeTruthy();
    expect(collection.getByRole('button', { name: 'Add Table lamp' })).toBeTruthy();
    expect(collection.queryByRole('button', { name: 'Add Chair' })).toBeNull();
    fireEvent.click(collection.getByRole('button', { name: 'Add Table lamp' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(preview().items).toHaveLength(1);
    expect(preview().items[0].label).toBe('Table lamp');
    expect(preview().selectedId).toBe(preview().items[0].id);
  });

  it('adds independent instances and applies dimensions, finish, and rotation only to the selected piece', async () => {
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    const before = preview();
    expect(new Set(before.items.map(item => item.id)).size).toBe(2);
    setField('Object name', 'Reading chair');
    setField('Object width', '.8');
    setField('Object depth', '.6');
    setField('Object height', '1.1');
    fireEvent.click(screen.getByRole('button', { name: 'Oak finish' }));
    fireEvent.click(screen.getByRole('button', { name: /Rotate 90/ }));

    const after = preview();
    expect(after.items[0]).toEqual(before.items[0]);
    expect(after.placements[0]).toEqual(before.placements[0]);
    expect(after.items[1]).toMatchObject({ id: before.items[1].id, label: 'Reading chair', width: .8, depth: .6, height: 1.1, color: '#bf9b73' });
    expect(after.placements[1].rotation).toBe(90);
    expect(after.selectedId).toBe(after.items[1].id);

    fireEvent.click(screen.getByRole('button', { name: 'Undo design change' }));
    expect(preview().placements[1].rotation).toBe(0);
    expect(preview().items[1].color).toBe('#bf9b73');
    fireEvent.click(screen.getByRole('button', { name: 'Redo design change' }));
    expect(preview().placements[1].rotation).toBe(90);
  });

  it('duplicates an edited piece independently and can undo and redo removing the copy', async () => {
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Desk' }));
    setField('Object width', '1.6');
    fireEvent.click(screen.getByRole('button', { name: 'Cloud finish' }));
    const original = preview().items[0];
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    const copy = preview().items[1];
    expect(copy).toMatchObject({ label: 'Desk copy', width: original.width, height: original.height, color: original.color });
    expect(copy.id).not.toBe(original.id);
    setField('Object height', '.9');
    expect(preview().items[0]).toEqual(original);
    const beforeRemoval = preview();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Desk copy' }));
    expect(preview().items).toEqual([original]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo design change' }));
    expect(preview().items).toEqual(beforeRemoval.items);
    expect(preview().placements).toEqual(beforeRemoval.placements);
    fireEvent.click(screen.getByRole('button', { name: 'Redo design change' }));
    expect(preview().items).toEqual([original]);
    selectPiece('Desk');
    fireEvent.click(screen.getByRole('button', { name: 'Clay finish' }));
    expect((screen.getByRole('button', { name: 'Redo design change' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the edited plan locally and restores it after reopening', async () => {
    const view = await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Monitor' }));
    setField('Design name', 'Home office');
    setField('Object width', '.7');
    setField('Position from left', '1.2');
    setField('Position from back', '.4');
    setField('Height off floor', '.75');
    const saved = preview();
    await waitFor(() => {
      expect(loadScene()?.name).toBe('Home office');
      expect(loadScene()?.objects[0].placement).toEqual(saved.placements[0]);
    });
    view.unmount();
    render(<SceneDesigner/>);
    expect((screen.getByLabelText('Design name') as HTMLInputElement).value).toBe('Home office');
    expect(preview().items).toEqual(saved.items);
    expect(preview().placements).toEqual(saved.placements);
    expect(preview().room).toEqual(saved.room);
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).not.toContain('position');
  });

  it('moves a focused floor-plan piece with arrow keys and restores that edit with undo', async () => {
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Desk' }));
    const before = preview();
    fireEvent.click(screen.getByRole('button', { name: /^Floor plan/ }));
    const chair = screen.getByRole('button', { name: 'Move Chair in floor plan' });
    fireEvent.focus(chair);
    fireEvent.keyDown(chair, { key: 'ArrowRight' });
    expect((screen.getByLabelText('Position from left') as HTMLInputElement).value).toBe('0.1');
    fireEvent.click(screen.getByRole('button', { name: '3D studio' }));
    expect(preview().placements[0].x).toBeCloseTo(before.placements[0].x + .1);
    expect(preview().placements[1]).toEqual(before.placements[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo design change' }));
    expect(preview().placements).toEqual(before.placements);
  });

  it('records one undo step for a complete floor-plan drag', async () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
    });
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    const before = preview();
    fireEvent.click(screen.getByRole('button', { name: /^Floor plan/ }));
    const floor = screen.getByRole('group', { name: 'Arrange objects in floor plan' });
    Object.defineProperties(floor, {
      getScreenCTM: { value: () => ({ inverse: () => ({}) }) },
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x / 100, y: this.y / 100 }; } }) },
    });
    const chair = screen.getByRole('button', { name: 'Move Chair in floor plan' });
    Object.defineProperty(chair, 'setPointerCapture', { value: vi.fn() });
    fireEvent.pointerDown(chair, { pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(floor, { pointerId: 1, clientX: 100, clientY: 80 });
    fireEvent.pointerMove(floor, { pointerId: 1, clientX: 150, clientY: 130 });
    fireEvent.pointerUp(floor, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: '3D studio' }));
    expect(preview().placements[0]).toMatchObject({ x: 1.3, z: 1.1 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo design change' }));
    expect(preview().placements).toEqual(before.placements);
    expect(preview().items).toEqual(before.items);
    fireEvent.click(screen.getByRole('button', { name: 'Redo design change' }));
    expect(preview().placements[0]).toMatchObject({ x: 1.3, z: 1.1 });
  });

  it('reports an object that is larger than the plan and keeps the last valid design editable', async () => {
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Desk' }));
    const before = preview();
    setField('Object width', '6');
    expect(screen.getByRole('alert').textContent).toContain('larger than this plan');
    expect(preview().items).toEqual(before.items);
    expect(preview().placements).toEqual(before.placements);
    setField('Object width', '1.5');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(preview().items[0].width).toBe(1.5);
  });

  it('requires the new-design action before clearing pieces and allows undoing the replacement', async () => {
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Sofa' }));
    const before = preview();
    fireEvent.click(screen.getByText(/Plan size & design files/));
    fireEvent.click(screen.getByRole('button', { name: 'New design' }));
    const dialog = screen.getByRole('dialog', { name: 'Start a new design?' });
    expect(preview().items).toEqual(before.items);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start a blank design' }));
    expect(preview().items).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo design change' }));
    expect(preview().items).toEqual(before.items);
    expect(preview().placements).toEqual(before.placements);
  });
});

describe('saving across lifecycle transitions', () => {
  const transitions = ['deactivate', 'hidden', 'pagehide', 'unmount'] as const;
  function leave(view: ReturnType<typeof render>, transition: typeof transitions[number]) {
    if (transition === 'deactivate') view.rerender(<SceneDesigner active={false}/>);
    else if (transition === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      fireEvent(document, new Event('visibilitychange'));
    } else if (transition === 'pagehide') fireEvent(window, new Event('pagehide'));
    else view.unmount();
  }

  it.each(transitions)('preserves newer storage from another tab when a clean editor receives %s', async transition => {
    vi.useFakeTimers();
    saveScene(createScene('Original design'));
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<SceneDesigner/>); });
    expect(screen.getByText('Saved on this device')).toBeTruthy();
    const newer = createScene('Saved in another tab', { width: 7, depth: 6, height: 3 });
    saveScene(newer);
    leave(view, transition);
    expect(loadScene()).toEqual(newer);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(loadScene()).toEqual(newer);
  });

  it.each(transitions)('flushes pending edits before the debounce on %s and retires the pending write', async transition => {
    vi.useFakeTimers();
    saveScene(createScene('Original design'));
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<SceneDesigner/>); });
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    const edited = preview();
    expect(loadScene()?.objects).toEqual([]);
    leave(view, transition);
    expect(loadScene()?.objects.map(object => object.item)).toEqual(edited.items);
    expect(loadScene()?.objects.map(object => object.placement)).toEqual(edited.placements);
    const newer = createScene('Saved later in another tab');
    saveScene(newer);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(loadScene()).toEqual(newer);
  });

  it('flushes undo and redo after the preceding edit was already saved', async () => {
    vi.useFakeTimers();
    saveScene(createScene());
    await act(async () => { render(<SceneDesigner/>); });
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    act(() => { vi.advanceTimersByTime(300); });
    expect(loadScene()?.objects).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Undo design change' }));
    fireEvent(window, new Event('pagehide'));
    expect(loadScene()?.objects).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Redo design change' }));
    fireEvent(window, new Event('pagehide'));
    expect(loadScene()?.objects).toHaveLength(1);
  });

  it('keeps a failed save dirty so a lifecycle flush can retry it', async () => {
    vi.useFakeTimers();
    saveScene(createScene());
    await act(async () => { render(<SceneDesigner/>); });
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
    expect(loadScene()?.objects).toEqual([]);
    fireEvent(window, new Event('pagehide'));
    expect(loadScene()?.objects).toHaveLength(1);
  });
});

describe('continuing a room layout',()=>{
  it('checks a new handoff against the latest saved design when the cached studio reopens',async()=>{
    saveScene(addObject(createScene('Old saved design'),'chair'));
    const view=await renderDesigner();view.rerender(<SceneDesigner active={false}/>);
    const newer=addObject(createScene('Latest saved design'),'desk'),incoming=createStarterScene('workspace');
    saveScene(newer);
    act(()=>navigate('ar',{handoff:prepareRoomHandoff(incoming)}));
    view.rerender(<SceneDesigner active/>);
    const dialog=screen.getByRole('dialog',{name:'Open your room layout?'});
    expect(dialog.textContent).toContain('Latest saved design');
    expect(preview().items).toEqual(newer.objects.map(object=>object.item));
    fireEvent.click(within(dialog).getByRole('button',{name:'Keep current design'}));
    expect(preview().items).toEqual(newer.objects.map(object=>object.item));
    expect(loadScene()).toEqual(newer);
  });

  it('accepts an explicit new room after an unseen deletion without making the deleted design undoable',async()=>{
    saveScene(addObject(createScene('Removed in another tab'),'chair'));
    await renderDesigner();
    localStorage.removeItem(SCENE_STORAGE_KEY);
    const incoming=createStarterScene('workspace');
    act(()=>navigate('ar',{handoff:prepareRoomHandoff(incoming)}));
    fireEvent.click(screen.getByRole('button',{name:'Use room layout'}));
    fireEvent(window,new Event('pagehide'));
    expect(loadScene()).toEqual(incoming);
    fireEvent(window,new StorageEvent('storage',{key:SCENE_STORAGE_KEY,newValue:null}));
    expect(preview().items).toEqual(incoming.objects.map(object=>object.item));
    fireEvent.click(screen.getByRole('button',{name:'Undo design change'}));
    expect(preview().items).toEqual([]);
  });

  it('opens a layout in a blank studio, preserving its dimensions, finishes and placements',async()=>{
    const incoming=createStarterScene('workspace');incoming.name='Photo room';incoming.room={width:6,depth:4.5,height:3};incoming.objects[0].item.color='#123456';
    navigate('ar',{handoff:prepareRoomHandoff(incoming)});
    const view=await renderDesigner();
    expect(preview().room).toEqual(incoming.room);
    expect(preview().items).toEqual(incoming.objects.map(object=>object.item));
    expect(preview().placements).toEqual(incoming.objects.map(object=>object.placement));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount();
    expect(loadScene()).toEqual(incoming);
  });

  it('lets a cached editor cancel a replacement once, then explicitly confirm another and undo it',async()=>{
    const old=addObject(createScene('My existing design'),'chair'),incoming=createStarterScene('workspace');
    saveScene(old);
    const view=await renderDesigner();
    view.rerender(<SceneDesigner active={false}/>);
    act(()=>navigate('ar',{handoff:prepareRoomHandoff(incoming)}));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<SceneDesigner active/>);
    const dialog=screen.getByRole('dialog',{name:'Open your room layout?'});
    expect(preview().items).toEqual(old.objects.map(object=>object.item));
    fireEvent.click(within(dialog).getByRole('button',{name:'Keep current design'}));
    view.rerender(<SceneDesigner active={false}/>);view.rerender(<SceneDesigner active/>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(loadScene()).toEqual(old);
    act(()=>navigate('ar',{handoff:prepareRoomHandoff(incoming)}));
    fireEvent.click(within(screen.getByRole('dialog',{name:'Open your room layout?'})).getByRole('button',{name:'Use room layout'}));
    expect(preview().items).toEqual(incoming.objects.map(object=>object.item));
    fireEvent(window,new Event('pagehide'));
    expect(loadScene()).toEqual(incoming);
    fireEvent.click(screen.getByRole('button',{name:'Undo design change'}));
    expect(preview().items).toEqual(old.objects.map(object=>object.item));
    view.unmount();
    expect(loadScene()).toEqual(old);
  });
});

describe('reopening a cached studio',()=>{
  it('opens the latest saved scene and retires history from the previously opened design',async()=>{
    vi.useFakeTimers();
    saveScene(addObject(createScene('Earlier design'),'chair'));
    let view!:ReturnType<typeof render>;
    await act(async()=>{view=render(<SceneDesigner/>);});
    fireEvent.click(screen.getByRole('button',{name:'Add Laptop'}));
    act(()=>{vi.advanceTimersByTime(300);});
    view.rerender(<SceneDesigner active={false}/>);
    const newer=addObject(createScene('Updated elsewhere',{width:6,depth:5,height:3}),'desk');
    newer.objects[0].item.color='#123456';newer.objects[0].placement.x=2;
    saveScene(newer);
    view.rerender(<SceneDesigner active/>);
    expect(preview().room).toEqual(newer.room);
    expect(preview().items).toEqual(newer.objects.map(object=>object.item));
    expect(preview().placements).toEqual(newer.objects.map(object=>object.placement));
    expect((screen.getByRole('button',{name:'Undo design change'}) as HTMLButtonElement).disabled).toBe(true);
    act(()=>{vi.advanceTimersByTime(1000);});
    expect(loadScene()).toEqual(newer);
  });

  it('preserves dirty edits if the prior save failed instead of replacing them from storage',async()=>{
    vi.useFakeTimers();
    saveScene(addObject(createScene('Original design'),'chair'));
    let view!:ReturnType<typeof render>;
    await act(async()=>{view=render(<SceneDesigner/>);});
    fireEvent.click(screen.getByRole('button',{name:'Add Laptop'}));
    const edited=preview();
    const failing=vi.spyOn(Storage.prototype,'setItem').mockImplementationOnce(()=>{throw new Error('Storage full');});
    view.rerender(<SceneDesigner active={false}/>);
    failing.mockRestore();
    const newer=addObject(createScene('Saved elsewhere'),'desk');saveScene(newer);
    view.rerender(<SceneDesigner active/>);
    expect(preview().items).toEqual(edited.items);
    expect(preview().placements).toEqual(edited.placements);
    expect((screen.getByRole('button',{name:'Undo design change'}) as HTMLButtonElement).disabled).toBe(false);
    act(()=>{vi.advanceTimersByTime(300);});
    expect(loadScene()?.objects.map(object=>object.item)).toEqual(edited.items);
  });
});

describe('deleting a cached design',()=>{
  it('does not restore a removed design if the storage event has not arrived before a lifecycle flush',async()=>{
    saveScene(addObject(createScene('Deleted elsewhere'),'desk'));
    await renderDesigner();
    fireEvent.click(screen.getByRole('button',{name:'Add Laptop'}));
    localStorage.removeItem(SCENE_STORAGE_KEY);
    fireEvent(window,new Event('pagehide'));
    expect(preview().items).toEqual([]);
    expect(loadScene()).toBeNull();
  });

  it.each(['same tab','another tab'] as const)('retires pending saves and history after deletion in %s',async source=>{
    vi.useFakeTimers();
    saveScene(addObject(createScene('Delete me'),'desk'));
    let view!:ReturnType<typeof render>;
    await act(async()=>{view=render(<SceneDesigner/>);});
    fireEvent.click(screen.getByRole('button',{name:'Add Laptop'}));
    act(()=>{
      if(source==='same tab')deleteScene();
      else{localStorage.removeItem(SCENE_STORAGE_KEY);window.dispatchEvent(new StorageEvent('storage',{key:SCENE_STORAGE_KEY,newValue:null}));}
    });
    expect(preview().items).toEqual([]);
    expect((screen.getByRole('button',{name:'Undo design change'}) as HTMLButtonElement).disabled).toBe(true);
    act(()=>{vi.advanceTimersByTime(1000);});
    fireEvent(window,new Event('pagehide'));view.unmount();
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBeNull();
    render(<SceneDesigner/>);
    expect(preview().items).toEqual([]);
    act(()=>{vi.advanceTimersByTime(1000);});
    expect(localStorage.getItem(SCENE_STORAGE_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Add Chair'}));
    fireEvent(window,new Event('pagehide'));
    expect(loadScene()?.objects.map(object=>object.item.label)).toEqual(['Chair']);
  });
});

describe('placing pieces on modeled surfaces',()=>{
  it('keeps a plan-only surface operation out of the tracked scene until the user places the full design',async()=>{
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    await renderDesigner();
    fireEvent.click(screen.getByRole('button',{name:'Add Desk'}));
    fireEvent.click(screen.getByRole('button',{name:'Add Laptop'}));
    const [desk]=preview().items;
    await startAR();
    fireEvent.change(liveControls().getByRole('combobox',{name:'Supporting surface'}),{target:{value:desk.id}});
    fireEvent.click(liveControls().getByRole('button',{name:'Place on top'}));
    expect(worldObjects()).toEqual([]);
    expect(preview().placements[1].elevation).toBe(.75);
    fireEvent.click(liveControls().getByRole('button',{name:'Place full design'}));
    expect(worldObjects()).toHaveLength(2);
    expect(worldObjects()[1].position.y-worldObjects()[0].position.y).toBe(.75);
  });

  it('centers a laptop on a desk, supports floor placement and undo, and excludes undersized tops',async()=>{
    await renderDesigner();
    fireEvent.click(screen.getByRole('button',{name:'Add Desk'}));
    setField('Position from left','1.5');setField('Position from back','.8');
    fireEvent.click(screen.getByRole('button',{name:'Add Laptop'}));
    const before=preview();
    fireEvent.change(screen.getByRole('combobox',{name:'Supporting surface'}),{target:{value:before.items[0].id}});
    fireEvent.click(screen.getByRole('button',{name:'Place on top'}));
    expect(preview().placements[1]).toMatchObject({x:1.5+(1.2-.34)/2,z:.8+(.6-.26)/2,elevation:.75});
    expect(preview().items).toEqual(before.items);
    fireEvent.click(screen.getByRole('button',{name:'Move to floor'}));
    expect(preview().placements[1].elevation).toBe(0);
    fireEvent.click(screen.getByRole('button',{name:'Undo design change'}));
    expect(preview().placements[1].elevation).toBe(.75);
    fireEvent.click(screen.getByRole('button',{name:'Undo design change'}));
    expect(preview().placements).toEqual(before.placements);
    fireEvent.click(screen.getByRole('button',{name:'Add Side table'}));
    selectPiece('Desk');
    expect((screen.getByRole('option',{name:'Side table · Does not fit'}) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole('button',{name:'Place on top'}) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(['WebXR','native'] as const)('anchors an unplaced piece to a placed table in %s and restores both scene and poses with undo',async runtime=>{
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    vi.mocked(nativeARCapabilities).mockResolvedValue({supported:runtime==='native'});
    await renderDesigner();
    fireEvent.click(screen.getByRole('button',{name:'Add Desk'}));
    fireEvent.click(screen.getByRole('button',{name:'Add Laptop'}));
    const [desk,laptop]=preview().items;
    await startAR();
    act(()=>options.onObjectSelect?.(desk.id));
    fireEvent.click(liveControls().getByRole('button',{name:'Place this object'}));
    pose={position:{x:2,y:.4,z:3},rotation:0};
    fireEvent.click(liveControls().getByRole('button',{name:'Place here'}));
    const placedDesk=worldObjects()[0];
    act(()=>options.onObjectSelect?.(laptop.id));
    fireEvent.change(liveControls().getByRole('combobox',{name:'Supporting surface'}),{target:{value:desk.id}});
    fireEvent.click(liveControls().getByRole('button',{name:'Place on top'}));
    expect(worldObjects()).toHaveLength(2);
    expect(worldObjects()[0]).toEqual(placedDesk);
    expect(worldObjects()[1].position).toEqual({x:2,y:1.15,z:3});
    fireEvent.click(screen.getByRole('button',{name:'Undo AR change'}));
    expect(worldObjects()).toEqual([placedDesk]);
    fireEvent.click(screen.getByRole('button',{name:'Redo AR change'}));
    expect(worldObjects()[1].position).toEqual({x:2,y:1.15,z:3});
    fireEvent.click(liveControls().getByRole('button',{name:'Move to floor'}));
    expect(worldObjects()[1].position.y).toBeCloseTo(.4);
  });
});

describe('interactive AR editing', () => {
  it('starts free placement, adds distinct objects, and moves only the selected object', async () => {
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    await renderDesigner();
    await startAR();
    expect(options.interactionMode).toBe('place');
    expect(options.measurementMode).toBeUndefined();
    expect(worldObjects()).toEqual([]);
    // The native AR engine excludes these whole UI regions from placement rays,
    // including their padding and labels as well as the individual buttons.
    expect(screen.getByText('LIVE AR STUDIO').closest('[data-xr-ui]')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'AR scene objects' }).parentElement!.hasAttribute('data-xr-ui')).toBe(true);
    fireEvent.click(liveControls().getByRole('button', { name: 'Add Chair' }));
    expect(worldObjects()).toEqual([]);
    expect(vi.mocked(controller.setPlacementPreview!).mock.calls.at(-1)![0]?.label).toBe('Chair');
    fireEvent.click(liveControls().getByRole('button', { name: 'Place here' }));
    const chair = worldObjects()[0];
    expect(chair.position).toEqual(pose.position);
    fireEvent.click(liveControls().getByRole('button', { name: 'Add object' }));
    fireEvent.click(liveControls().getByRole('button', { name: 'Add Floor lamp' }));
    pose = { position: { x: 2, y: .5, z: 2.5 }, rotation: 0 };
    fireEvent.click(liveControls().getByRole('button', { name: 'Place here' }));
    const lamp = worldObjects()[1];
    expect(worldObjects()).toHaveLength(2);
    expect(lamp.id).not.toBe(chair.id);
    expect(lamp.position).toEqual(pose.position);
    expect(worldObjects()[0]).toEqual(chair);

    act(() => options.onObjectSelect?.(chair.id));
    expect(liveControls().getByRole('textbox', { name: 'Object name' }).getAttribute('value')).toBe('Chair');
    expect(vi.mocked(controller.setScene!).mock.calls.at(-1)![1]).toBe(chair.id);
    fireEvent.click(liveControls().getByRole('button', { name: 'Move to a new spot' }));
    pose = { position: { x: 1.4, y: 0, z: 2.8 }, rotation: 0 };
    act(() => options.onPlace?.(pose));
    expect(worldObjects().find(object => object.id === chair.id)?.position).toEqual(pose.position);
    expect(worldObjects().find(object => object.id === lamp.id)).toEqual(lamp);
    fireEvent.click(liveControls().getByRole('button', { name: 'Remove Chair' }));
    expect(worldObjects()).toEqual([lamp]);
  });

  it('keeps live placement synchronized with plan edits and undo', async () => {
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    await renderDesigner();
    await startAR();
    fireEvent.click(liveControls().getByRole('button', { name: 'Add Desk' }));
    fireEvent.click(liveControls().getByRole('button', { name: 'Place here' }));
    const initial = worldObjects()[0];
    fireEvent.click(liveControls().getByRole('button', { name: 'Move object right' }));
    expect(worldObjects()[0].position.x).toBeCloseTo(initial.position.x + .1);
    expect(worldObjects()[0].position.z).toBeCloseTo(initial.position.z);
    setField('Height off floor', '.75', liveControls());
    expect(worldObjects()[0].position.y).toBeCloseTo(initial.position.y + .75);
    fireEvent.click(screen.getByRole('button', { name: 'Undo design change' }));
    expect(worldObjects()[0].position.y).toBeCloseTo(initial.position.y);
    expect(worldObjects()[0].position.x).toBeCloseTo(initial.position.x + .1);
    fireEvent.click(screen.getByRole('button', { name: 'Undo design change' }));
    expect(worldObjects()[0].position).toEqual(initial.position);
  });

  it('keeps the editable design but discards session poses when AR exits and restarts', async () => {
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    await renderDesigner();
    await startAR();
    fireEvent.click(liveControls().getByRole('button', { name: 'Add Chair' }));
    fireEvent.click(liveControls().getByRole('button', { name: 'Place here' }));
    expect(worldObjects()).toHaveLength(1);
    const firstSignal = options.signal;
    fireEvent.click(screen.getByRole('button', { name: 'Exit interactive AR' }));
    expect(controller.end).toHaveBeenCalledOnce();
    expect(firstSignal?.aborted).toBe(true);
    expect(preview().items).toHaveLength(1);
    vi.mocked(controller.setScene!).mockClear();
    await startAR();
    expect(worldObjects()).toEqual([]);
    expect(liveControls().getByRole('button', { name: /Chair\s*Ready to place/ })).toBeTruthy();
    expect(options.signal).not.toBe(firstSignal);
    expect(options.signal?.aborted).toBe(false);
  });

  it('clears live placements after a tracking-origin reset and allows placing the full design again', async () => {
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Desk' }));
    await startAR();
    fireEvent.click(liveControls().getByRole('button', { name: 'Place full design' }));
    expect(worldObjects()).toHaveLength(2);
    setField('Height off floor', '.1', liveControls());
    act(() => options.onSceneReset?.());
    // The XR engine clears its scene before notifying the editor. A later selection
    // must not repopulate that new reference space with the old session coordinates.
    fireEvent.click(liveControls().getByRole('button', { name: /Chair\s*Ready to place/ }));
    expect(worldObjects()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo AR change' }));
    expect(worldObjects()).toEqual([]);
    pose = { position: { x: 3, y: .4, z: 5 }, rotation: 0 };
    fireEvent.click(liveControls().getByRole('button', { name: 'Place full design' }));
    expect(worldObjects()).toHaveLength(2);
    expect(worldObjects().every(object => object.position.y === .4)).toBe(true);
  });

  it('ends a session that finishes starting after the editor becomes inactive', async () => {
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    let finishStart!: (value: WorldARController) => void;
    vi.mocked(startWorldAR).mockImplementationOnce(value => {
      options = value;
      return new Promise<WorldARController>(resolve => { finishStart = resolve; });
    });
    const view = await renderDesigner();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Start interactive AR' }))[0]);
    expect(screen.getByRole('button', { name: 'Exit interactive AR' })).toBeTruthy();
    view.rerender(<SceneDesigner active={false}/>);
    expect(options.signal?.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Exit interactive AR' })).toBeNull();
    await act(async () => { finishStart(controller); });
    expect(controller.end).toHaveBeenCalledOnce();
    expect(controller.setScene).not.toHaveBeenCalled();
  });

  it('returns to the editable design and exposes the reason when AR cannot start', async () => {
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    vi.mocked(startWorldAR).mockRejectedValueOnce(new Error('Camera permission was denied.'));
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Start interactive AR' }))[0]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Camera permission was denied.'));
    expect(screen.queryByRole('button', { name: 'Exit interactive AR' })).toBeNull();
    expect(preview().items).toHaveLength(1);
    setField('Object width', '.7');
    expect(preview().items[0].width).toBe(.7);
  });
});

describe('native iPhone studio integration', () => {
  it('prefers the native engine when both runtimes are available and keeps the shared editing controls live', async () => {
    vi.mocked(nativeARCapabilities).mockResolvedValue({ supported: true, cameraPermission: 'prompt' });
    vi.mocked(isWorldARSupported).mockResolvedValue(true);
    await renderDesigner();
    expect(startNativeInteriorAR).not.toHaveBeenCalled();
    await startAR();
    expect(startNativeInteriorAR).toHaveBeenCalledOnce();
    expect(startWorldAR).not.toHaveBeenCalled();
    expect(screen.getByText('IPHONE AR STUDIO')).toBeTruthy();
    fireEvent.click(liveControls().getByRole('button', { name: 'Add Chair' }));
    fireEvent.click(liveControls().getByRole('button', { name: 'Place here' }));
    expect(worldObjects()[0].position).toEqual(pose.position);
    setField('Object width', '.7', liveControls());
    expect(worldObjects()).toHaveLength(1);
    expect(worldObjects()[0].item.width).toBe(.7);
    expect(worldObjects()[0].position.x).toBeCloseTo(pose.position.x + .1);
  });

  it('normalizes camera taps and keyboard picks without sending control-panel touches through to native objects', async () => {
    vi.mocked(nativeARCapabilities).mockResolvedValue({ supported: true });
    vi.stubGlobal('PointerEvent', MouseEvent);
    await renderDesigner(); await startAR();
    const camera = screen.getByRole('button', { name: 'Select an object in the AR view' });
    vi.spyOn(camera, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 400, height: 800 } as DOMRect);
    fireEvent.pointerUp(camera, { clientX: 110, clientY: 620 });
    expect(controller.selectAt).toHaveBeenLastCalledWith(.25, .75);
    fireEvent.keyDown(camera, { key: 'Enter' });
    expect(controller.selectAt).toHaveBeenLastCalledWith(.5, .5);
    const panel = screen.getByText('IPHONE AR STUDIO').closest('[data-xr-ui]')!;
    fireEvent.pointerUp(panel, { clientX: 110, clientY: 620 });
    fireEvent.pointerUp(liveControls().getByRole('button', { name: 'Add Chair' }), { clientX: 110, clientY: 620 });
    expect(controller.selectAt).toHaveBeenCalledTimes(2);
  });

  it('shows native permission guidance, allows retry, and releases the session when the editor becomes inactive', async () => {
    vi.mocked(nativeARCapabilities).mockResolvedValue({ supported: true, cameraPermission: 'prompt' });
    vi.mocked(startNativeInteriorAR).mockRejectedValueOnce({ code: 'CAMERA_PERMISSION_DENIED', message: 'Allow Camera access for WorldOS in Settings to use AR.' });
    const view = await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Chair' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Start interactive AR' }))[0]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Allow Camera access for WorldOS in Settings'));
    expect(screen.queryByRole('button', { name: 'Select an object in the AR view' })).toBeNull();
    expect(preview().items).toHaveLength(1);
    await startAR();
    const signal = options.signal;
    view.rerender(<SceneDesigner active={false}/>);
    expect(signal?.aborted).toBe(true);
    expect(controller.end).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Select an object in the AR view' })).toBeNull();
    expect(preview().items).toHaveLength(1);
  });

  it('discards a native start that finishes after navigation cancels its permission request', async () => {
    vi.mocked(nativeARCapabilities).mockResolvedValue({ supported: true });
    let finish!: (value: NativeARController) => void;
    vi.mocked(startNativeInteriorAR).mockImplementationOnce(value => {
      options = value;
      return new Promise<NativeARController>(resolve => { finish = resolve; });
    });
    const view = await renderDesigner();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Start interactive AR' }))[0]);
    view.rerender(<SceneDesigner active={false}/>);
    expect(options.signal?.aborted).toBe(true);
    await act(async () => { finish(controller); });
    expect(controller.end).toHaveBeenCalledOnce();
    expect(controller.setScene).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Select an object in the AR view' })).toBeNull();
  });
});

describe('native AR preview scope', () => {
  it('grounds one selected piece without changing its plan, and never falls back to exporting other pieces after removal', async () => {
    vi.mocked(supportsQuickLook).mockReturnValue(true);
    await renderDesigner();
    fireEvent.click(screen.getByRole('button', { name: 'Add Desk' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Monitor' }));
    setField('Position from left', '1.4');
    setField('Position from back', '.3');
    setField('Height off floor', '.75');
    fireEvent.click(screen.getByRole('button', { name: /Rotate 90/ }));
    const plan = preview();
    expect(quickAsset()[0]).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'AR preview selection' }), { target: { value: 'selected' } });
    expect(quickAsset()[0]).toEqual([plan.items[1]]);
    expect(quickAsset()[1]).toEqual([{ ...plan.placements[1], x: 0, z: 0, elevation: 0 }]);
    expect(quickAsset()[2]).toBe(true);
    expect(preview().placements).toEqual(plan.placements);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Monitor' }));
    expect(preview().items).toEqual([plan.items[0]]);
    expect(quickAsset()[0]).toEqual([]);
    expect(quickAsset()[1]).toEqual([]);
    expect(quickAsset()[2]).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'AR preview selection' }), { target: { value: 'all' } });
    expect(quickAsset()[0]).toEqual([plan.items[0]]);
    expect(quickAsset()[1]).toEqual([plan.placements[0]]);
  });
});


describe('walls, ceilings, and lighting',()=>{
  it('mounts a wall piece, preserves its height while switching walls, and keeps its face inward',async()=>{
    const view=await renderDesigner();
    fireEvent.click(screen.getByRole('button',{name:'Add Framed artwork'}));
    expect(screen.getByLabelText('Mounting surface')).toHaveProperty('value','back-wall');
    expect(preview().items[0].model).toBe('wall-art');
    setField('Mounting height','1.35');
    fireEvent.change(screen.getByLabelText('Mounting surface'),{target:{value:'right-wall'}});
    expect(preview().placements[0]).toMatchObject({mount:'right-wall',rotation:90,elevation:1.35});
    expect(preview().placements[0].x+preview().items[0].depth).toBeCloseTo(preview().room.width);
    expect(screen.getByLabelText('Position from left')).toHaveProperty('disabled',true);
    expect(screen.getByRole('button',{name:/Rotate 90/})).toHaveProperty('disabled',true);
    fireEvent.click(screen.getByRole('button',{name:'Undo design change'}));
    expect(preview().placements[0].mount).toBe('back-wall');
    view.rerender(<SceneDesigner active={false}/>);
    expect(loadScene()?.objects[0].placement).toMatchObject({mount:'back-wall',elevation:1.35});
  });

  it('hangs a pendant from the ceiling and saves editable light settings independently',async()=>{
    const view=await renderDesigner();
    fireEvent.click(screen.getByRole('button',{name:'Add Pendant light'}));
    expect(preview().placements[0].mount).toBe('ceiling');
    expect(preview().placements[0].elevation!+preview().items[0].height).toBeCloseTo(2.7);
    expect(screen.getByLabelText('Height off floor')).toHaveProperty('disabled',true);
    fireEvent.click(screen.getByRole('button',{name:'Cool light'}));
    fireEvent.change(screen.getByRole('slider',{name:'Light brightness'}),{target:{value:'35'}});
    fireEvent.click(screen.getByRole('switch',{name:'Fixture light'}));
    expect(preview().items[0].light).toEqual({enabled:false,temperature:6500,brightness:35});
    fireEvent.click(screen.getByRole('button',{name:'Duplicate'}));
    fireEvent.click(screen.getByRole('switch',{name:'Fixture light'}));
    expect(preview().items[0].light?.enabled).toBe(false);
    expect(preview().items[1].light?.enabled).toBe(true);
    setField('Object height','1');
    expect(preview().placements[1].elevation).toBeCloseTo(1.7);
    expect(quickAsset()[0][1].light?.temperature).toBe(6500);
    view.rerender(<SceneDesigner active={false}/>);
    expect(loadScene()?.objects[1]).toMatchObject({item:{model:'pendant-light',light:{enabled:true,brightness:35}},placement:{mount:'ceiling'}});
    expect(loadScene()?.objects[1].placement.elevation).toBeCloseTo(1.7);
  });

  it('keeps wall and floor colors in the preview, undo history, and saved design',async()=>{
    const view=await renderDesigner();
    fireEvent.click(screen.getByRole('button',{name:'Sage green walls'}));
    fireEvent.click(screen.getByRole('button',{name:'Walnut floor'}));
    expect(preview().finishes).toEqual({wallColor:'#a6b29b',floorColor:'#8c6c51'});
    fireEvent.click(screen.getByRole('button',{name:'Undo design change'}));
    expect(preview().finishes).toEqual({wallColor:'#a6b29b',floorColor:'#cdbc9e'});
    view.rerender(<SceneDesigner active={false}/>);
    expect(loadScene()?.finishes).toEqual(preview().finishes);
  });

  it('uses the observed wall angle in native AR and restores it through edit and undo',async()=>{
    vi.mocked(nativeARCapabilities).mockResolvedValue({supported:true});
    await renderDesigner();
    fireEvent.click(screen.getByRole('button',{name:'Add Wall sconce'}));
    await startAR();
    fireEvent.click(liveControls().getByRole('button',{name:'Place this object'}));
    expect(controller.setPlacementSurface).toHaveBeenLastCalledWith('vertical');
    pose={position:{x:.5,y:1.4,z:-1.2},rotation:37,surface:'vertical'};
    fireEvent.click(liveControls().getByRole('button',{name:'Place here'}));
    expect(worldObjects()[0].rotation).toBe(37);
    expect(worldObjects()[0].position).toEqual(pose.position);
    setField('Object width','.4',liveControls());
    expect(worldObjects()[0].position).toEqual(pose.position);
    setField('Object depth','.4',liveControls());
    expect(worldObjects()[0].position.x).toBeCloseTo(.5-Math.sin(37*Math.PI/180)*.09);
    expect(worldObjects()[0].position.z).toBeCloseTo(-1.2+Math.cos(37*Math.PI/180)*.09);
    fireEvent.click(screen.getByRole('button',{name:'Undo AR change'}));
    expect(worldObjects()[0].position).toEqual(pose.position);
    fireEvent.click(liveControls().getByRole('button',{name:/Rotate 90/}));
    expect(worldObjects()[0].rotation).toBe(127);
    fireEvent.click(screen.getByRole('button',{name:'Undo AR change'}));
    expect(worldObjects()[0].rotation).toBe(37);
    fireEvent.click(liveControls().getByRole('button',{name:'Move to a new spot'}));
    pose={position:{x:5,y:0,z:5},rotation:0,surface:'horizontal'};
    fireEvent.click(liveControls().getByRole('button',{name:'Place here'}));
    expect(worldObjects()[0].position).toEqual({x:.5,y:1.4,z:-1.2});
    expect(liveControls().getByText('Wait for a tracked wall before placing this piece.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('AR placement surface'),{target:{value:'horizontal'}});
    expect(controller.setPlacementSurface).toHaveBeenLastCalledWith('horizontal');
    fireEvent.click(liveControls().getByRole('button',{name:'Place here'}));
    expect(worldObjects()[0].position).toEqual(pose.position);
    expect(worldObjects()[0].rotation).toBe(0);
  });

  it('keeps the observed ceiling contact when a hanging light is resized',async()=>{
    vi.mocked(nativeARCapabilities).mockResolvedValue({supported:true});
    await renderDesigner();
    fireEvent.click(screen.getByRole('button',{name:'Add Pendant light'}));
    await startAR();
    fireEvent.click(liveControls().getByRole('button',{name:'Place this object'}));
    expect(controller.setPlacementSurface).toHaveBeenLastCalledWith('ceiling');
    pose={position:{x:1,y:2.4,z:-1},rotation:0,surface:'ceiling'};
    fireEvent.click(liveControls().getByRole('button',{name:'Place here'}));
    const top=worldObjects()[0].position.y+worldObjects()[0].item.height;
    setField('Object height','1.1',liveControls());
    expect(worldObjects()[0].position.y+worldObjects()[0].item.height).toBeCloseTo(top);
    fireEvent.click(screen.getByRole('button',{name:'Undo AR change'}));
    expect(worldObjects()[0].position).toEqual(pose.position);
    expect(worldObjects()[0].item.height).toBe(.65);
    fireEvent.click(liveControls().getByRole('button',{name:'Duplicate'}));
    expect(controller.setPlacementSurface).toHaveBeenLastCalledWith('ceiling');
    expect(screen.getByLabelText('AR placement surface')).toHaveProperty('value','ceiling');
    expect(worldObjects()).toHaveLength(1);
  });
});
