// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConnectionStatus from './ConnectionStatus';
import { diagnosticFixture } from './test-fixtures/connection';

vi.mock('./api', () => ({ connectionDiagnostics: vi.fn(), testAIConnection: vi.fn() }));
import { connectionDiagnostics, testAIConnection } from './api';
const onBusy = vi.fn();
beforeEach(() => { vi.mocked(connectionDiagnostics).mockResolvedValue(diagnosticFixture()); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows configured keys as unverified and never tests automatically', async () => {
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  await screen.findAllByText(/Configured, unverified/);
  expect(testAIConnection).not.toHaveBeenCalled();
  expect(screen.getAllByText('No', { exact: true })).toHaveLength(2);
  expect(screen.queryByText('Real inference succeeded')).toBeNull();
});

it('tests the selected integration only after an explicit click', async () => {
  vi.mocked(testAIConnection).mockResolvedValue(diagnosticFixture('invalid_credentials'));
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  await screen.findAllByText(/Configured, unverified/);
  fireEvent.change(screen.getByLabelText('AI connection test model'), { target: { value: 'sam' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test AI Connection' }));
  await waitFor(() => expect(testAIConnection).toHaveBeenCalledWith('sam'));
  expect(onBusy).toHaveBeenLastCalledWith(null);
});

it.each(['invalid_credentials', 'insufficient_credits', 'unsupported_model_access', 'timeout', 'malformed_response'])('shows %s without connected status', async status => {
  vi.mocked(testAIConnection).mockResolvedValue(diagnosticFixture(status));
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  await screen.findAllByText(/Configured, unverified/);
  fireEvent.click(screen.getByRole('button', { name: 'Test AI Connection' }));
  await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(null));
  const labels: Record<string, string> = { invalid_credentials: 'Invalid or revoked credentials', insufficient_credits: 'Insufficient credits / billing issue', unsupported_model_access: 'Model unavailable or access denied', timeout: 'Timed out', malformed_response: 'Malformed or incomplete response' };
  expect(screen.getByText(labels[status])).toBeTruthy();
  expect(screen.queryByText('Real inference succeeded')).toBeNull();
  expect(screen.getAllByText('No', { exact: true })).toHaveLength(2);
});

it('shows successful real tests per model and keeps the other model unverified', async () => {
  vi.mocked(testAIConnection).mockResolvedValue(diagnosticFixture('success', true));
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  await screen.findAllByText(/Configured, unverified/);
  fireEvent.click(screen.getByRole('button', { name: 'Test AI Connection' }));
  await screen.findByText('Real inference succeeded');
  expect(screen.getAllByText('Yes', { exact: true })).toHaveLength(1);
  expect(screen.getAllByText('No', { exact: true })).toHaveLength(1);
});

it('reports diagnostics fetch failures without blocking the manual workflow', async () => {
  vi.mocked(connectionDiagnostics).mockRejectedValueOnce(new Error('offline'));
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText(/manual workflow is still available/)).toBeTruthy();
  expect(testAIConnection).not.toHaveBeenCalled();
});
