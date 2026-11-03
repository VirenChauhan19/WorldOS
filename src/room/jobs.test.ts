// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../api',async original=>({...await original<typeof import('../api')>(),request:vi.fn()}));
import { APIError, request } from '../api';
import { RoomJobFailure, RoomJobRejected, startRoomJob, watchRoomJob } from './jobs';
afterEach(()=>{vi.clearAllMocks();vi.useRealTimers();});
it('reconnects to a completed job using GET without submitting new inference',async()=>{
  vi.mocked(request).mockResolvedValue({id:'saved',status:'completed',result:{title:'Ready'}});
  expect(await watchRoomJob('saved',new AbortController().signal)).toEqual({title:'Ready'});
  expect(request).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledWith('ai/room/jobs/saved',expect.not.objectContaining({method:'POST'}),15000);
});
it('waits for Retry-After and polls the same job after rate limiting',async()=>{
  vi.useFakeTimers();vi.mocked(request).mockRejectedValueOnce(new APIError('Wait',429,5000)).mockResolvedValueOnce({id:'saved',status:'completed',result:{ready:true}});
  const status=vi.fn(),pending=watchRoomJob('saved',new AbortController().signal,status);
  await vi.advanceTimersByTimeAsync(4999);expect(request).toHaveBeenCalledTimes(1);expect(status).toHaveBeenCalledWith('waiting');
  await vi.advanceTimersByTimeAsync(1);expect(await pending).toEqual({ready:true});
  expect(vi.mocked(request).mock.calls.every(call=>call[0]==='ai/room/jobs/saved'&&!call[1]?.method)).toBe(true);
});
it('distinguishes a rejected submission from a locked accepted job',async()=>{
  vi.mocked(request).mockRejectedValue(new APIError('Sign in',401));
  await expect(startRoomJob('new',{},new AbortController().signal)).rejects.toBeInstanceOf(RoomJobRejected);
  await expect(watchRoomJob('saved',new AbortController().signal)).rejects.toBeInstanceOf(APIError);
  await expect(watchRoomJob('saved',new AbortController().signal)).rejects.not.toBeInstanceOf(RoomJobRejected);
});
it('submits with the client request ID and then polls that same job',async()=>{
  vi.mocked(request).mockResolvedValueOnce({id:'stable',status:'queued'}).mockResolvedValueOnce({id:'stable',status:'completed',result:{ready:true}});
  await startRoomJob('stable',{image_url:'photo'},new AbortController().signal);
  expect(JSON.parse(String(vi.mocked(request).mock.calls[0][1]?.body))).toEqual({id:'stable',request:{image_url:'photo'}});
  expect(vi.mocked(request).mock.calls[1][0]).toBe('ai/room/jobs/stable');
});
it('does not poll again after detaching, and surfaces terminal failures',async()=>{
  vi.useFakeTimers();vi.mocked(request).mockResolvedValue({id:'saved',status:'running',result:null});
  const controller=new AbortController(),pending=watchRoomJob('saved',controller.signal);const rejection=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await Promise.resolve();controller.abort();await rejection;await vi.advanceTimersByTimeAsync(5000);expect(request).toHaveBeenCalledTimes(1);
  vi.mocked(request).mockResolvedValue({id:'saved',status:'failed',error:'Server restarted'});
  await expect(watchRoomJob('saved',new AbortController().signal)).rejects.toThrow(RoomJobFailure);
});
