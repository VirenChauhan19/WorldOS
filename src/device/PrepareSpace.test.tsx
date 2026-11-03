// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./taskCapture',()=>({getTaskCapture:vi.fn(async()=>undefined),saveTaskCapture:vi.fn(async()=>{}),discardTaskCapture:vi.fn(async()=>{}),localTaskPhoto:vi.fn(async()=>({image_url:'data:image/png;base64,cGhvdG8=',width:100,height:100,name:'Photo'}))}));
vi.mock('./store',()=>({getDeviceSpace:vi.fn(async()=>({name:'Study desk',photo:'data:image/png;base64,cGhvdG8=',after:'',notes:'Keep monitor',steps:[{text:'Move notebook'}]}))}));
vi.mock('../PhotoActions',()=>({default:({onPhoto}:{onPhoto:(file:File)=>Promise<void>})=><button onClick={()=>void onPhoto(new File(['photo'],'photo.png',{type:'image/png'}))}>Choose test photo</button>}));
import { getTaskCapture, saveTaskCapture } from './taskCapture';
import { getDeviceSpace } from './store';
import PrepareSpace from './PrepareSpace';
beforeEach(()=>{history.replaceState(null,'','/#/prepare');vi.clearAllMocks();});
afterEach(()=>cleanup());
it('keeps photo and goal on device before opening guidance',async()=>{
  const connect=vi.fn();window.addEventListener('worldos:open-private',connect);render(<PrepareSpace/>);
  await screen.findByText('What’s next?');fireEvent.click(screen.getByRole('button',{name:/Make room to create/}));fireEvent.click(screen.getByText('Choose test photo'));
  await screen.findByAltText('Your starting photograph');expect(connect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Continue to guided steps'}));await waitFor(()=>expect(connect).toHaveBeenCalledTimes(1));
  expect(vi.mocked(saveTaskCapture).mock.lastCall?.[0]).toMatchObject({photo:{width:100},goal:expect.stringContaining('writing')});window.removeEventListener('worldos:open-private',connect);
});
it('restores a pending capture across navigation',async()=>{
  vi.mocked(getTaskCapture).mockResolvedValueOnce({kind:'task-capture',id:'a',goal:'Clear a space for drawing',constraints:'Keep lamp',photo:{image_url:'data:image/png;base64,cGhvdG8=',width:100,height:100,name:'Photo'},updatedAt:'now'});
  render(<PrepareSpace/>);await screen.findByAltText('Your starting photograph');expect(screen.getByLabelText('My goal')).toHaveProperty('value','Clear a space for drawing');
});
it('requires a new photo when resetting a saved setup',async()=>{
  history.replaceState(null,'','/#/prepare?reset=desk');render(<PrepareSpace/>);
  await screen.findByRole('heading',{name:'Reset Study desk'});expect(screen.getByAltText('Your preferred setup')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Continue to guided steps'})).toHaveProperty('disabled',true);
  await act(async()=>fireEvent.click(screen.getByText('Choose test photo')));
  expect(vi.mocked(saveTaskCapture).mock.lastCall?.[0].reference?.name).toBe('Study desk');
});
it('preserves long saved notes and asks for a shorter task copy before connecting',async()=>{
  vi.mocked(getDeviceSpace).mockResolvedValueOnce({id:'desk',name:'Study desk',photo:'data:image/png;base64,cGhvdG8=',after:'',notes:'A'.repeat(700),steps:[],updatedAt:'now'});
  history.replaceState(null,'','/#/prepare?reset=desk');render(<PrepareSpace/>);
  await screen.findByRole('heading',{name:'Reset Study desk'});await act(async()=>fireEvent.click(screen.getByText('Choose test photo')));
  expect(screen.getByLabelText('Keep in place or keep in mind')).toHaveProperty('value','A'.repeat(700));
  expect(screen.getByRole('button',{name:'Continue to guided steps'})).toHaveProperty('disabled',true);
  fireEvent.change(screen.getByLabelText('Keep in place or keep in mind'),{target:{value:'Keep the monitor'}});
  expect(screen.getByRole('button',{name:'Continue to guided steps'})).toHaveProperty('disabled',false);
});
it('resumes a reset draft and starts a fresh attempt only when requested',async()=>{
  history.replaceState(null,'','/#/prepare?reset=desk');
  vi.mocked(getTaskCapture).mockResolvedValueOnce({kind:'task-capture',id:'saved',sourceSetupId:'desk',goal:'Reset desk',constraints:'Keep new monitor',photo:{image_url:'data:image/png;base64,cGhvdG8=',width:100,height:100,name:'Today'},reference:{name:'Study desk',image_url:'data:image/png;base64,cGhvdG8=',steps:[]},updatedAt:'now'});
  render(<PrepareSpace/>);await screen.findByAltText('Your starting photograph');
  expect(screen.getByLabelText('Keep in place or keep in mind')).toHaveProperty('value','Keep new monitor');
  expect(getTaskCapture).toHaveBeenCalledWith('desk');
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Start a new reset with a fresh photo'})));
  expect(screen.queryByAltText('Your starting photograph')).toBeNull();
  expect(vi.mocked(saveTaskCapture).mock.lastCall?.[0]).toMatchObject({sourceSetupId:'desk',photo:null});
});
