// @vitest-environment jsdom
import { Capacitor } from '@capacitor/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './pwa';

beforeEach(()=>{
  vi.stubEnv('PROD',true);
  vi.spyOn(Capacitor,'isNativePlatform').mockReturnValue(false);
  vi.stubGlobal('isSecureContext',true);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});

function registration(waiting:ServiceWorker|null=null){
  const register=vi.fn().mockResolvedValue({waiting});
  const workers=new EventTarget();
  Object.assign(workers,{register});
  vi.stubGlobal('navigator',{serviceWorker:workers});
  return {register,workers};
}

it('registers on first visit without an update prompt or reload listener',async()=>{
  vi.spyOn(document,'readyState','get').mockReturnValue('loading');
  const {register,workers}=registration();
  const listen=vi.spyOn(workers,'addEventListener'),dispatch=vi.spyOn(window,'dispatchEvent');
  registerServiceWorker();expect(register).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('load'));await Promise.resolve();
  expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js',{scope:'/',updateViaCache:'none'});
  window.dispatchEvent(new Event('load'));expect(register).toHaveBeenCalledTimes(1);
  expect(listen).not.toHaveBeenCalled();
  expect(dispatch.mock.calls.some(([event])=>event.type==='worldos:update')).toBe(false);
});

it('activates an older waiting helper after page load without reloading the workspace',async()=>{
  vi.spyOn(document,'readyState','get').mockReturnValue('complete');
  const waiting={postMessage:vi.fn()} as unknown as ServiceWorker;
  const {register,workers}=registration(waiting);
  const listen=vi.spyOn(workers,'addEventListener'),dispatch=vi.spyOn(window,'dispatchEvent');
  registerServiceWorker();await Promise.resolve();
  expect(register).toHaveBeenCalledTimes(1);
  expect(waiting.postMessage).toHaveBeenCalledExactlyOnceWith({type:'ACTIVATE_UPDATE'});
  workers.dispatchEvent(new Event('controllerchange'));
  expect(listen).not.toHaveBeenCalled();
  expect(dispatch.mock.calls.some(([event])=>event.type==='worldos:update')).toBe(false);
});

it('leaves online use available if worker registration fails',async()=>{
  vi.spyOn(document,'readyState','get').mockReturnValue('complete');
  const {register}=registration();register.mockRejectedValue(new Error('worker disabled'));
  registerServiceWorker();await Promise.resolve();await Promise.resolve();
  expect(register).toHaveBeenCalledTimes(1);
});

it.each(['development','native','insecure','unsupported'])('skips registration on %s',reason=>{
  const {register}=registration();
  if(reason==='development')vi.stubEnv('PROD',false);
  if(reason==='native')vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  if(reason==='insecure')vi.stubGlobal('isSecureContext',false);
  if(reason==='unsupported')vi.stubGlobal('navigator',{});
  registerServiceWorker();window.dispatchEvent(new Event('load'));
  expect(register).not.toHaveBeenCalled();
});
