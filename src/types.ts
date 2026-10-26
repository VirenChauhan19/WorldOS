export interface Box { x: number; y: number; width: number; height: number }
export interface SceneObject { id: string; label: string; box: Box; locked: boolean; source?: 'manual' | 'sam_3_1' | 'ai_corrected'; confidence?: number | null }
export interface PlanningConstraints { protected_object_ids: string[]; summary: string; unsupported_requirements: string[]; needs_clarification: boolean }
export interface PlanRequest { objects: SceneObject[]; target: Box; workspace: Box; goal: string; clearance: number; constraints?: PlanningConstraints }
export interface Movement { number: number; object_id: string; label: string; source: Box; destination: Box; instruction: string }
export interface Plan { status: 'ready' | 'already_clear' | 'impossible' | 'search_limit'; message: string; movements: Movement[]; final_objects: SceneObject[]; locked_ids: string[]; warnings: string[]; explored_states: number }
export interface SceneImage { image_url: string; width: number; height: number; name: string }
export interface Analysis extends SceneImage { annotation_source: string; message: string }
export interface AIAnalysis { objects: SceneObject[]; concepts: string[]; summary: string; message: string; warnings: string[]; provider: string; model: string }
export interface Reasoning { constraints: PlanningConstraints; provider: string; model: string; confidence: null; message: string }
export interface AICapabilities { live_tested: boolean; sam: { provider: string; status: string; message: string; model: string | null }; muse: { provider: string; model: string; status: string; message: string } }
export type AIIntegration = 'muse' | 'sam';
export interface ConnectionTestState { status: string; message: string; last_attempt_at: string | null; last_success_at: string | null; live_request_succeeded: boolean; ever_live_request_succeeded: boolean; test_in_progress: boolean; provider_http_status: number | null }
export interface ConnectionEntry { provider: string; model: string | null; configuration: { status: string; credentials_configured: boolean; message: string }; last_test: ConnectionTestState; test_scope: string }
export interface ConnectionDiagnostics { selected_sam_provider: string | null; scope?: string; configuration_error?: string; credentials?: { meta_api_key_configured: boolean; baseten_api_key_configured: boolean; baseten_sam_model_id_configured: boolean }; integrations: Partial<Record<AIIntegration, ConnectionEntry>> }
export interface Verification { passed: boolean; message: string; matched_count: number; issues: string[]; objects: { object_id: string; label: string; matched: boolean; edge_error: number; tolerance: number }[] }
export interface VisualMatch { object_id: string; label: string; detection_id: string | null; candidate_ids: string[]; certainty: 'supported' | 'uncertain' | 'missing' | 'reviewed'; provider_confidence: number | null; appearance_similarity: number | null; reasons: string[]; status: 'completed' | 'incomplete' | 'uncertain' | 'missing'; matched: boolean; edge_error: number | null; tolerance: number; protected: boolean }
export interface VisualVerification { passed: boolean; status: 'passed' | 'failed' | 'needs_review'; review_required: boolean; message: string; matched_count: number; objects: VisualMatch[]; steps: {number: number; object_id: string; status: string}[]; issues: string[]; unexpected_movements: string[]; uncertain_ids: string[]; detections: SceneObject[]; observed_objects: SceneObject[]; latency_ms: number; confidence: string }
export interface ReviewedState { original_request: PlanRequest; plan_request: PlanRequest; observed_objects: SceneObject[]; reviewed_ids: string[]; framing_confirmed: boolean; inventory_confirmed: boolean }
export interface ReplanResult { status: Plan['status'] | 'blocked'; reasons: string[]; original_plan: Plan; revised_plan: Plan | null; plan_request: PlanRequest | null }
export type Tool = 'select' | 'object' | 'target' | 'workspace';
export const FULL: Box = { x: 0, y: 0, width: 1, height: 1 };
