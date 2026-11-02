// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import AppEntry from './AppEntry';
import { configureBackend } from './backend';
import { connectRoomDesigner } from './device/context';
import { roomDraftKey } from './device/roomDraft';
vi.mock('./device/store',async original=>({...await original<typeof import('./device/store')>(),listDeviceSpaces:vi.fn(async()=>[])}));
beforeEach(()=>{window.history.replaceState(null,'','/');configureBackend('');vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});

it('opens the real home and recorded example without any authentication or private API request',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  render(<StrictMode><AppEntry/></StrictMode>);
  expect(await screen.findByRole('heading',{name:'Your space, in focus.'})).toBeTruthy();
  expect(screen.getByRole('figure',{name:'Explore a recorded desk scan'})).toBeTruthy();
  expect(screen.queryByLabelText('Workspace passphrase')).toBeNull();
  await act(async()=>{});expect(fetcher).not.toHaveBeenCalled();
});

it('only connects to the private server when explicitly opened and can return without signing in',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('{"required":true,"authenticated":false}'));vi.stubGlobal('fetch',fetcher);
  render(<AppEntry/>);
  fireEvent.click(screen.getByRole('button',{name:'Settings'}));
  fireEvent.click(await screen.findByRole('button',{name:'Open private workspace'}));
  await screen.findByLabelText('Workspace passphrase');expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Back to device workspace'}));
  await screen.findByRole('heading',{name:'Your space, in focus.'});expect(screen.queryByLabelText('Workspace passphrase')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('offers installation instructions from device settings without connecting to the backend',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<AppEntry/>);
  fireEvent.click(screen.getByRole('button',{name:'Settings'}));
  fireEvent.click(await screen.findByRole('button',{name:'Add to home screen'}));
  expect(screen.getByRole('dialog',{name:'Add WorldOS to your home screen'})).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it('connects the room designer without losing the room route or device wish list',async()=>{
  localStorage.setItem(roomDraftKey,JSON.stringify({roomFields:{width:'',depth:'',height:''},source:'unmeasured',items:[],gap:'0.3',manual:null,goal:'A reading nook by the window'}));
  const fetcher=vi.fn().mockResolvedValue(new Response('{"required":false,"authenticated":true}'));
  vi.stubGlobal('fetch',fetcher);render(<AppEntry/>);
  act(()=>{connectRoomDesigner();});
  expect(await screen.findByRole('heading',{name:'Room planner'})).toBeTruthy();
  expect(screen.getByLabelText('What would make this room yours?')).toHaveProperty('value','A reading nook by the window');
  expect(window.location.hash).toContain('room');
});
