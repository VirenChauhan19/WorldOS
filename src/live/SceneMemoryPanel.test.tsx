// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import SceneMemoryPanel from './SceneMemoryPanel';
import type { MemorySnapshot } from './sceneMemory';
vi.mock('../missions/api',()=>({createMission:vi.fn()}));
vi.mock('../navigation',()=>({navigate:vi.fn()}));
import { createMission } from '../missions/api';
import { navigate } from '../navigation';

const frame={image_url:'data:image/jpeg;base64,fixture',width:768,height:512,name:'Desk'};
const object={id:'keys',label:'Keys',locked:false,box:{x:.2,y:.3,width:.15,height:.1}};
const memory:MemorySnapshot={places:[{id:'desk',name:'Study desk',summary:'Keys on a desk',frame,objects:[object],details:{keys:'Key ring'},capturedAt:1000,features:{width:128,height:96,points:[]}}],items:[{object,placeId:'desk',frame,detail:'Key ring',capturedAt:1000}],location:null,full:false};
const props=()=>({memory,findingId:null,onFind:vi.fn(),onRename:vi.fn(),onClear:vi.fn(),onLeave:vi.fn(),active:true});
afterEach(()=>{cleanup();vi.clearAllMocks();});

it('finds an item from its remembered area and shows the exact last-seen photo',()=>{
  const value=props();const {rerender}=render(<SceneMemoryPanel {...value}/>);
  fireEvent.change(screen.getByLabelText('Find a remembered item'),{target:{value:'keys'}});
  fireEvent.click(screen.getByRole('button',{name:/Find Keys, last seen in Study desk/}));
  expect(value.onFind).toHaveBeenCalledWith('keys');
  rerender(<SceneMemoryPanel {...value} findingId="keys"/>);
  expect(screen.getByAltText('Last seen view of Keys').getAttribute('src')).toBe(frame.image_url);
  expect(screen.getByRole('status').textContent).toContain('Point the camera back');
});

it('starts a guided task using the selected view without claiming a live photo',async()=>{
  const value=props();vi.mocked(createMission).mockResolvedValue({id:'task-1'} as Awaited<ReturnType<typeof createMission>>);
  render(<SceneMemoryPanel {...value} findingId="keys"/>);
  fireEvent.click(screen.getByRole('button',{name:'Get ready to work'}));
  fireEvent.click(screen.getByRole('button',{name:'Help me with this area'}));
  await waitFor(()=>expect(navigate).toHaveBeenCalledWith('mission',{id:'task-1',observe:'1'}));
  expect(createMission).toHaveBeenCalledWith(expect.objectContaining({image_url:frame.image_url,goal:expect.stringContaining('focused work')}),expect.any(AbortSignal));
  expect(value.onLeave).toHaveBeenCalledOnce();
});
