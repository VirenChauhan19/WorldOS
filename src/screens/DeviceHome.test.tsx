// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProductHome from './ProductHome';
import { DeviceWorkspaceContext } from '../device/context';
vi.mock('../inspect/api',()=>({listTemplates:vi.fn()}));
vi.mock('../device/store',async original=>({...await original<typeof import('../device/store')>(),listDeviceSpaces:vi.fn(async()=>[])}));
import { listTemplates } from '../inspect/api';

beforeEach(()=>window.history.replaceState(null,'','/'));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function open(){render(<DeviceWorkspaceContext.Provider value={true}><ProductHome/></DeviceWorkspaceContext.Provider>);}

it('offers camera, measured room planning and device setups without starting private requests',()=>{
  open();
  expect(screen.getByRole('heading',{name:'Your space, in focus.'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Open live camera'}));expect(window.location.hash).toBe('#/live');
  fireEvent.click(screen.getByRole('button',{name:/Plan a room/}));expect(window.location.hash).toBe('#/room');
  fireEvent.click(screen.getByRole('button',{name:/Save a setup/}));expect(window.location.hash).toBe('#/mission');
  expect(listTemplates).not.toHaveBeenCalled();
});

it('opens the clearly labeled camera example through the demo route',()=>{
  open();
  fireEvent.click(screen.getByRole('button',{name:'Try the camera example'}));
  expect(window.location.hash).toBe('#/live?demo=1');
  expect(screen.getByText('Recorded example',{exact:true})).toBeTruthy();
});
it('opens the AR interior studio in the device workspace',()=>{
  window.history.replaceState(null,'','#/home?workspace=connected');
  open();
  fireEvent.click(screen.getByRole('button',{name:'Open AR studio'}));
  expect(window.location.hash).toBe('#/ar');
  expect(listTemplates).not.toHaveBeenCalled();
});

it('keeps the recorded preview interactive on the home screen',()=>{
  open();const preview=screen.getByRole('figure',{name:'Explore a recorded desk scan'});
  fireEvent.click(within(preview).getByRole('button',{name:'Explore Laptop'}));
  expect(within(preview).getByRole('button',{name:'Explore Laptop'}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(preview).getByRole('button',{name:'Image'}));
  expect(within(preview).queryByRole('button',{name:'Explore Laptop'})).toBeNull();
});
