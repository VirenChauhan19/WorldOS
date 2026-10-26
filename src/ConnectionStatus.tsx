import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { connectionDiagnostics, testAIConnection } from './api';
import type { AIIntegration, ConnectionDiagnostics } from './types';

const statuses: Record<string, string> = {
  not_tested: 'Not tested', testing: 'Testing', success: 'Real inference succeeded',
  validated_test_response: 'Mock response validated; no live success', missing_credentials: 'Missing credentials',
  invalid_credentials: 'Invalid or revoked credentials', insufficient_credits: 'Insufficient credits / billing issue',
  unsupported_model_access: 'Model unavailable or access denied', timeout: 'Timed out', malformed_response: 'Malformed or incomplete response',
  rate_limited: 'Rate limited', network_error: 'Network error', provider_error: 'Provider error',
  blocked_deployment_contract: 'Deployment contract required', interrupted: 'Test interrupted', configured_not_verified: 'Configured, unverified',
};

interface Props { busy: string | null; onBusy: (value: string | null) => void }
export default function ConnectionStatus({ busy, onBusy }: Props) {
  const [diagnostics, setDiagnostics] = useState<ConnectionDiagnostics | null>(null);
  const [integration, setIntegration] = useState<AIIntegration>('muse');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    connectionDiagnostics().then(value => { if (mounted) setDiagnostics(value); }).catch(() => { if (mounted) setError('Connection diagnostics are unavailable. The manual workflow is still available.'); });
    return () => { mounted = false; };
  }, []);
  async function refresh() {
    setPending(true); setError(null);
    try { setDiagnostics(await connectionDiagnostics()); }
    catch { setError('Could not refresh connection diagnostics.'); }
    finally { setPending(false); }
  }
  async function test() {
    setPending(true); setError(null); onBusy(`Testing ${integration === 'muse' ? 'Muse Spark' : 'SAM 3.1'} connection…`);
    try { setDiagnostics(await testAIConnection(integration)); }
    catch (e) { setError(e instanceof Error ? e.message : 'The connection test could not finish. No live success is assumed.'); }
    finally { setPending(false); onBusy(null); }
  }
  return <div className="connection-status" aria-label="AI Connection Status">
    <div className="connection-title"><h3><ShieldCheck size={14}/> AI Connection Status</h3><button className="icon-button" aria-label="Refresh AI connection status" disabled={!!busy || pending} onClick={() => void refresh()}><RefreshCw size={13}/></button></div>
    <p className="ai-provider-state">Selected SAM provider: <strong>{diagnostics?.selected_sam_provider ?? 'Unknown'}</strong></p>
    {!diagnostics && !error && <p className="ai-help">Reading backend configuration…</p>}
    {diagnostics?.configuration_error && <p className="connection-error" role="alert">{diagnostics.configuration_error}</p>}
    {(['muse', 'sam'] as const).map(name => {
      const entry = diagnostics?.integrations[name];
      if (!entry) return null;
      const checked = entry.last_test;
      return <div className="connection-model" key={name}>
        <strong>{name === 'muse' ? 'Muse Spark' : 'SAM 3.1'}</strong>
        <p>Configuration: {statuses[entry.configuration.status] ?? entry.configuration.status}</p>
        <p>Last test: <span className={checked.live_request_succeeded ? 'connection-success' : ''}>{statuses[checked.status] ?? checked.status}</span></p>
        <p>Real request successfully tested: <strong>{checked.ever_live_request_succeeded ? 'Yes' : 'No'}</strong></p>
        {checked.last_attempt_at && <p className="connection-time">Last attempt: {new Date(checked.last_attempt_at).toLocaleString()}</p>}
        {checked.last_success_at && <p className="connection-time">Last real success: {new Date(checked.last_success_at).toLocaleString()}</p>}
        <p className="ai-help">{checked.status === 'not_tested' ? entry.configuration.message : checked.message}</p>
      </div>;
    })}
    <label className="connection-select">Test model<select aria-label="AI connection test model" value={integration} disabled={!!busy || pending} onChange={e => setIntegration(e.target.value as AIIntegration)}><option value="muse">Muse Spark</option><option value="sam">SAM 3.1 · selected provider</option></select></label>
    <button className="secondary full-width" disabled={!!busy || pending || !diagnostics || !!diagnostics.configuration_error} onClick={() => void test()}>{pending ? <LoaderCircle size={14} className="spin"/> : <ShieldCheck size={14}/>} Test AI Connection</button>
    <p className="ai-help">One explicit inference request, which may use credits. Muse uses test text; Meta SAM uses a generated image. Your scene is not sent. Baseten SAM stays blocked without its verified contract.</p>
    <p className="connection-time">History is per server process and configuration; a restart clears it. A successful probe does not establish scene accuracy or every AI feature.</p>
    {error && <p className="connection-error" role="alert">{error}</p>}
  </div>;
}
