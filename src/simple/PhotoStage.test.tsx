// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PhotoStage from './PhotoStage';
import type { Movement, SceneObject } from '../types';

const image = { image_url: '/original-photo.jpg', width: 1600, height: 1067, name: 'Desk photo' };
const phone: SceneObject = { id: 'phone', label: 'Phone', box: { x: .45, y: .65, width: .07, height: .2 }, locked: false };
const movement: Movement = { number: 1, object_id: phone.id, label: phone.label, source: phone.box, destination: { ...phone.box, x: .72 }, instruction: 'Lift the phone to its saved position.' };
afterEach(cleanup);

it('uses a supplied image description for an illustrative preview', () => {
  render(<PhotoStage image={image} imageAlt="Example desk with illustrative photo guidance"/>);
  expect(screen.getByAltText('Example desk with illustrative photo guidance').getAttribute('src')).toBe(image.image_url);
  expect(screen.queryByAltText('Your space')).toBeNull();
});

it('lets people compare with the untouched photo and restores the movement overlay', () => {
  render(<PhotoStage image={image} objects={[phone]} move={movement}/>);
  expect(screen.getByText('Place here')).toBeTruthy();
  const original = screen.getByAltText('Your space');
  fireEvent.click(screen.getByRole('button', { name: 'Hide outlines' }));
  expect(screen.queryByText('Place here')).toBeNull();
  expect(screen.getByAltText('Your space')).toBe(original);
  expect(original.getAttribute('src')).toBe(image.image_url);
  expect(screen.getByRole('button', { name: 'Show outlines' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Show outlines' }));
  expect(screen.getByText('Place here')).toBeTruthy();
});

it('keeps keyboard marking in normalized photo coordinates and rejects an empty outline', () => {
  const onMark = vi.fn();
  render(<PhotoStage image={image} mark="Phone" onMark={onMark}/>);
  const photo = screen.getByRole('button', { name: 'Mark Phone on the photo' });
  fireEvent.keyDown(photo, { key: 'Enter' });
  fireEvent.keyDown(photo, { key: 'Enter' });
  expect(onMark).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('opposite corner');
  fireEvent.keyDown(photo, { key: 'ArrowRight', shiftKey: true });
  fireEvent.keyDown(photo, { key: 'ArrowDown', shiftKey: true });
  fireEvent.keyDown(photo, { key: 'Enter' });
  expect(onMark).toHaveBeenCalledTimes(1);
  const box = onMark.mock.calls[0][0];
  expect(box.x).toBeCloseTo(.35);
  expect(box.y).toBeCloseTo(.35);
  expect(box.width).toBeCloseTo(.05);
  expect(box.height).toBeCloseTo(.05);
});

it('discards a partial mark when the photo changes', () => {
  const onMark = vi.fn();
  const { rerender } = render(<PhotoStage image={image} mark="Phone" onMark={onMark}/>);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Mark Phone on the photo' }), { key: 'Enter' });
  rerender(<PhotoStage image={{ ...image, image_url: '/new-photo.jpg' }} mark="Phone" onMark={onMark}/>);
  const photo = screen.getByRole('button', { name: 'Mark Phone on the photo' });
  fireEvent.keyDown(photo, { key: 'ArrowRight', shiftKey: true });
  fireEvent.keyDown(photo, { key: 'ArrowDown', shiftKey: true });
  fireEvent.keyDown(photo, { key: 'Enter' });
  expect(onMark).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toContain('Now tap the opposite corner.');
});

it('describes review and protection states without asserting detection accuracy', () => {
  render(<PhotoStage image={image} objects={[phone, { ...phone, id: 'keyboard', label: 'Keyboard', locked: true }]} highlight={['phone']}/>);
  const photo = screen.getByRole('group', { name: 'Photograph with spatial guidance' });
  const description = document.getElementById(photo.getAttribute('aria-describedby')!);
  expect(description?.textContent).toContain('Phone (review needed)');
  expect(description?.textContent).toContain('Keyboard (protected)');
  expect(description?.textContent).not.toMatch(/verified|confidence|live/i);
});
