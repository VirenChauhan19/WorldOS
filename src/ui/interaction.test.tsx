// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Dialog from './Dialog';
import OperationStatus from './OperationStatus';
import Canvas from '../Canvas';
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it('traps dialog focus, closes with Escape and restores the trigger',()=>{
  function Host(){const [open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Open guide</button><Dialog open={open} onClose={()=>setOpen(false)} title="Guide"><input aria-label="Dialog field"/><button>Last</button></Dialog></>;}
  render(<Host/>);const trigger=screen.getByText('Open guide');trigger.focus();fireEvent.click(trigger);
  const close=screen.getByRole('button',{name:'Close Guide'}),last=screen.getByText('Last');
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last,{key:'Tab'});expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(document.body.style.overflow).toBe('');
});
it('reports elapsed waiting without fabricated percentages or repeated announcements',()=>{
  vi.useFakeTimers();render(<OperationStatus message="SAM is detecting objects…"/>);act(()=>vi.advanceTimersByTime(16000));
  expect(screen.getByRole('status').textContent).toBe('SAM is detecting objects…');
  expect(screen.getByText(/16s elapsed/).getAttribute('aria-hidden')).toBe('true');expect(screen.queryByRole('progressbar')).toBeNull();
});
it('previews annotation drags locally, commits on release and cancels cleanly',()=>{
  vi.stubGlobal('PointerEvent',MouseEvent);
  const onObjects=vi.fn();
  render(<Canvas image={{image_url:'/sample.svg',width:100,height:100,name:'test'}} objects={[{id:'book',label:'Book',box:{x:.1,y:.1,width:.2,height:.2},locked:false}]} target={null} workspace={{x:0,y:0,width:1,height:1}} tool="select" selected="book" onSelect={()=>{}} onObjects={onObjects} onTarget={()=>{}} onWorkspace={()=>{}} onAdd={()=>{}} showBoxes/>);
  const canvas=screen.getByLabelText('Spatial annotation canvas');
  canvas.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,width:100,height:100,right:100,bottom:100,toJSON:()=>({})});
  Object.assign(canvas,{setPointerCapture:vi.fn(),hasPointerCapture:()=>true,releasePointerCapture:vi.fn()});
  const box=screen.getByRole('button',{name:'Select Book annotation'}).querySelector('rect')!;
  fireEvent.pointerDown(box,{clientX:15,clientY:15,button:0,pointerId:1});
  fireEvent.pointerMove(canvas,{clientX:25,clientY:25,pointerId:1});expect(onObjects).not.toHaveBeenCalled();
  fireEvent.pointerUp(canvas,{clientX:25,clientY:25,pointerId:1});expect(onObjects).toHaveBeenCalledTimes(1);expect(onObjects.mock.calls[0][0][0].box.x).toBeCloseTo(.2);
  fireEvent.pointerDown(box,{clientX:15,clientY:15,button:0,pointerId:2});fireEvent.pointerMove(canvas,{clientX:35,clientY:35,pointerId:2});fireEvent.pointerCancel(canvas,{pointerId:2});
  fireEvent.pointerUp(canvas,{clientX:35,clientY:35,pointerId:2});expect(onObjects).toHaveBeenCalledTimes(1);
});
