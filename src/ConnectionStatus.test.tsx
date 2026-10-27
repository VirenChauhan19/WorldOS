// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConnectionStatus from './ConnectionStatus';
import { diagnosticFixture } from './test-fixtures/connection';
import type { BackendEnvironmentStatus } from './types';
import { AccessContext } from './access';

vi.mock('./api', () => ({ connectionDiagnostics: vi.fn(), testAIConnection: vi.fn() }));
import { connectionDiagnostics, testAIConnection } from './api';
const onBusy = vi.fn();
beforeEach(() => { vi.mocked(connectionDiagnostics).mockResolvedValue(diagnosticFixture()); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows readiness to judges but disables owner-only connection probes', async()=>{
  render(<AccessContext.Provider value="judge"><ConnectionStatus busy={null} onBusy={onBusy}/></AccessContext.Provider>);
  await screen.findAllByText(/Configured, unverified/);
  expect(screen.getByRole('button',{name:'Test AI Connection'}).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Test AI Connection'}));
  expect(testAIConnection).not.toHaveBeenCalled();
  expect(screen.getByText(/Connection probes require owner access/)).toBeTruthy();
});

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

it('shows the configured Baseten provider and model without assuming live success',async()=>{
  const fixture=diagnosticFixture();fixture.integrations.muse={...fixture.integrations.muse!,provider:'baseten',model:'meta-models/muse-spark-open-1026',fallback_available:true};
  vi.mocked(connectionDiagnostics).mockResolvedValue(fixture);
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  await screen.findByText('Model: meta-models/muse-spark-open-1026');
  expect(screen.getByText('Baseten',{exact:true})).toBeTruthy();expect(screen.getAllByText('No',{exact:true})).toHaveLength(2);
  expect(screen.getByText(/Meta reasoning fallback is configured/)).toBeTruthy();expect(testAIConnection).not.toHaveBeenCalled();
});

it('shows latency and last successful application inference separately from connection probes',async()=>{
  // Synthetic UI fixture only; no provider request in this test.
  const fixture=diagnosticFixture();fixture.integrations.muse={...fixture.integrations.muse!,provider:'baseten',model:'meta-models/muse-spark-open-1026',last_inference:{provider:'baseten',model:'meta-models/muse-spark-open-1026',operation:'interpret_goal',live_request:true,inferred_at:'2026-10-26T12:00:00Z',inference_latency_ms:1234,usage:{total_tokens:200}}};
  vi.mocked(connectionDiagnostics).mockResolvedValue(fixture);
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  expect(await screen.findByText(/Inference latency: 1,234 ms/)).toBeTruthy();
  expect(screen.getByText(/Last successful inference:.*interpret goal/)).toBeTruthy();
  expect(screen.getAllByText('Yes',{exact:true})).toHaveLength(1);expect(testAIConnection).not.toHaveBeenCalled();
});

function environmentFixture(): BackendEnvironmentStatus {
  return {dotenv_file:'repository root .env',dotenv_status:'readable',precedence:'process environment (including empty values) > root .env > defaults',restart_required:false,parse_errors:0,duplicate_assignments:0,message:'Restart after configuration changes.',variables:{MODEL_API_KEY:{state:'empty',source:'root_dotenv',dotenv_assignment:'empty',empty_process_override:false},BASETEN_API_KEY:{state:'set',source:'root_dotenv',dotenv_assignment:'set',empty_process_override:false}}};
}

it('shows independent readiness and the exact missing variable without making a request',async()=>{
  const fixture=diagnosticFixture();
  fixture.environment=environmentFixture();
  fixture.integrations.sam!.readiness={status:'blocked',required_variable:'MODEL_API_KEY',message:'Set MODEL_API_KEY on the backend.'};
  fixture.integrations.muse!.provider='baseten';
  fixture.integrations.muse!.readiness={status:'unverified',required_variable:'BASETEN_API_KEY',message:'Run an explicit connection check.'};
  vi.mocked(connectionDiagnostics).mockResolvedValue(fixture);
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  await screen.findByText('Blocked');
  expect(screen.getByText('MODEL_API_KEY: empty · root .env')).toBeTruthy();
  expect(screen.getByText('BASETEN_API_KEY: set · root .env')).toBeTruthy();
  const testButton=screen.getByRole('button',{name:'Test AI Connection'}) as HTMLButtonElement;
  expect(testButton.disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('AI connection test model'),{target:{value:'sam'}});
  expect(testButton.disabled).toBe(true);
  fireEvent.click(testButton);
  expect(testAIConnection).not.toHaveBeenCalled();
});

it('shows a failed readiness check even when historical success remains visible',async()=>{
  const fixture=diagnosticFixture('timeout');
  fixture.integrations.muse!.last_test.ever_live_request_succeeded=true;
  fixture.integrations.muse!.readiness={status:'needs_retest',required_variable:'MODEL_API_KEY',message:'The latest connection check failed. Earlier success is historical.'};
  vi.mocked(connectionDiagnostics).mockResolvedValue(fixture);
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  await screen.findByText('Needs a new connection check');
  expect(screen.getByText(/Earlier success is historical/)).toBeTruthy();
  expect(screen.queryByText('Verified in this server process')).toBeNull();
  expect(screen.getByText('Yes',{exact:true})).toBeTruthy();
});

it('explains a blank process override and flags dotenv edits requiring restart',async()=>{
  const fixture=diagnosticFixture();
  fixture.environment=environmentFixture();
  fixture.environment.restart_required=true;
  fixture.environment.message='Root .env changed after startup. Restart the backend to reload it.';
  fixture.environment.variables.MODEL_API_KEY={state:'empty',source:'process_environment',dotenv_assignment:'set',empty_process_override:true};
  fixture.integrations.sam!.readiness={status:'blocked',required_variable:'MODEL_API_KEY',message:'Set MODEL_API_KEY on the backend.'};
  vi.mocked(connectionDiagnostics).mockResolvedValue(fixture);
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  await screen.findByText(/An empty process variable overrides/);
  expect(screen.getAllByText(/Root .env changed after startup/).length).toBeGreaterThan(0);
  expect(testAIConnection).not.toHaveBeenCalled();
});

it('clears a diagnostics error after a successful passive refresh',async()=>{
  vi.mocked(connectionDiagnostics).mockRejectedValueOnce(new Error('offline'));
  render(<ConnectionStatus busy={null} onBusy={onBusy}/>);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button',{name:'Refresh AI connection status'}));
  await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
  expect(testAIConnection).not.toHaveBeenCalled();
});
