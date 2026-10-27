import type { AICapabilities, AIAnalysis, AIIntegration, Analysis, Box, ConnectionDiagnostics, Plan, PlanRequest, Reasoning, SceneObject, Verification, VisualVerification, ReviewedState, ReplanResult } from './types';
import { apiFetch, requestScope } from './backend';

const pending = new Map<string, Promise<unknown>>();
function request<T>(path: string, options?: RequestInit, timeoutMs = 60000): Promise<T> {
  // Share identical in-flight AI actions only. Never persist image bodies/results in browser storage.
  if (!['ai/analyze', 'ai/reason', 'ai/verify'].includes(path)) return sendRequest<T>(path, options, timeoutMs);
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
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await apiFetch(path, { ...options, signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = body?.detail;
      throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: {msg: string}) => d.msg).join('; ') : `Request failed (${response.status}). Check that the API is running.`);
    }
    const body = await response.json().catch(() => { throw new Error('WorldOS returned unreadable data. Retry the action or use manual annotations.'); });
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('WorldOS returned an invalid response. Retry the action.');
    return body as T;
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Cannot reach WorldOS. Check your connection and backend address, then retry.');
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The request timed out. Try a smaller scene.');
    throw error;
  } finally { window.clearTimeout(timeout); }
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
export const analyzeAI = (image_url: string, concepts: string[]) => request<AIAnalysis>('ai/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_url, concepts }) }, 130000);
export const reasonAI = (objects: SceneObject[], goal: string, target: Box | null, image_url?: string) => request<Reasoning>('ai/reason', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ objects, goal, target, image_url }) }, 130000);
export const connectionDiagnostics = () => request<ConnectionDiagnostics>('ai/diagnostics', { cache: 'no-store' });
export const testAIConnection = (integration: AIIntegration) => request<ConnectionDiagnostics>('ai/connection-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ integration }) }, 100000);
export const automaticVerify = (body: { plan_request: PlanRequest; original_request: PlanRequest; image_url: string; before_image_url?: string; framing_confirmed: boolean; inventory_confirmed: boolean }) => request<VisualVerification>('ai/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 130000);
export const replanScene = (body: ReviewedState) => request<ReplanResult>('replan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const verifyReviewed = (body: ReviewedState) => request<Verification>('verify/reviewed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
