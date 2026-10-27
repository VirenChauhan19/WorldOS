import { Capacitor } from '@capacitor/core';

let token = '';
let csrf = '';
let selected: string|null = null;
let generation = 0;
const storageKey = 'worldos.backendUrl';

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
  selected = clean;
  try { localStorage.setItem(storageKey, clean); } catch { /* Still works for this session. */ }
}

export function setAccessToken(value: string) { token = value; csrf = ''; generation++; }
export function setCookieSession(value: string) { csrf = value; token = ''; generation++; }
export function usesCookies() { return !Capacitor.isNativePlatform() && (!backendURL() || backendURL()===window.location.origin); }
export function requestScope() { return `${backendURL()}:${generation}`; }
export function nativeNeedsBackend() { return Capacitor.isNativePlatform() && !backendURL(); }

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  if (navigator.onLine === false) throw new Error('You are offline. Photos, saved inspections, and AI requests need the backend. No action was queued.');
  if (nativeNeedsBackend()) throw new Error('Connect the app to your HTTPS WorldOS backend first.');
  const current=generation;
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const cookies=usesCookies();
  if(cookies&&csrf&&!['GET','HEAD'].includes((options.method??'GET').toUpperCase()))headers.set('X-CSRF-Token',csrf);
  const response = await fetch(`${backendURL()}/api/${path}`, { ...options, headers, cache: 'no-store', credentials: cookies?'same-origin':'omit', redirect: 'error' });
  if(current!==generation)throw new Error('The connection changed. The earlier response was discarded; retry on the selected backend.');
  if (response.status === 401 && !path.startsWith('auth/')) {
    token = '';csrf='';generation++;
    window.dispatchEvent(new Event('worldos:session-expired'));
  }
  return response;
}
