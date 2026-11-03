// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./App',()=>({default:()=> <input aria-label="Desk session" defaultValue="Desk"/>}));
vi.mock('./simple/Wizard',()=>({default:()=> <input aria-label="Photo check draft" defaultValue=""/>}));
vi.mock('./live/LiveSpace',()=>({default:({active}:{active:boolean})=> <input aria-label="Live fit dimensions" defaultValue="" data-active={active}/>}));
vi.mock('./ar/SceneDesigner',()=>({default:({active}:{active:boolean})=> <input aria-label="Interior scene name" defaultValue="" data-active={active}/>}));
vi.mock('./missions/Mission',()=>({default:()=> <div>Guided workspace task</div>}));
vi.mock('./missions/api',()=>({listMissions:vi.fn(async()=>({missions:[],routines:[]}))}));
vi.mock('./inspect/Inspect',()=>({default:({initialInspectionId}:{initialInspectionId?:string})=> <><input aria-label="Inspect session" defaultValue="Inspect"/><span>{initialInspectionId}</span></>}));
vi.mock('./ConnectionStatus',()=>({default:()=> <div>Technical diagnostics</div>}));
vi.mock('./inspect/api',()=>({listTemplates:vi.fn(async()=>({templates:[]})),listDrafts:vi.fn(async()=>({drafts:[]})),templateHistory:vi.fn(async()=>({inspections:[]}))}));
import WorldOS from './WorldOS';
import { navigate } from './navigation';
import { DeviceWorkspaceContext } from './device/context';
beforeEach(()=>{window.history.replaceState(null,'','/');localStorage.clear();vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();delete document.documentElement.dataset.motion;});
it('opens the live camera workspace from the main action and preserves its entered dimensions',async()=>{
  render(<WorldOS/>);expect(screen.getByRole('heading',{name:/Make room.*Get going/})).toBeTruthy();
  const navigation=screen.getByRole('navigation',{name:'Main navigation'});expect(navigation.querySelectorAll('button').length).toBe(3);
  expect(screen.queryByText('Technical diagnostics')).toBeNull();fireEvent.click(screen.getByRole('button',{name:/Check my space/}));
  const input=await screen.findByLabelText('Live fit dimensions');fireEvent.change(input,{target:{value:'2.5 by 5 metres'}});
  expect(screen.queryByRole('navigation',{name:'Main navigation'})).toBeNull();
  expect(window.location.hash).toBe('#/live');
  act(()=>navigate('home'));expect(input.getAttribute('data-active')).toBe('false');
  act(()=>window.history.back());await waitFor(()=>expect(window.location.hash).toBe('#/live'));
  expect((screen.getByLabelText('Live fit dimensions') as HTMLInputElement).value).toBe('2.5 by 5 metres');
  expect(input.getAttribute('data-active')).toBe('true');
});
it('offers one primary start without repeated goal choices on home',async()=>{
  render(<WorldOS/>);fireEvent.click(screen.getByRole('button',{name:'Get my space ready'}));
  expect(await screen.findByText('Guided workspace task')).toBeTruthy();expect(window.location.hash).toBe('#/mission');
  expect(screen.queryByRole('navigation',{name:'Main navigation'})).toBeNull();
  act(()=>navigate('home'));expect(screen.queryByRole('button',{name:'Make room to create'})).toBeNull();
});
it('keeps the saved-photo workflow available and preserves unfinished photo drafts',async()=>{
  window.history.replaceState(null,'','#/inspect');render(<WorldOS/>);
  const input=await screen.findByLabelText('Photo check draft');fireEvent.change(input,{target:{value:'My workspace'}});
  expect(screen.queryByRole('navigation',{name:'Main navigation'})).toBeNull();
  act(()=>navigate('home'));act(()=>window.history.back());await waitFor(()=>expect(window.location.hash).toBe('#/inspect'));
  expect((screen.getByLabelText('Photo check draft') as HTMLInputElement).value).toBe('My workspace');
});
it('preserves advanced workspaces and existing record access behind Advanced',async()=>{
  window.history.replaceState(null,'','#/advanced-inspect?inspection=saved-123');render(<WorldOS/>);expect(await screen.findByText('saved-123')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Inspect session'),{target:{value:'Advanced draft'}});act(()=>navigate('studio'));await screen.findByLabelText('Desk session');act(()=>window.history.back());
  await waitFor(()=>expect(document.activeElement?.id).toBe('screen-advanced-inspect'));expect((screen.getByLabelText('Inspect session') as HTMLInputElement).value).toBe('Advanced draft');
  act(()=>navigate('settings'));fireEvent.click(await screen.findByRole('button',{name:/^Advanced/}));expect(await screen.findByRole('button',{name:/Detailed inspection workspace/})).toBeTruthy();
});
it('persists reduced motion and provides an actionable empty My Spaces screen',async()=>{
  render(<WorldOS/>);act(()=>navigate('settings'));fireEvent.click(await screen.findByRole('switch',{name:'Reduce motion'}));
  expect(document.documentElement.dataset.motion).toBe('reduced');expect(localStorage.getItem('worldos.motion')).toBe('reduced');
  fireEvent.click(screen.getByRole('button',{name:'My Spaces'}));expect(await screen.findByRole('heading',{name:'Your saved setups'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Get my space ready'})).toBeTruthy();
  const comparisons=screen.getByText('Saved photo comparisons');expect(comparisons.closest('details')?.open).toBe(false);fireEvent.click(comparisons);
  expect(await screen.findByText('A little order starts here.')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Save a new setup'})).toBeTruthy();
});
it('opens the AR studio from a direct link and preserves its scene while inactive',async()=>{
  window.history.replaceState(null,'','#/ar?workspace=connected');
  render(<DeviceWorkspaceContext.Provider value={true}><WorldOS/></DeviceWorkspaceContext.Provider>);
  const scene=await screen.findByLabelText('Interior scene name');
  fireEvent.change(scene,{target:{value:'Quiet reading corner'}});
  expect(document.title).toBe('AR interior studio · WorldOS');
  const navigation=screen.getByRole('navigation',{name:'App navigation'});
  expect(navigation.querySelectorAll('button')).toHaveLength(6);
  expect(screen.getByRole('button',{name:'AR studio'}).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button',{name:'Settings'}));
  expect(scene.getAttribute('data-active')).toBe('false');
  fireEvent.click(screen.getByRole('button',{name:'AR studio'}));
  expect(location.hash).toBe('#/ar');
  expect((screen.getByLabelText('Interior scene name') as HTMLInputElement).value).toBe('Quiet reading corner');
  expect(scene.getAttribute('data-active')).toBe('true');
});
