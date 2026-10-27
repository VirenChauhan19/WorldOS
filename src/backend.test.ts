// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { apiFetch, backendURL, configureBackend, requestScope, setAccessToken, setCookieSession, validateBackendURL } from './backend';

beforeEach(()=>{vi.spyOn(Capacitor,'isNativePlatform').mockReturnValue(false);configureBackend('');Object.defineProperty(navigator,'onLine',{value:true,configurable:true});});
afterEach(()=>{setAccessToken('');vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it.each(['http://example.com','https://localhost','https://127.0.0.1','https://u:password@example.com','https://example.com/api','https://example.com?q=1','https://example.com#token','javascript:alert(1)'])('rejects unsafe production backend %s',value=>{expect(()=>validateBackendURL(value,false)).toThrow();});
it('accepts exact HTTPS origins and only development loopback HTTP',()=>{
  expect(validateBackendURL(' https://example.com/ ',false)).toBe('https://example.com');
  expect(validateBackendURL('http://127.0.0.1:8000',true)).toBe('http://127.0.0.1:8000');
});
it('sends memory-only tokens with no cache, cookies, or redirects',async()=>{
  configureBackend('https://example.com');setAccessToken('synthetic-session');
  const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetcher);
  await apiFetch('inspect/templates');
  const [url,options]=fetcher.mock.calls[0];
  expect(url).toBe('https://example.com/api/inspect/templates');
  expect(options.headers.get('Authorization')).toBe('Bearer synthetic-session');
  expect(options).toMatchObject({cache:'no-store',credentials:'omit',redirect:'error'});
  expect(JSON.stringify(localStorage)).not.toContain('synthetic-session');
  configureBackend('https://other.example');await apiFetch('health');
  expect(fetcher.mock.calls[1][1].headers.has('Authorization')).toBe(false);
});
it('discards a response from the previous server or session',async()=>{
  let release!:(value:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{release=resolve;})));
  const oldScope=requestScope();const pending=apiFetch('inspect/templates');
  configureBackend('https://other.example');expect(requestScope()).not.toBe(oldScope);release(new Response('{}'));
  await expect(pending).rejects.toThrow('discarded');expect(backendURL()).toBe('https://other.example');
});
it('expires unauthorized sessions without retrying requests',async()=>{
  const listener=vi.fn();window.addEventListener('worldos:session-expired',listener);
  const fetcher=vi.fn().mockResolvedValue(new Response('{}',{status:401}));vi.stubGlobal('fetch',fetcher);setAccessToken('synthetic');
  await apiFetch('inspect/templates');expect(listener).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(apiFetch('health')).rejects.toThrow('Sign in to resume');expect(fetcher).toHaveBeenCalledTimes(1);
  setCookieSession('renewed');await apiFetch('health');expect(fetcher).toHaveBeenCalledTimes(2);
  window.removeEventListener('worldos:session-expired',listener);
});
it('does not send or queue offline requests',async()=>{
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(apiFetch('ai/analyze')).rejects.toThrow('offline');expect(fetcher).not.toHaveBeenCalled();
});
it('requires a backend address in a native app',async()=>{
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  expect(()=>configureBackend('')).toThrow('HTTPS');await expect(apiFetch('health')).rejects.toThrow('Connect the app');
});
it('uses same-origin cookies with an in-memory CSRF token for browser mutations',async()=>{
  setCookieSession('synthetic-csrf');const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetcher);
  await apiFetch('inspect/templates',{method:'POST',body:'{}'});
  const options=fetcher.mock.calls[0][1];expect(options.credentials).toBe('same-origin');
  expect(options.headers.get('X-CSRF-Token')).toBe('synthetic-csrf');expect(options.headers.has('Authorization')).toBe(false);
  expect(JSON.stringify(localStorage)).not.toContain('synthetic-csrf');
  await apiFetch('inspect/templates');expect(fetcher.mock.calls[1][1].headers.has('X-CSRF-Token')).toBe(false);
});
it('never forwards cookie credentials or CSRF tokens to a separate backend',async()=>{
  setCookieSession('old-csrf');configureBackend('https://other.example');
  const fetcher=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetcher);
  await apiFetch('inspect/templates',{method:'POST'});const options=fetcher.mock.calls[0][1];
  expect(options.credentials).toBe('omit');expect(options.headers.has('X-CSRF-Token')).toBe(false);
});
