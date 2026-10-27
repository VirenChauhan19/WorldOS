// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import FirstInspectionGuide from './FirstInspectionGuide';
afterEach(cleanup);
it('guides an actual four-object trial without inventing any result',()=>{
  render(<FirstInspectionGuide/>);
  expect(screen.getByText(/Use a second camera/)).toBeTruthy();
  expect(screen.getByText(/smartphone, mouse, notebook, mug/)).toBeTruthy();
  expect(screen.getByText(/do not reuse the reference/)).toBeTruthy();
  expect(screen.queryByText('Recorded results')).toBeNull();
});
