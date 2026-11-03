// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import UsabilitySession from './UsabilitySession';
import { exportJSON } from '../exportFile';
vi.mock('../exportFile',()=>({exportJSON:vi.fn(async()=>{})}));
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();});

it('restores notes and assistance after leaving and reopening settings',()=>{
  const view=render(<UsabilitySession/>);
  fireEvent.change(screen.getByLabelText('What confused them or went wrong?'),{target:{value:'Could not find the next step'}});
  fireEvent.change(screen.getByLabelText('Did they need help?'),{target:{value:'assisted'}});
  view.unmount();render(<UsabilitySession/>);
  expect(screen.getByLabelText('What confused them or went wrong?')).toHaveProperty('value','Could not find the next step');
  expect(screen.getByLabelText('Did they need help?')).toHaveProperty('value','assisted');
});
it('exports the old session before starting a separate recording',async()=>{
  localStorage.setItem('worldos.study.notes','First participant');
  localStorage.setItem('worldos.study.events','[{"event":"first_step","at":1}]');
  render(<UsabilitySession/>);
  fireEvent.click(screen.getByText('Export and start a new session'));
  await waitFor(()=>expect(screen.getByLabelText('What confused them or went wrong?')).toHaveProperty('value',''));
  expect(exportJSON).toHaveBeenCalledWith(expect.objectContaining({notes:'First participant',events:[{event:'first_step',at:1}]}),expect.any(String));
  expect(localStorage.getItem('worldos.study.events')).toBe('[]');
  expect(localStorage.getItem('worldos.study.enabled')).toBe('yes');
});
