import type { AIAnalysis, InferenceMetadata, SceneImage } from '../types';

export const GOALS = [
  {id:'focus',title:'Get ready to focus',goal:'Help me prepare this desk for a focused study or work session using what I already have.',detail:'A place to work. Fewer things competing for attention.'},
  {id:'create',title:'Make room to create',goal:'Help me clear a useful area for writing, drawing or making something, using what is already here.',detail:'Find a starting point for your next idea.'},
  {id:'reset',title:'Reset this space',goal:'Help me put this workspace into a practical, organized state that will be easy to use again.',detail:'Finish today with a space ready for tomorrow.'},
] as const;
export type TaskImage = Pick<SceneImage,'image_url'|'width'|'height'>;
export interface MissionStep {id:string;title:string;instruction:string;why:string;success_check:string;object_ids:string[];move_ids:string[]}
export interface MissionPlan extends InferenceMetadata {title:string;outcome:string;steps:MissionStep[];limitation:string;model:string;provider:string}
export interface MissionReview extends InferenceMetadata {comparable:boolean;summary:string;steps:{step_id:string;status:'looks_done'|'needs_attention'|'uncertain';evidence:string}[];next_step:string;model:string;source:'photo_assessment'}
export interface RoutineSummary {id:string;name:string;goal:string;created_at:string}
export interface Routine extends RoutineSummary {constraints:string;image:TaskImage;source:'user_selected_reference';keep_preferences?:string[]}
export interface MissionSummary {id:string;revision:number;goal:string;status:'draft'|'observed'|'guiding'|'reviewed';updated_at:string}
export interface Mission extends MissionSummary {constraints:string;initial_image:TaskImage;working_image:TaskImage;reference:Routine|null;analysis:AIAnalysis|null;protected_ids:string[];plan:MissionPlan|null;completed_ids:string[];history:string[];after:TaskImage|null;review:MissionReview|null;created_at:string;saved_routine_id?:string|null;feedback?:string}
export interface MissionIndex {missions:MissionSummary[];routines:RoutineSummary[]}
