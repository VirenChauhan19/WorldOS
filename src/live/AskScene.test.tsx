// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AIAnalysis, SceneAnswer, SceneImage } from '../types';
vi.mock('../api',()=>({askScene:vi.fn()}));
import { askScene } from '../api';
import AskScene from './AskScene';

const frame:SceneImage={image_url:'data:image/jpeg;base64,first',width:1280,height:720,name:'Captured view'};
const analysis:AIAnalysis={objects:[{id:'phone',label:'Phone',box:{x:.2,y:.3,width:.1,height:.2},locked:false}],concepts:['phone'],summary:'A phone.',message:'',warnings:[],provider:'fixture',model:'fixture'};
const answer:SceneAnswer={answer:'Consider a dedicated place for the phone.',observations:['The phone is on the desk.'],object_ids:['phone'],next_action:'measure',limitation:'Measure the free width and depth.',provider:'fixture',model:'Muse fixture',source:'captured_view',live_request:false};
const onSelect=vi.fn(),onAction=vi.fn();
beforeEach(()=>{vi.mocked(askScene).mockResolvedValue(answer);});
afterEach(()=>{cleanup();vi.clearAllMocks();});
const props={frame,analysis,active:true,onSelect,onAction};

it('waits for a real captured view and never calls AI from mounting',()=>{
  render(<AskScene {...props} frame={null} analysis={null}/>);
  expect((screen.getByRole('button',{name:'Ask about this view'}) as HTMLButtonElement).disabled).toBe(true);
  expect(askScene).not.toHaveBeenCalled();
});

it('answers an explicit question using the captured photo and links evidence to the correct object',async()=>{
  render(<AskScene {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'How can I make room?'}));
  await screen.findByText(answer.answer);
  expect(askScene).toHaveBeenCalledWith(frame.image_url,analysis.objects,'How can I make room?',expect.any(AbortSignal));
  fireEvent.click(screen.getByRole('button',{name:'Phone'}));expect(onSelect).toHaveBeenCalledWith('phone');
  fireEvent.click(screen.getByRole('button',{name:'Check the dimensions'}));expect(onAction).toHaveBeenCalledWith('measure');
  expect(screen.getByText(answer.limitation)).toBeTruthy();
});

it('cancels obsolete answers when a new captured scene arrives',async()=>{
  let resolve!:(value:SceneAnswer)=>void;
  vi.mocked(askScene).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const {rerender}=render(<AskScene {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'What could work better here?'}));
  const signal=vi.mocked(askScene).mock.calls[0][3]!;
  rerender(<AskScene {...props} frame={{...frame,image_url:'data:image/jpeg;base64,next'}}/>);
  expect(signal.aborted).toBe(true);
  await act(async()=>resolve(answer));
  expect(screen.queryByText(answer.answer)).toBeNull();
});

it('locks duplicate submissions, supports cancellation and preserves a failed question for retry',async()=>{
  let reject!:(error:Error)=>void;
  vi.mocked(askScene).mockImplementationOnce(()=>new Promise((_done,fail)=>{reject=fail;}));
  render(<AskScene {...props}/>);
  fireEvent.change(screen.getByLabelText('Question about this view'),{target:{value:'What should I measure here?'}});
  fireEvent.click(screen.getByRole('button',{name:'Ask about this view'}));
  fireEvent.click(screen.getByRole('button',{name:'Ask about this view'}));
  expect(askScene).toHaveBeenCalledOnce();
  await act(async()=>reject(new Error('Connection interrupted.')));
  expect(screen.getByRole('alert').textContent).toBe('Connection interrupted.');
  expect((screen.getByLabelText('Question about this view') as HTMLTextAreaElement).value).toBe('What should I measure here?');
  vi.mocked(askScene).mockImplementationOnce(()=>new Promise(()=>{}));
  fireEvent.click(screen.getByRole('button',{name:'Ask about this view'}));
  fireEvent.click(screen.getByRole('button',{name:'Cancel question'}));
  expect(vi.mocked(askScene).mock.calls[1][3]?.aborted).toBe(true);
  await waitFor(()=>expect(screen.queryByText('Looking closely at your space…')).toBeNull());
});
