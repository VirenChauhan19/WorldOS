// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { analyzeAI } from './api';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('shares identical in-flight AI actions and releases the request after completion', async () => {
  let release!: (value: Response) => void;
  const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockImplementation(()=>Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch',fetcher);
  const a=analyzeAI('test-image',['book']); const b=analyzeAI('test-image',['book']);
  expect(fetcher).toHaveBeenCalledTimes(1);
  release(new Response('{"objects":[]}'));
  expect(await a).toEqual(await b);
  await analyzeAI('test-image',['book']);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).toBe('/api/ai/analyze');
});
it('does not merge changed concepts or photographs', async () => {
  const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch',fetcher);
  await Promise.all([analyzeAI('image-a',['book']),analyzeAI('image-a',['cup']),analyzeAI('image-b',['book'])]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('does not retry failure automatically and permits an explicit retry', async () => {
  const fetcher=vi.fn().mockImplementationOnce(()=>Promise.resolve(new Response('{"detail":"Provider rate limited"}',{status:429}))).mockImplementation(()=>Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch',fetcher);
  await expect(analyzeAI('image',['cup'])).rejects.toThrow('rate limited');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await analyzeAI('image',['cup']);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['not-json','null','[]'])('rejects unreadable or malformed response %s', async body => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(body)));
  await expect(analyzeAI('malformed-image',['book'])).rejects.toThrow(/unreadable|invalid response/);
});
it('aborts a stalled request with a recoverable timeout', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch',vi.fn().mockImplementation((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))));
  const result=expect(analyzeAI('timeout-image',['book'])).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(130001);
  await result;
});
