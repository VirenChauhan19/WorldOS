import type { AICapabilities, AIAnalysis, AIIntegration, Analysis, Box, ConnectionDiagnostics, Plan, PlanRequest, Reasoning, SceneObject, SceneAnswer, Verification, VisualVerification, ReviewedState, ReplanResult } from './types';
import { apiFetch, requestScope } from './backend';

const pending = new Map<string, Promise<unknown>>();
export class APIError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly errorCode: string | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null, errorCode: string | null = null) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.errorCode = errorCode;
  }
}

export function request<T>(path: string, options?: RequestInit, timeoutMs = 60000): Promise<T> {
  // Share identical in-flight AI actions only. Never persist image bodies/results in browser storage.
  // A caller-owned cancellation signal must never cancel another caller's request.
  if (options?.signal || !['ai/analyze', 'ai/reason', 'ai/verify'].includes(path)) return sendRequest<T>(path, options, timeoutMs);
  const key = `${requestScope()}:${path}:${options?.body ?? ''}`;
  const previous = pending.get(key);
  if (previous) return previous as Promise<T>;
  const operation = sendRequest<T>(path, options, timeoutMs);
  pending.set(key, operation);
  const clear = () => { pending.delete(key); };
  void operation.then(clear, clear);
  return operation;
}

async function sendRequest<T>(path: string, options?: RequestInit, timeoutMs = 60000): Promise<T> {
  const controller = new AbortController();
  const externalSignal = options?.signal;
  const cancel = () => controller.abort();
  externalSignal?.addEventListener('abort', cancel, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (externalSignal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
    const response = await apiFetch(path, { ...options, signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = body?.detail;
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterMs = retryAfter === null ? NaN : /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
      throw new APIError(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: {msg: string}) => d.msg).join('; ') : `Request failed (${response.status}). Check that the API is running.`, response.status, Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : null, response.headers.get('X-WorldOS-Error-Code'));
    }
    const body = await response.json().catch(() => { throw new Error('WorldOS returned unreadable data. Retry the action or use manual annotations.'); });
    if (externalSignal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('WorldOS returned an invalid response. Retry the action.');
    return body as T;
  } catch (error) {
    if (externalSignal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
    if (error instanceof TypeError) throw new Error('Cannot reach WorldOS. Check your connection and backend address, then retry.');
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The request timed out. Try a smaller scene.');
    throw error;
  } finally { window.clearTimeout(timeout); externalSignal?.removeEventListener('abort', cancel); }
}
export async function analyze(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose an image smaller than 12 MB.');
  const data = new FormData(); data.append('image', file);
  return request<Analysis>('analyze', { method: 'POST', body: data });
}
export const planScene = (body: PlanRequest) => request<Plan>('plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const verifyScene = (plan_request: PlanRequest, observed_objects: SceneObject[]) => request<Verification>('verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_request, observed_objects, tolerance: 0.025 }) });
export const health = () => request<{ status: string; ai?: AICapabilities }>('health');
export const analyzeAI = (image_url: string, concepts: string[], signal?: AbortSignal, purpose: 'planning' | 'live' = 'planning') => request<AIAnalysis>('ai/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url, concepts, purpose }), signal }, 130000);
export const askScene = (image_url:string, objects:SceneObject[], question:string, signal?:AbortSignal) => request<SceneAnswer>('ai/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({image_url,objects,question}), signal },130000);
export const reasonAI = (objects: SceneObject[], goal: string, target: Box | null, image_url?: string) => request<Reasoning>('ai/reason', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objects, goal, target, image_url }) }, 130000);
export const connectionDiagnostics = () => request<ConnectionDiagnostics>('ai/diagnostics', { cache: 'no-store' });
export const testAIConnection = (integration: AIIntegration) => request<ConnectionDiagnostics>('ai/connection-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ integration }) }, 100000);
export const automaticVerify = (body: { plan_request: PlanRequest; original_request: PlanRequest; image_url: string; before_image_url?: string; framing_confirmed: boolean; inventory_confirmed: boolean }) => request<VisualVerification>('ai/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 130000);
export const replanScene = (body: ReviewedState) => request<ReplanResult>('replan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const verifyReviewed = (body: ReviewedState) => request<Verification>('verify/reviewed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
