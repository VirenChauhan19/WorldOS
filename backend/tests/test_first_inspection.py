"""Synthetic evidence to test reporting; these are not physical trial results."""
from copy import deepcopy
from backend.first_inspection import first_inspection_summary


def trial():
    return {'template_snapshot': {'objects': [{'id':'phone','label':'smartphone','source':'sam_3_1'},{'id':'mug','label':'mug','source':'sam_3_1'}]},'captures':[]}


def test_empty_trial_never_invents_physical_outcomes():
    summary=first_inspection_summary(trial())
    for key in ('phone_detected_automatically','correct_phone_discrepancy_identified_automatically','verification_succeeded','movement_instruction_correct_operator_report','recorded_processing_ms'):
        assert summary[key] is None
    assert not summary['complete_capture_sequence']


def test_reports_automatic_and_assisted_outcomes_with_failed_attempt_time():
    value=trial();value['template_snapshot'].update(reference_analysis={'objects':[{'label':'smartphone'}]},reference_inference_wall_ms=250)
    facts={'objects':[{'object_id':'phone','status':'misplaced'},{'object_id':'mug','status':'correct'}], 'additional_objects':[],'issues':[],'passed':False,'evidence_mode':'automatic'}
    value['captures']=[{'stage':'inspection','truth':{'issues':[{'object_id':'phone','kind':'misplaced'}]},'record':{'automatic_result':facts},'attempts':[{'status':'failed','pipeline_ms':1000},{'status':'completed','pipeline_ms':2000}]},
        {'stage':'corrected','truth':{'workspace_correct':True},'movement_instruction_correct':False,'record':{'automatic_result':{**facts,'passed':False},'reviewed_result':{**facts,'passed':True,'evidence_mode':'human_assisted'},'review':{'assignments':{'phone':'d-phone'},'manual_objects':[{'id':'d-phone'}]}},'attempts':[{'status':'completed','pipeline_ms':500}]}]
    summary=first_inspection_summary(value)
    assert summary['phone_detected_automatically'] and summary['correct_phone_discrepancy_identified_automatically']
    assert summary['manual_annotation_used'] and summary['human_identity_review_used']
    assert summary['verification_succeeded'] and summary['verification_evidence_mode']=='human_assisted'
    assert summary['movement_instruction_correct_operator_report'] is False
    assert summary['recorded_processing_ms']==3750 and summary['failed_scan_attempts']==1
    # Backend positivity cannot overrule the independently recorded physical state.
    wrong=deepcopy(value);wrong['captures'][1]['truth']['workspace_correct']=False
    assert first_inspection_summary(wrong)['verification_succeeded'] is False
    wrong=deepcopy(value);wrong['captures'][0]['truth']['issues']=[]
    assert first_inspection_summary(wrong)['correct_phone_discrepancy_identified_automatically'] is None
