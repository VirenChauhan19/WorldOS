// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./App',()=>({default:()=> <input aria-label="Desk session" defaultValue="Desk"/>}));
vi.mock('./inspect/Inspect',()=>({default:({initialInspectionId}:{initialInspectionId?:string})=> <><input aria-label="Inspect session" defaultValue="Inspect"/><span>{initialInspectionId}</span></>}));
vi.mock('./ConnectionStatus',()=>({default:()=>null}));
vi.mock('./inspect/api',()=>({listTemplates:vi.fn(async()=>({templates:[]})),templateHistory:vi.fn(async()=>({inspections:[]}))}));
import WorldOS from './WorldOS';
import { navigate } from './navigation';
beforeEach(()=>{window.history.replaceState(null,'','/');localStorage.clear();vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();delete document.documentElement.dataset.motion;});
it('lazy loads workspaces and preserves drafts through navigation and browser Back',async()=>{
  render(<WorldOS/>);expect(screen.queryByLabelText('Inspect session')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Inspect'}));
  fireEvent.change(await screen.findByLabelText('Inspect session'),{target:{value:'My workspace'}});
  fireEvent.click(screen.getByRole('button',{name:'Spatial Studio'}));
  fireEvent.change(await screen.findByLabelText('Desk session'),{target:{value:'My desk'}});
  expect(window.location.hash).toBe('#/studio');act(()=>window.history.back());
  await waitFor(()=>expect(screen.getByRole('button',{name:'Inspect'}).getAttribute('aria-current')).toBe('page'));
  expect((screen.getByLabelText('Inspect session') as HTMLInputElement).value).toBe('My workspace');
  expect(document.activeElement?.id).toBe('screen-inspect');act(()=>window.history.forward());
  await waitFor(()=>expect(screen.getByRole('button',{name:'Spatial Studio'}).getAttribute('aria-current')).toBe('page'));
  expect((screen.getByLabelText('Desk session') as HTMLInputElement).value).toBe('My desk');
});
it('opens inspection deep links and falls back safely for unknown routes',async()=>{
  window.history.replaceState(null,'','#/inspect?inspection=saved-123');render(<WorldOS/>);
  expect(await screen.findByText('saved-123')).toBeTruthy();
  act(()=>{window.history.pushState(null,'','#/missing');window.dispatchEvent(new PopStateEvent('popstate'));});
  expect(screen.getByRole('button',{name:'Home'}).getAttribute('aria-current')).toBe('page');
});
it('persists reduced motion and opens real empty history',async()=>{
  render(<WorldOS/>);act(()=>navigate('settings'));
  fireEvent.click(await screen.findByRole('switch',{name:'Reduce motion'}));
  expect(document.documentElement.dataset.motion).toBe('reduced');expect(localStorage.getItem('worldos.motion')).toBe('reduced');
  fireEvent.click(screen.getByRole('button',{name:'History'}));
  expect(await screen.findByText('No saved inspections yet')).toBeTruthy();
});
