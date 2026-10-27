import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { connectionDiagnostics, testAIConnection } from './api';
import type { AIIntegration, ConnectionDiagnostics } from './types';
import { useWorkspaceAccess } from './access';

const statuses: Record<string, string> = {
  not_tested: 'Not tested', testing: 'Testing', success: 'Real inference succeeded',
  validated_test_response: 'Mock response validated; no live success', missing_credentials: 'Missing credentials',
  invalid_credentials: 'Invalid or revoked credentials', insufficient_credits: 'Insufficient credits / billing issue',
  unsupported_model_access: 'Model unavailable or access denied', timeout: 'Timed out', malformed_response: 'Malformed or incomplete response',
  rate_limited: 'Rate limited', network_error: 'Network error', provider_error: 'Provider error',
  blocked_deployment_contract: 'Deployment contract required', interrupted: 'Test interrupted', configured_not_verified: 'Configured, unverified',
  blocked: 'Blocked', checking: 'Checking', needs_retest: 'Needs a new connection check', verified: 'Verified in this server process', unverified: 'Awaiting a live connection check',
};
const sources: Record<string, string> = { root_dotenv: 'root .env', process_environment: 'process environment', runtime_environment: 'changed process environment', default_or_unset: 'no explicit setting' };

interface Props { busy: string | null; onBusy: (value: string | null) => void }
export default function ConnectionStatus({ busy, onBusy }: Props) {
  const judge = useWorkspaceAccess() === 'judge';
  const [diagnostics, setDiagnostics] = useState<ConnectionDiagnostics | null>(null);
  const [integration, setIntegration] = useState<AIIntegration>('muse');
  const [pending, setPending] = useState(false);
  const lock=useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if(busy)return;
    let mounted = true;
    connectionDiagnostics().then(value => { if (mounted) { setDiagnostics(value); setError(null); } }).catch(() => { if (mounted) setError('Connection diagnostics are unavailable. The manual workflow is still available.'); });
    return () => { mounted = false; };
  }, [busy]);
  async function refresh() {
    if(lock.current||busy)return;lock.current=true;
    setPending(true); setError(null);
    try { setDiagnostics(await connectionDiagnostics()); }
    catch { setError('Could not refresh connection diagnostics.'); }
    finally { lock.current=false;setPending(false); }
  }
  async function test() {
    if(judge||busy||lock.current)return;lock.current=true;
    setPending(true); setError(null); onBusy(`Testing ${integration === 'muse' ? 'Muse Spark' : 'SAM 3.1'} connection…`);
    try { setDiagnostics(await testAIConnection(integration)); }
    catch (e) { setError(e instanceof Error ? e.message : 'The connection test could not finish. No live success is assumed.'); }
    finally { lock.current=false;setPending(false); onBusy(null); }
  }
  return <div className="connection-status" aria-label="AI Connection Status">
    <div className="connection-title"><h3><ShieldCheck size={14}/> AI Connection Status</h3><button className="icon-button" aria-label="Refresh AI connection status" disabled={!!busy || pending} onClick={() => void refresh()}><RefreshCw size={13}/></button></div>
    <p className="ai-provider-state">Selected SAM provider: <strong>{diagnostics?.selected_sam_provider ?? 'Unknown'}</strong></p>
    {!diagnostics && !error && <p className="ai-help">Reading backend configuration…</p>}
    {diagnostics?.configuration_error && <p className="connection-error" role="alert">{diagnostics.configuration_error}</p>}
    {diagnostics?.environment?.restart_required && <p className="connection-error" role="alert">{diagnostics.environment.message}</p>}
    {(['muse', 'sam'] as const).map(name => {
      const entry = diagnostics?.integrations[name];
      if (!entry) return null;
      const checked = entry.last_test;
      const latest=entry.last_inference;
      const lastSuccess=latest?.live_request?latest.inferred_at:checked.last_success_at;
      const latency=latest?.inference_latency_ms??checked.inference_latency_ms;
      const usage=latest?.usage??checked.usage;
      const readiness=entry.readiness;
      const credential=readiness&&diagnostics?.environment?.variables[readiness.required_variable];
      return <div className="connection-model" key={name}>
        <strong>{name === 'muse' ? `${entry.provider==='baseten'?'Baseten ':''}Muse Spark` : 'SAM 3.1'}</strong>
        <p>Provider: <strong>{entry.provider==='baseten'?'Baseten':'Meta Model API'}</strong></p><p>Model: {entry.model??'Not configured'}</p>
        <p>Configuration: {statuses[entry.configuration.status] ?? entry.configuration.status}</p>
        {readiness && <><p>Readiness: <strong className={readiness.status==='verified'?'connection-success':''}>{statuses[readiness.status]??readiness.status}</strong></p><p className="ai-help">{readiness.message}</p></>}
        {credential && <p className="connection-time">{readiness!.required_variable}: {credential.state} · {sources[credential.source]??credential.source}</p>}
        {credential?.empty_process_override && <p className="connection-error" role="alert">An empty process variable overrides the value in root .env. Remove that override from the backend launch environment and restart. No credential has been replaced.</p>}
        <p>Last test: <span className={checked.live_request_succeeded ? 'connection-success' : ''}>{statuses[checked.status] ?? checked.status}</span></p>
        <p>Real request successfully tested: <strong>{checked.ever_live_request_succeeded||latest?.live_request ? 'Yes' : 'No'}</strong></p>
        {checked.last_attempt_at && <p className="connection-time">Last attempt: {new Date(checked.last_attempt_at).toLocaleString()}</p>}
        {lastSuccess && <p className="connection-time">Last successful inference: {new Date(lastSuccess).toLocaleString()}{latest?.operation?` · ${latest.operation.replaceAll('_',' ')}`:''}</p>}
        {entry.last_failure&&<p className="connection-error">Last failed request: {entry.last_failure.message} {new Date(entry.last_failure.failed_at).toLocaleString()} · {entry.last_failure.inference_latency_ms.toLocaleString()} ms{entry.last_failure.provider_http_status?` · provider HTTP ${entry.last_failure.provider_http_status}`:''}</p>}
        <p className="connection-time">Inference latency: {latency==null?'Not measured':`${latency.toLocaleString()} ms`}{usage?.total_tokens!=null?` · ${usage.total_tokens.toLocaleString()} tokens`:''}</p>
        {entry.fallback_available&&<p className="ai-help">Meta reasoning fallback is configured. Results identify the provider that actually answered.</p>}
        <p className="ai-help">{checked.status === 'not_tested' ? entry.configuration.message : checked.message}</p>
      </div>;
    })}
    {diagnostics?.environment && <details className="ai-help"><summary>Backend configuration loading</summary><p>{diagnostics.environment.precedence}</p><p>{diagnostics.environment.message}</p><p>Root .env: {diagnostics.environment.dotenv_status}. Parse errors: {diagnostics.environment.parse_errors}. Repeated AI settings: {diagnostics.environment.duplicate_assignments}.</p></details>}
    {judge&&<p className="ai-help">Connection probes require owner access. You can run AI scans and explanations in the separate demo workspace.</p>}
    <label className="connection-select">Test model<select aria-label="AI connection test model" value={integration} disabled={judge || !!busy || pending} onChange={e => setIntegration(e.target.value as AIIntegration)}><option value="muse">{diagnostics?.integrations.muse?.provider==='baseten'?'Baseten Muse Spark':'Muse Spark'}</option><option value="sam">SAM 3.1 · selected provider</option></select></label>
    <button className="secondary full-width" disabled={judge || !!busy || pending || !diagnostics || !!diagnostics.configuration_error || diagnostics.integrations[integration]?.readiness?.status==='blocked'} onClick={() => void test()}>{pending ? <LoaderCircle size={14} className="spin"/> : <ShieldCheck size={14}/>} Test AI Connection</button>
    <p className="ai-help">One explicit inference request, which may use credits. Muse uses test text; Meta SAM uses a generated image. Your scene is not sent. Baseten SAM stays blocked without its verified contract.</p>
    <p className="connection-time">History is per server process and configuration; a restart clears it. A successful probe does not establish scene accuracy or every AI feature.</p>
    {error && <p className="connection-error" role="alert">{error}</p>}
  </div>;
}
