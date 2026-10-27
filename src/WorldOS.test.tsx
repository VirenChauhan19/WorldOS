// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./App',()=>({default:()=> <input aria-label="Desk session" defaultValue="Desk"/>}));
vi.mock('./inspect/Inspect',()=>({default:()=> <input aria-label="Inspect session" defaultValue="Inspect"/>}));
import WorldOS from './WorldOS';
afterEach(cleanup);
it('preserves both product sessions while switching views',()=>{
  render(<WorldOS/>);fireEvent.change(screen.getByLabelText('Inspect session'),{target:{value:'My workspace'}});
  fireEvent.click(screen.getByRole('button',{name:'Spatial Studio'}));fireEvent.change(screen.getByLabelText('Desk session'),{target:{value:'My desk'}});
  fireEvent.click(screen.getByRole('button',{name:'WorldOS Inspect'}));expect((screen.getByLabelText('Inspect session') as HTMLInputElement).value).toBe('My workspace');
  fireEvent.click(screen.getByRole('button',{name:'Spatial Studio'}));expect((screen.getByLabelText('Desk session') as HTMLInputElement).value).toBe('My desk');
});
