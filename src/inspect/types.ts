import type { AIAnalysis, Box, InferenceMetadata, Plan, SceneObject } from '../types';

export interface ReferenceObject extends SceneObject { required: boolean; tolerance: number }
export interface WorkspaceTemplate {
  id: string; revision: number; name: string; description: string; location: string;
  reference_image_url: string; image_width: number; image_height: number;
  workspace: Box; clearance: number; objects: ReferenceObject[]; created_at: string; updated_at: string;
  reference_analysis?:AIAnalysis|null;reference_inference_wall_ms?:number|null;
}
export type TemplateSummary = Pick<WorkspaceTemplate, 'id' | 'revision' | 'name' | 'created_at' | 'updated_at'>;
export interface Alignment { tx: number; ty: number; scale: number; rotation: number; confirmed: boolean }
export const DEFAULT_ALIGNMENT: Alignment = {tx:0,ty:0,scale:1,rotation:0,confirmed:false};
export interface AlignedImage { image_url: string; width: number; height: number; comparison_allowed: boolean; workspace_coverage: number; warnings: string[]; alignment: Alignment }
export interface InspectionObject {
  object_id: string; detection_id?: string | null; label: string; status: string; severity: 'critical' | 'high' | 'medium' | 'info';
  source: 'ai_generated' | 'human_confirmed'; certainty: string; provider_confidence: number | null;
  observed_box: Box | null; expected_box: Box | null; reasons?: string[]; required?: boolean; protected?: boolean;
}
export interface InspectionFacts {
  passed: boolean; status: string; review_required: boolean; objects: InspectionObject[]; additional_objects: InspectionObject[];
  observed_objects: SceneObject[]; issues: string[]; inventory_confirmed: boolean; evidence_mode: string;
  correct_count: number; reference_count: number; issue_count: number; message: string;
}
export interface InspectionReview { assignments: Record<string,string|null>; confirmed_missing_ids: string[]; manual_objects: SceneObject[]; ignored_detection_ids: string[]; inventory_confirmed: boolean; revision: number }
export interface InspectionRecord {
  id: string; revision: number; created_at: string; template_id: string; template_revision: number; template_snapshot: WorkspaceTemplate;
  current_image_url: string; aligned_image: AlignedImage; analysis: AIAnalysis; automatic_result: InspectionFacts;
  reviewed_result: InspectionFacts | null; review: InspectionReview | null; latency_ms: number; previous_inspection_id: string | null;
  correction_plan: (Omit<Plan,'status'> & {status:Plan['status']|'blocked';reasons:string[]}) | null;
  explanation: ({summary:string;findings:{object_id:string;explanation:string;next_step:string}[];model:string;provider?:string;source:string} & InferenceMetadata) | null;
  warnings: string[];
}

export interface EvaluationSummary {id:string;template_id:string;name:string;scenario:string;operator:string;created_at:string}
export interface CaptureTruth {objects:SceneObject[];issues:{object_id:string;kind:string}[];workspace_correct:boolean;inventory_complete:boolean;independently_reviewed:boolean;reviewed_by:string}
export interface EvaluationCapture {
  id:string;stage:'inspection'|'corrected';image_url:string;alignment:Alignment;aligned_image:AlignedImage;image_hash:string;
  captured_at:string;notes:string;truth:CaptureTruth;record:InspectionRecord|null;image_width:number;image_height:number;
  attempts:{id:string;status:string;started_at:string;pipeline_ms?:number;error?:{status:number;message:string}|string|null}[];
}
export interface EvaluationTrial extends EvaluationSummary {template_snapshot:WorkspaceTemplate;captures:EvaluationCapture[]}
export interface Metric {numerator:number;denominator:number;value:number|null}
export interface EvaluationReport {
  measurement_status:string;trial_count:number;attempted_trials:number;trials_with_corrected_attempt:number;pending_scenarios:string[];
  failed_or_interrupted_attempts:number;human_review_actions:number;mean_inference_wall_ms:number|null;
  metrics:Record<'inspection'|'corrected',Record<'automatic'|'human_assisted',Record<string,Metric|number>>>;
  task_success:Record<'automatic'|'human_assisted',{over_started_trials:Metric;over_trials_with_corrected_attempt:Metric}>;
}
