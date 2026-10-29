// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./App',()=>({default:()=> <input aria-label="Desk session" defaultValue="Desk"/>}));
vi.mock('./simple/Wizard',()=>({default:()=> <input aria-label="Photo check draft" defaultValue=""/>}));
vi.mock('./live/LiveSpace',()=>({default:({active}:{active:boolean})=> <input aria-label="Live fit dimensions" defaultValue="" data-active={active}/>}));
vi.mock('./inspect/Inspect',()=>({default:({initialInspectionId}:{initialInspectionId?:string})=> <><input aria-label="Inspect session" defaultValue="Inspect"/><span>{initialInspectionId}</span></>}));
vi.mock('./ConnectionStatus',()=>({default:()=> <div>Technical diagnostics</div>}));
vi.mock('./inspect/api',()=>({listTemplates:vi.fn(async()=>({templates:[]})),listDrafts:vi.fn(async()=>({drafts:[]})),templateHistory:vi.fn(async()=>({inspections:[]}))}));
import WorldOS from './WorldOS';
import { navigate } from './navigation';
beforeEach(()=>{window.history.replaceState(null,'','/');localStorage.clear();vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();delete document.documentElement.dataset.motion;});
it('opens the live camera workspace from the main action and preserves its entered dimensions',async()=>{
  render(<WorldOS/>);expect(screen.getByRole('heading',{name:'See what fits. Before you move it.'})).toBeTruthy();
  const navigation=screen.getByRole('navigation',{name:'Main navigation'});expect(navigation.querySelectorAll('button').length).toBe(3);
  expect(screen.queryByText('Technical diagnostics')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Check my space'}));
  const input=await screen.findByLabelText('Live fit dimensions');fireEvent.change(input,{target:{value:'2.5 by 5 metres'}});
  expect(screen.queryByRole('navigation',{name:'Main navigation'})).toBeNull();
  expect(window.location.hash).toBe('#/live');
  act(()=>navigate('home'));expect(input.getAttribute('data-active')).toBe('false');
  act(()=>window.history.back());await waitFor(()=>expect(window.location.hash).toBe('#/live'));
  expect((screen.getByLabelText('Live fit dimensions') as HTMLInputElement).value).toBe('2.5 by 5 metres');
  expect(input.getAttribute('data-active')).toBe('true');
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
  fireEvent.click(screen.getByRole('button',{name:'My Spaces'}));expect(await screen.findByText('A little order starts here.')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Save a new setup'})).toBeTruthy();
});
