// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { StrictMode } from 'react';
import MobileShell from './MobileShell';
import PhotoActions from './PhotoActions';
import { apiFetch, configureBackend } from './backend';
import { normalizePhoto } from './photos';
import { useWorkspaceAccess } from './access';
vi.mock('./photos',()=>({normalizePhoto:vi.fn(async(file:File)=>file),nativePhoto:vi.fn()}));
beforeEach(()=>{vi.spyOn(Capacitor,'isNativePlatform').mockReturnValue(false);configureBackend('');Object.defineProperty(navigator,'onLine',{value:true,configurable:true});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();localStorage.clear();});
it('keeps draft input mounted without a reload banner when an older helper reports an update',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"required":false,"authenticated":true}')));
  render(<MobileShell><input aria-label="Unsaved template name" defaultValue=""/></MobileShell>);
  const draft=await screen.findByLabelText('Unsaved template name');
  fireEvent.change(draft,{target:{value:'My unsaved workspace'}});
  act(()=>window.dispatchEvent(new CustomEvent('worldos:update',{detail:{postMessage:vi.fn()}})));
  expect(screen.queryByRole('button',{name:'Reload app'})).toBeNull();
  expect(screen.queryByText(/An app update is ready/)).toBeNull();
  expect(screen.getByLabelText('Unsaved template name')).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe('My unsaved workspace');
});
it('warns about ephemeral storage before sign-in and in the workspace',async()=>{
  for(const authenticated of [false,true]){
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({required:true,authenticated,storage_mode:'ephemeral'}))));
    render(<MobileShell><div>Temporary workspace</div></MobileShell>);
    expect(await screen.findByText(/Temporary storage: saved work, uploaded photos, and login sessions/)).toBeTruthy();
    expect(screen.getByText(/restarts, redeploys, or sleeps/)).toBeTruthy();
    cleanup();
  }
});
it('offers enabled judge access, labels the shared demo and carries its role to children',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{"required":true,"authenticated":false,"judge_enabled":true}'))
    .mockResolvedValueOnce(new Response('{"authenticated":true,"session_mode":"cookie","csrf_token":"synthetic-csrf","access":"judge","judge_expires_at":"2026-11-05T04:00:00Z"}'));
  vi.stubGlobal('fetch',fetcher);
  function Workspace(){return <div>Workspace role: {useWorkspaceAccess()}</div>;}
  render(<MobileShell><Workspace/></MobileShell>);
  fireEvent.change(await screen.findByLabelText('Workspace access'),{target:{value:'judge'}});
  fireEvent.change(screen.getByLabelText('Workspace passphrase'),{target:{value:'synthetic judge passphrase'}});
  fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  await screen.findByText('Workspace role: judge');
  expect(JSON.parse(fetcher.mock.calls[1][1].body).access).toBe('judge');
  expect(screen.getByText(/owner data and backups are private/)).toBeTruthy();
});
it('restores judge access on reload and hides judge choice when disabled',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"required":true,"authenticated":true,"session_mode":"cookie","csrf_token":"synthetic-csrf","access":"judge","judge_enabled":true}')));
  render(<MobileShell><div>Demo restored</div></MobileShell>);
  await screen.findByText('Demo restored');expect(screen.getByText('Judge demo')).toBeTruthy();cleanup();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"required":true,"authenticated":false,"judge_enabled":false}')));
  render(<MobileShell><div>Private content</div></MobileShell>);
  await screen.findByLabelText('Workspace passphrase');expect(screen.queryByLabelText('Workspace access')).toBeNull();
});
it('gates private data until login and removes it on expiry',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{"required":true,"authenticated":false}')).mockResolvedValueOnce(new Response('{"access_token":"synthetic-session"}'));
  vi.stubGlobal('fetch',fetcher);render(<MobileShell><div>Private template list</div></MobileShell>);
  await screen.findByLabelText('Workspace passphrase');expect(screen.queryByText('Private template list')).toBeNull();
  fireEvent.change(screen.getByLabelText('Workspace passphrase'),{target:{value:'synthetic test passphrase'}});fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  await screen.findByText('Private template list');expect(localStorage.getItem('worldos.session')).toBeNull();
  act(()=>window.dispatchEvent(new Event('worldos:session-expired')));
  expect(screen.queryByText('Private template list')).toBeNull();expect(screen.getByText('Your session expired. Sign in again.')).toBeTruthy();
});
it('recovers from backend failure with an explicit retry',async()=>{
  const fetcher=vi.fn().mockRejectedValueOnce(new Error('Connection failed')).mockResolvedValueOnce(new Response('{"required":false,"authenticated":true}'));vi.stubGlobal('fetch',fetcher);
  render(<MobileShell><div>Workspace ready</div></MobileShell>);await screen.findByText('Connection failed');expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Retry connection'}));await screen.findByText('Workspace ready');
});
it('makes offline limitations and iPhone install instructions visible',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"required":false,"authenticated":true}')));render(<MobileShell><div>Workspace ready</div></MobileShell>);await screen.findByText('Workspace ready');
  act(()=>window.dispatchEvent(new Event('offline')));expect(screen.getByText(/Nothing will be queued/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Install'}));expect(screen.getByText(/On iPhone: open the HTTPS app in Safari/)).toBeTruthy();
});
it('provides separate capture and library inputs and permits the same photo twice',async()=>{
  const received=vi.fn().mockResolvedValue(undefined);render(<PhotoActions label="Choose photo" disabled={false} onPhoto={received}/>);
  const camera=screen.getByLabelText('Take photo camera input'),library=screen.getByLabelText('Choose photo library input');
  expect(camera.getAttribute('capture')).toBe('environment');expect(library.hasAttribute('capture')).toBe(false);
  const file=new File(['synthetic'],'photo.jpg',{type:'image/jpeg'});
  fireEvent.change(camera,{target:{files:[file]}});await waitFor(()=>expect(received).toHaveBeenCalledTimes(1));
  fireEvent.change(camera,{target:{files:[file]}});await waitFor(()=>expect(received).toHaveBeenCalledTimes(2));
  expect(normalizePhoto).toHaveBeenCalledWith(file);
});
it('reports failed photo preparation without sending a scan',async()=>{
  vi.mocked(normalizePhoto).mockRejectedValueOnce(new Error('Unsupported photo'));const received=vi.fn();render(<PhotoActions label="Choose photo" disabled={false} onPhoto={received}/>);
  fireEvent.change(screen.getByLabelText('Choose photo library input'),{target:{files:[new File(['bad'],'bad.jpg')]}});
  await screen.findByRole('alert');expect(received).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Take photo'}).hasAttribute('disabled')).toBe(false);
});
it('restores a cookie session on reload, including StrictMode startup',async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>new Response('{"required":true,"authenticated":true,"session_mode":"cookie","csrf_token":"synthetic-csrf"}'));vi.stubGlobal('fetch',fetcher);
  render(<StrictMode><MobileShell><div>Restored private workspace</div></MobileShell></StrictMode>);
  await screen.findByText('Restored private workspace');expect(screen.queryByLabelText('Workspace passphrase')).toBeNull();
  await apiFetch('inspect/templates',{method:'POST'});
  expect(fetcher.mock.calls.at(-1)?.[1].headers.get('X-CSRF-Token')).toBe('synthetic-csrf');
});
it('requests cookie login and keeps the private workspace visible if offline sign-out fails',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{"required":true,"authenticated":false}'))
    .mockResolvedValueOnce(new Response('{"authenticated":true,"session_mode":"cookie","csrf_token":"synthetic-csrf"}'))
    .mockRejectedValueOnce(new Error('offline'));vi.stubGlobal('fetch',fetcher);
  render(<MobileShell><div>Private workspace for signout test</div></MobileShell>);
  fireEvent.change(await screen.findByLabelText('Workspace passphrase'),{target:{value:'synthetic passphrase'}});
  fireEvent.click(screen.getByRole('button',{name:'Sign in'}));await screen.findByText('Private workspace for signout test');
  expect(JSON.parse(fetcher.mock.calls[1][1].body).mode).toBe('cookie');
  fireEvent.click(screen.getByRole('button',{name:'Sign out'}));await screen.findByText(/this browser session is still active/);
  expect(screen.getByText('Private workspace for signout test')).toBeTruthy();
});
