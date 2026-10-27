// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Canvas from './Canvas';
const object={id:'book',label:'Book',locked:false,box:{x:.1,y:.1,width:.2,height:.2}};
function props(selected:string|null=null){return {image:{image_url:'data:image/png;base64,',width:1000,height:1000,name:'synthetic'},objects:[object],target:null,workspace:{x:0,y:0,width:1,height:1},tool:'select' as const,selected,onSelect:vi.fn(),onObjects:vi.fn(),onTarget:vi.fn(),onWorkspace:vi.fn(),onAdd:vi.fn(),showBoxes:true};}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function pointer(element:Element,type:string,x:number,id=1){const event=new MouseEvent(type,{bubbles:true,clientX:x,clientY:x,button:0});Object.defineProperties(event,{pointerType:{value:'touch'},pointerId:{value:id},isPrimary:{value:true}});fireEvent(element,event);}
it('first touch selects; only a second gesture moves the selected object',()=>{
  const p=props();const view=render(<Canvas {...p}/>);const svg=screen.getByLabelText('Spatial annotation canvas');
  vi.spyOn(svg,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:1000,bottom:1000,width:1000,height:1000,toJSON:()=>{}});
  Object.assign(svg,{setPointerCapture:vi.fn(),hasPointerCapture:()=>false});
  pointer(screen.getByRole('button',{name:'Select Book annotation'}),'pointerdown',150);pointer(svg,'pointermove',250);pointer(svg,'pointerup',250);
  expect(p.onSelect).toHaveBeenCalledWith('book');expect(p.onObjects).not.toHaveBeenCalled();
  view.rerender(<Canvas {...p} selected="book"/>);pointer(screen.getByRole('button',{name:'Select Book annotation'}),'pointerdown',150);pointer(svg,'pointermove',250,2);expect(p.onObjects).not.toHaveBeenCalled();
  pointer(svg,'pointermove',250);pointer(svg,'pointerup',250);expect(p.onObjects.mock.calls[0][0][0].box.x).toBeCloseTo(.2);
});
it('offers object selection and zoom without precise dragging',()=>{
  const p=props();render(<Canvas {...p}/>);
  fireEvent.change(screen.getByLabelText('Canvas object selection'),{target:{value:'book'}});expect(p.onSelect).toHaveBeenCalledWith('book');
  fireEvent.click(screen.getByRole('button',{name:'Zoom photo in'}));expect(screen.getByText('150%')).toBeTruthy();expect(screen.getByRole('button',{name:'Pan photo'}).getAttribute('aria-pressed')).toBe('true');
});
