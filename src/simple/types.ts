import type { AIAnalysis, SceneImage } from '../types';
import type { Alignment, InspectionReview, ReferenceObject } from '../inspect/types';
export type Step='setup'|'check'|'result'|'fix'|'verify';
export interface WizardState {
  step:Step;name:string;reference:SceneImage|null;current:SceneImage|null;
  objects:ReferenceObject[];analysis:AIAnalysis|null;reference_ms:number|null;
  template_id:string|null;record_id:string|null;previous_id:string|null;
  alignment:Alignment;manual:boolean;review:InspectionReview|null;
}
export interface DraftSummary {id:string;revision:number;name:string;step:Step;updated_at:string}
export interface SavedDraft extends DraftSummary {state:WizardState}
export const emptyState=():WizardState=>({step:'setup',name:'My space',reference:null,current:null,objects:[],analysis:null,reference_ms:null,template_id:null,record_id:null,previous_id:null,alignment:{tx:0,ty:0,scale:1,rotation:0,confirmed:false},manual:false,review:null});
export const emptyReview=():InspectionReview=>({assignments:{},confirmed_missing_ids:[],manual_objects:[],ignored_detection_ids:[],inventory_confirmed:false,revision:1});
