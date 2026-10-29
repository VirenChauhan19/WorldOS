// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildFurnitureUSDZ } from './quickLook';
import { QuickLookLink, useQuickLookAsset } from './QuickLookLink';
import { FURNITURE_PRESETS } from './layout';
import type { FurnitureItem } from './layout';

vi.mock('./quickLook', () => ({buildFurnitureUSDZ: vi.fn()}));
const NativeURL = URL;
const create = vi.fn(), revoke = vi.fn();
const item = FURNITURE_PRESETS[0];
const placements = [{itemId:item.id,x:0,z:0,rotation:0 as const}];
function Harness({items=[item],enabled=true}:{items?:FurnitureItem[];enabled?:boolean}) {
  const asset=useQuickLookAsset(items,placements,enabled);
  return <><QuickLookLink url={asset.url} onOpen={()=>{}}/><output>{asset.error}</output><button onClick={asset.retry}>Retry export</button></>;
}
beforeEach(()=>{
  vi.useFakeTimers();
  create.mockReset().mockImplementation(()=>`blob:scene-${create.mock.calls.length}`);revoke.mockReset();
  vi.stubGlobal('URL',class extends NativeURL{static createObjectURL=create;static revokeObjectURL=revoke;});
  vi.mocked(buildFurnitureUSDZ).mockReset().mockReturnValue(new Blob(['scene'],{type:'model/vnd.usdz+zip'}));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
function settle(){act(()=>{vi.advanceTimersByTime(120);});}

it('uses the Safari rel=ar image-link contract and disables content scaling',()=>{
  const open=vi.fn();render(<QuickLookLink url="blob:scene" onOpen={open}/>);
  const link=screen.getByRole('link',{name:'View in my room'});
  expect(link.getAttribute('rel')).toBe('ar');
  expect(link.getAttribute('href')).toBe('blob:scene#allowsContentScaling=0');
  expect(link.getAttribute('download')).toBe('worldos-furniture.usdz');
  expect(link.children.length).toBe(1);expect(link.firstElementChild?.tagName).toBe('IMG');
  fireEvent.click(link);expect(open).toHaveBeenCalledOnce();
});

it('keeps the package alive during viewer handoff and unrelated page updates',()=>{
  const view=render(<Harness/>);
  settle();
  expect(create).toHaveBeenCalledOnce();
  view.rerender(<Harness items={[{...item}]}/>);
  act(()=>{fireEvent(document,new Event('visibilitychange'));fireEvent(window,new Event('pagehide'));});
  expect(create).toHaveBeenCalledOnce();expect(revoke).not.toHaveBeenCalled();
  expect(screen.getByRole('link',{name:'View in my room'}).getAttribute('href')).toContain('blob:scene-1');
  view.unmount();expect(revoke).toHaveBeenCalledWith('blob:scene-1');
});

it('replaces the package after dimensions change and retires invalid or inactive assets',()=>{
  const view=render(<Harness/>);
  settle();
  view.rerender(<Harness items={[{...item,width:item.width+.2}]}/>);
  settle();
  expect(create).toHaveBeenCalledTimes(2);expect(revoke).toHaveBeenCalledWith('blob:scene-1');
  view.rerender(<Harness enabled={false}/>);
  expect(screen.queryByRole('link')).toBeNull();expect(revoke).toHaveBeenCalledWith('blob:scene-2');
  vi.mocked(buildFurnitureUSDZ).mockImplementation(()=>{throw new Error('Invalid furniture dimensions');});
  view.rerender(<Harness items={[{...item,width:NaN}]}/>);
  settle();
  expect(screen.queryByRole('link')).toBeNull();expect(screen.getByText('Invalid furniture dimensions')).toBeTruthy();
});

it('exports only the final arrangement after a burst of dragging updates',()=>{
  const view=render(<Harness/>);settle();
  for(let i=1;i<=8;i++)view.rerender(<Harness items={[{...item,width:item.width+i/10}]}/>);
  expect(create).toHaveBeenCalledOnce();
  expect(screen.queryByRole('link')).toBeNull();
  settle();
  expect(create).toHaveBeenCalledTimes(2);
  expect(vi.mocked(buildFurnitureUSDZ).mock.calls.at(-1)![0][0].width).toBe(item.width+.8);
});

it('explains an unavailable preview without leaving an endless preparation state',()=>{
  render(<QuickLookLink url="" onOpen={()=>{}} unavailableReason="Choose furniture first"/>);
  expect((screen.getByRole('button',{name:'Choose furniture first'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Preparing AR preview…')).toBeNull();
});

it('retries a failed export without requiring a furniture edit',()=>{
  vi.mocked(buildFurnitureUSDZ).mockImplementationOnce(()=>{throw new Error('Temporary export failure');});
  render(<Harness/>);settle();
  expect(screen.getByText('Temporary export failure')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Retry export'}));settle();
  expect(screen.getByRole('link',{name:'View in my room'})).toBeTruthy();
  expect(screen.queryByText('Temporary export failure')).toBeNull();
});
