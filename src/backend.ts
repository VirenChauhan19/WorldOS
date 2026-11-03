import { Capacitor } from '@capacitor/core';

let token = '';
let csrf = '';
let selected: string|null = null;
let generation = 0;
let sessionExpired = false;
const storageKey = 'worldos.backendUrl';
interface DemoSession { required: boolean; authenticated: boolean; access: 'owner'|'judge'|'guest'; session_mode: 'cookie'; csrf_token: string; demo_enabled: boolean; storage_mode?: string; judge_enabled?: boolean; judge_expires_at?: string|null }
let demoPending: { generation: number; promise: Promise<DemoSession> }|null = null;

export function beginDemoSession(): Promise<DemoSession> {
  if (!usesCookies()) return Promise.reject(new Error('Open this WorldOS website in your browser to use the demo.'));
  if (demoPending?.generation === generation) return demoPending.promise;
  const current = generation, origin = backendURL();
  const promise = (async () => {
    const response = await fetch(`${origin}/api/auth/demo`, { method:'POST', cache:'no-store', credentials:'same-origin', redirect:'error', signal:AbortSignal.timeout(75000) });
    const data = await response.json();
    if (current !== generation) throw new Error('The connection changed. Retry on the selected backend.');
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Demo access is temporarily unavailable. Retry connection.');
    if (data.authenticated !== true || data.session_mode !== 'cookie' || typeof data.csrf_token !== 'string' || !['guest','owner','judge'].includes(data.access)) throw new Error('The backend returned an invalid demo session.');
    csrf = data.csrf_token; token = ''; sessionExpired = false;
    return data as DemoSession;
  })().finally(() => { if (demoPending?.generation === current) demoPending = null; });
  demoPending = { generation:current, promise };
  return promise;
}

export function validateBackendURL(value: string, allowLocal = import.meta.env.DEV): string {
  if (!value.trim()) return '';
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a full HTTPS backend address.'); }
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) || (!allowLocal && local)) {
    throw new Error('Use an HTTPS backend origin without a path, credentials, or query parameters.');
  }
  return url.origin;
}

export function backendURL(): string {
  if (selected!==null) return selected;
  let saved: string|null = null;
  try { saved = localStorage.getItem(storageKey); } catch { /* Storage may be disabled. */ }
  return validateBackendURL(saved ?? import.meta.env.VITE_API_BASE_URL ?? '');
}

export function configureBackend(value: string) {
  const clean = validateBackendURL(value);
  if (Capacitor.isNativePlatform() && !clean) throw new Error('The native app needs your HTTPS backend address.');
  token = '';
  csrf = '';
  generation++;
  sessionExpired = false;
  selected = clean;
  try { localStorage.setItem(storageKey, clean); } catch { /* Still works for this session. */ }
}

export function setAccessToken(value: string) { token = value; csrf = ''; sessionExpired = false; generation++; }
export function setCookieSession(value: string) { csrf = value; token = ''; sessionExpired = false; generation++; }
export function usesCookies() { return !Capacitor.isNativePlatform() && (!backendURL() || backendURL()===window.location.origin); }
export function requestScope() { return `${backendURL()}:${generation}`; }
export function nativeNeedsBackend() { return Capacitor.isNativePlatform() && !backendURL(); }

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  if (sessionExpired && !path.startsWith('auth/')) throw new Error('Your session expired. Sign in to resume your draft, then retry the action.');
  if (navigator.onLine === false) throw new Error('You are offline. Photos, saved inspections, and AI requests need the backend. No action was queued.');
  if (nativeNeedsBackend()) throw new Error('Connect the app to your HTTPS WorldOS backend first.');
  const current=generation;
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const cookies=usesCookies();
  if(cookies&&csrf&&!['GET','HEAD'].includes((options.method??'GET').toUpperCase()))headers.set('X-CSRF-Token',csrf);
  const send=()=>fetch(`${backendURL()}/api/${path}`, { ...options, headers, cache: 'no-store', credentials: cookies?'same-origin':'omit', redirect: 'error' });
  let response=await send();
  // Only this explicit pre-execution rejection can open a public demo and
  // retry the original action. Expired owner sessions keep their login gate.
  if(current===generation&&cookies&&!path.startsWith('auth/')&&response.status===401&&response.headers.get('X-WorldOS-Error-Code')==='demo_available'){
    await beginDemoSession();
    if(current!==generation)throw new Error('The connection changed. Retry on the selected backend.');
    if(!['GET','HEAD'].includes((options.method??'GET').toUpperCase()))headers.set('X-CSRF-Token',csrf);
    response=await send();
  }
  // The server guarantees this rejection happens before the action executes.
  // Restore an existing cookie session after reload, then retry this action once.
  if(current===generation&&cookies&&!path.startsWith('auth/')&&response.status===403&&response.headers.get('X-WorldOS-Error-Code')==='csrf_required'){
    const status=await fetch(`${backendURL()}/api/auth/status`,{signal:options.signal,cache:'no-store',credentials:'same-origin',redirect:'error'});
    const session=status.ok?await status.json().catch(()=>null):null;
    if(current!==generation)throw new Error('The connection changed. Retry on the selected backend.');
    if(session?.authenticated===true&&session.session_mode==='cookie'&&typeof session.csrf_token==='string'){
      csrf=session.csrf_token;headers.set('X-CSRF-Token',csrf);response=await send();
    }
  }
  if(current!==generation)throw new Error('The connection changed. The earlier response was discarded; retry on the selected backend.');
  if (response.status === 401 && !path.startsWith('auth/')) {
    token = '';csrf='';generation++;
    sessionExpired = true;
    window.dispatchEvent(new Event('worldos:session-expired'));
  }
  return response;
}
