// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DemoMode, { DEMO_STEPS } from './DemoMode';
import type { ComponentProps } from 'react';

function props(): ComponentProps<typeof DemoMode> {
  return { step: 0, onStep: vi.fn(), busy: false, sample: true, plan: null, verification: null,
    visual: null, stale: false, evidence: null, before: { image_url: '/before.jpg', width: 100, height: 60, name: 'before.jpg' },
    after: null, activeMove: 0, onMove: vi.fn(), revisionReasons: [] };
}
function begin() { fireEvent.click(screen.getByRole('button', { name: 'Begin walkthrough' })); }
afterEach(cleanup);

it('introduces the real workflow and labels the illustrated sample', () => {
  const value = props(); render(<DemoMode {...value}/>);
  expect(screen.getByText('ILLUSTRATED SAMPLE · MANUAL BOXES')).toBeTruthy();
  expect(value.onStep).not.toHaveBeenCalled();
  expect(screen.queryByText('Task verified')).toBeNull();
  begin();
  expect(value.onStep).toHaveBeenCalledWith(0);
  expect(screen.getByText('No scene-analysis result in this session. Use AI Analysis under Understand.')).toBeTruthy();
});
it('presents all six stages without claiming physical progress', () => {
  const value = props(); render(<DemoMode {...value}/>); begin();
  for (const label of DEMO_STEPS) expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /6Adapt/ }));
  expect(value.onStep).toHaveBeenLastCalledWith(5);
  expect(screen.getByText('Task awaiting verification')).toBeTruthy();
});
it('shows actual cached model outputs and explicitly marks historical evidence', () => {
  const value = props(); value.evidence = {imageUrl:'/before.jpg',historical:true,analysis:{provider:'meta',model:'sam-3.1',summary:'Observed a cup.',objects:[{id:'d',label:'Cup',locked:false,confidence:.812,box:{x:.1,y:.2,width:.1,height:.1}}],concepts:['cup'],message:'Review',warnings:[],inference_cache:{status:'hit',age_ms:100}}};
  render(<DemoMode {...value}/>); begin();
  expect(screen.getByText(/Cached.*live provenance unavailable/)).toBeTruthy();
  expect(screen.queryByText(/genuine inference/)).toBeNull();
  expect(screen.getByText(/Cup: 81.2%/)).toBeTruthy();
  expect(screen.getByText(/Historical inference/)).toBeTruthy();
});
it('only declares success from a verification result and identifies user review', () => {
  const value = props(); value.verification = {passed:true,source:'reviewed_final_annotations',matched_count:0,objects:[],issues:[],message:'Reviewed final scene.'};
  const {rerender}=render(<DemoMode {...value}/>); begin();
  expect(screen.getByText('Task verified')).toBeTruthy();
  expect(screen.getByText(/User-reviewed annotation evidence/)).toBeTruthy();
  rerender(<DemoMode {...value} verification={null}/>);
  expect(screen.queryByText('Task verified')).toBeNull();
});
it('shows real before/after inputs without producing an expected after image', () => {
  const value = props(); value.step=4; value.sample=false; value.after={image_url:'/actual-after.jpg',width:100,height:60,name:'after.jpg'};
  render(<DemoMode {...value}/>); begin();
  expect(screen.getByAltText('Demo original before photograph').getAttribute('src')).toBe('/before.jpg');
  expect(screen.getByAltText('Demo actual after photograph').getAttribute('src')).toBe('/actual-after.jpg');
  expect(screen.queryByText('Task verified')).toBeNull();
});
it('guides movement order and explains that animation does not track execution', () => {
  const value=props(); value.step=3;
  const box={x:.1,y:.1,width:.1,height:.1};
  value.plan={status:'ready',message:'Ready',locked_ids:[],final_objects:[],warnings:[],explored_states:1,movements:[1,2].map(number=>({number,object_id:String(number),label:`Book ${number}`,source:box,destination:box,instruction:`Lift book ${number}.`}))};
  render(<DemoMode {...value}/>); begin();
  expect(screen.getByText(/does not track physical execution/)).toBeTruthy();
  expect((screen.getByRole('button',{name:'Previous movement'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Next movement'}));
  expect(value.onMove).toHaveBeenCalledWith(1);
});
it('disables demo navigation during requests', () => {
  const value=props(); const {rerender}=render(<DemoMode {...value}/>); begin();
  rerender(<DemoMode {...value} busy/>);
  for(const button of screen.getByRole('navigation',{name:'Demo sequence'}).querySelectorAll('button')) expect(button.disabled).toBe(true);
});
