"""Offline regressions for the opt-in live runner; these inputs are synthetic."""
import hashlib
import io
import json

from PIL import Image
import pytest

from backend.main import plan_with_constraints
from backend.models import Box, PlanRequest
from scripts.verify_photo_pipeline import reviewed_input, validate_movements, without_photos


def request():
    return PlanRequest.model_validate({"goal":"Clear the target; keep the cup fixed.","target":{"x":.3,"y":.3,"width":.3,"height":.3},
        "objects":[{"id":"book","label":"book","box":{"x":.35,"y":.35,"width":.1,"height":.1}},
                   {"id":"cup","label":"cup","box":{"x":.8,"y":.8,"width":.1,"height":.1},"locked":True}]})


def files(tmp_path):
    data=io.BytesIO();Image.new('RGB',(80,60),'gray').save(data,'PNG')
    photo=tmp_path/'synthetic.png';photo.write_bytes(data.getvalue())
    detections=tmp_path/'detections.json'
    detections.write_text(json.dumps({'cases':[{'status':'success','image_sha256':hashlib.sha256(data.getvalue()).hexdigest(),'objects':[o.model_dump() for o in request().objects]}]}))
    review=tmp_path/'review.json'
    review.write_text(json.dumps({'actor':'agent_visual_review','notes':'Synthetic unit fixture only; not a photograph or real inference result.',
        'included_detection_ids':['book','cup'],'protected_ids':['cup'],'workspace':{'x':0,'y':0,'width':1,'height':1},'target':request().target.model_dump(),'goal':request().goal,'clearance':.008}))
    return photo,detections,review


def test_live_runner_requires_reviewed_ids_bound_to_exact_image(tmp_path):
    photo,detections,review=files(tmp_path)
    _,_,provenance,scene,excluded=reviewed_input(photo,detections,review)
    assert provenance['actor']=='agent_visual_review' and not excluded
    assert scene.objects[1].locked
    photo.write_bytes(photo.read_bytes()+b'changed')
    with pytest.raises(ValueError,match='exact photograph'):
        reviewed_input(photo,detections,review)


@pytest.mark.parametrize('ids',[['book','unknown'],['book','book'],['book']])
def test_live_runner_rejects_invented_duplicate_or_silently_excluded_obstacles(tmp_path,ids):
    photo,detections,review=files(tmp_path)
    data=json.loads(review.read_text());data['included_detection_ids']=ids;data['protected_ids']=[]
    review.write_text(json.dumps(data))
    with pytest.raises(ValueError):reviewed_input(photo,detections,review)


def test_planner_validation_never_claims_physical_completion():
    req=request();plan=plan_with_constraints(req)
    result=validate_movements(req,plan)
    assert result['passed'] and result['physical_verification']=='not_performed'
    assert not result['unchanged_annotations_negative_control']['passed']
    assert result['movement_count']==1


@pytest.mark.parametrize('change',['collision','protected','wrong_source','changed_size','empty_instruction'])
def test_live_runner_rejects_unsafe_or_incoherent_movement_instructions(change):
    req=request();plan=plan_with_constraints(req);move=plan.movements[0]
    if change=='collision':move.destination=req.objects[1].box
    elif change=='protected':move.object_id='cup'
    elif change=='wrong_source':move.source=Box(x=.6,y=.6,width=.1,height=.1)
    elif change=='changed_size':move.destination=move.destination.model_copy(update={'width':.2})
    else:move.instruction=''
    with pytest.raises(ValueError):validate_movements(req,plan)


def test_report_omits_embedded_photos_but_keeps_detection_evidence():
    value={'image_url':'private-photo','template':{'reference_image_url':'private-reference'},'checks':[{'current_image_url':'private-current','objects':[{'box':{'x':.2}}]}]}
    exported=without_photos(value)
    assert 'private' not in json.dumps(exported)
    assert exported['checks'][0]['objects'][0]['box']['x']==.2
