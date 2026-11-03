// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { navigate, routeURL, workspaceMode } from './navigation';

beforeEach(()=>history.replaceState(null,'','/#/home'));
it('keeps private mode across navigation and reloadable URLs',()=>{
  navigate('mission',{id:'saved-task'});
  expect(workspaceMode()).toBe('private');
  navigate('settings');
  expect(location.hash).toBe('#/settings?workspace=private');
  expect(workspaceMode(location.hash)).toBe('private');
});
it('returns to the device workspace explicitly without inheriting private mode',()=>{
  navigate('room',{project:'saved-room',workspace:'connected'});
  expect(routeURL('history')).toBe('#/history?workspace=connected');
  navigate('home',{workspace:''});
  expect(location.hash).toBe('#/home');expect(workspaceMode()).toBe('device');
  expect(workspaceMode('#/room?project=saved-room&workspace=connected')).toBe('connected');
});
it('opens private room links with the device room library and an authenticated connection',()=>{
  navigate('home',{workspace:'private'});
  navigate('room',{project:'my-room'});
  expect(location.hash).toBe('#/room?project=my-room&workspace=connected');
  expect(routeURL('history')).toBe('#/history?workspace=connected');
});
