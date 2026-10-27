"""Synthetic tests. Passing software checks are not physical inspection validation."""
import asyncio
import base64
import io
import json
import sqlite3

import cv2
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.ai_service import AIService
from backend.inspect_alignment import align_scene, decode, encode, inverse_coefficients, suggest_alignment
from backend.inspect_models import Alignment, InspectionInput, InspectionReview, TemplateInput, TemplateObject
from backend.inspect_routes import get_store, template_data
from backend.inspect_store import InspectionStore, StoreConflict
from backend.inspection import corrective_plan, inspect_facts, scan_workspace
from backend.main import app, get_ai_service
from backend.models import Box, SceneObject
from backend.planner import overlaps, restore_positions
from backend.providers import AISettings, ProviderHTTP


def photo(color="gray", size=(300, 200)):
    return encode(Image.new("RGB", size, color))["image_url"]


def reference(identity="book", x=.1, y=.15, **kwargs):
    return TemplateObject(id=identity, label=identity, box=Box(x=x, y=y, width=.1, height=.12), **kwargs)


def template_input(**kwargs):
    return TemplateInput(name="Workshop", reference_image_url=photo(), objects=[reference(), reference("cup", .75, .15, locked=True)],
                         annotations_reviewed=True, **kwargs)


def template():
    return {**template_data(template_input()), "id": "template", "revision": 1, "created_at": "2026-10-26", "updated_at": "2026-10-26"}


def detections(t=None):
    return [SceneObject.model_validate({k:v for k,v in o.items() if k not in {"required", "tolerance"}}).model_copy(update={"id": f"d-{o['id']}", "source": "sam_3_1", "confidence": .95}) for o in (t or template())["objects"]]


def facts(items=None, inventory=True, t=None, review=None):
    t=t or template()
    return inspect_facts(t, detections(t) if items is None else items, photo(), inventory=inventory, review=review)


def record(items=None, inventory=True, t=None):
    t=t or template()
    return {"id": "inspection", "revision": 1, "template_id": t["id"], "template_snapshot": t,
            "analysis": {"objects": [o.model_dump() for o in (detections(t) if items is None else items)]},
            "aligned_image": {"image_url": photo()}, "automatic_result": facts(items, inventory, t), "reviewed_result": None}


@pytest.fixture
def client(tmp_path):
    store=InspectionStore(tmp_path / "worldos.sqlite3")
    app.dependency_overrides[get_store]=lambda:store
    with TestClient(app) as client:
        yield client,store
    app.dependency_overrides.clear()


def test_template_and_photo_survive_reopening_database(tmp_path):
    path=tmp_path / "inspect.sqlite3"
    first=InspectionStore(path)
    saved=first.save_template(template_data(template_input()))
    second=InspectionStore(path)
    assert second.template(saved["id"]) == saved
    assert decode(second.template(saved["id"])["reference_image_url"]).size == (300,200)
    assert second.templates()[0]["name"] == "Workshop"
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 4


def test_migrates_v1_database_without_losing_reference(tmp_path):
    path=tmp_path / "v1.sqlite3"
    store=InspectionStore(path)
    saved=store.save_template(template_data(template_input()))
    with sqlite3.connect(path) as db:
        db.execute("DROP TABLE inspections")
        db.execute("PRAGMA user_version=1")
    upgraded=InspectionStore(path)
    assert upgraded.template(saved["id"]) == saved
    assert upgraded.history(saved["id"]) == []


def test_template_conflicts_and_deletion_cascade(client):
    client,store=client
    saved=client.post('/api/inspect/templates',json=template_input().model_dump()).json()
    payload={**template_input().model_dump(),"revision":1,"name":"Updated"}
    updated=client.put(f"/api/inspect/templates/{saved['id']}",json=payload)
    assert updated.status_code == 200 and updated.json()["revision"] == 2
    assert client.put(f"/api/inspect/templates/{saved['id']}",json=payload).status_code == 409
    trial=store.save_inspection({"template_id":saved["id"],"example":"persistent"})
    assert InspectionStore(store.path).inspection(trial["id"])["example"] == "persistent"
    assert client.get('/api/inspect/templates').headers['cache-control'] == 'no-store'
    assert client.delete(f"/api/inspect/templates/{saved['id']}").status_code == 200
    with pytest.raises(KeyError):store.inspection(trial["id"])
    assert client.get(f"/api/inspect/templates/{saved['id']}").status_code == 404


@pytest.mark.parametrize('change',[{"annotations_reviewed":False},{"name":" "},{"reference_image_url":"https://example.test/photo.jpg"}])
def test_invalid_reference_cannot_be_saved(client,change):
    client,_=client
    assert client.post('/api/inspect/templates',json={**template_input().model_dump(),**change}).status_code == 422


def test_overlapping_or_outside_reference_objects_rejected():
    with pytest.raises(ValueError):
        TemplateInput(name="Invalid",reference_image_url=photo(),objects=[reference(),reference("other")],annotations_reviewed=True)
    with pytest.raises(ValueError):
        template_input(workspace=Box(x=.3,y=.3,width=.5,height=.5))


def test_correct_workspace_requires_inventory_confirmation():
    assert facts()["passed"]
    assert not facts(inventory=False)["passed"]
    assert facts(inventory=False)["review_required"]


def test_failed_detection_is_suspected_missing_never_confirmed():
    result=facts([detections()[1]])
    assert result["objects"][0]["status"] == "suspected_missing"
    assert result["status"] == "needs_review" and not result["passed"]
    assert all(row["status"] != "confirmed_missing" for row in result["objects"])
    assert facts([])["correct_count"] == 0


def test_human_absence_confirmation_is_separate_and_blocks_restoration():
    review=InspectionReview(assignments={"book":None},confirmed_missing_ids=["book"],inventory_confirmed=True,revision=1)
    result=facts([detections()[1]],review=review)
    assert result["objects"][0]["status"] == "confirmed_missing"
    assert result["objects"][0]["source"] == "human_confirmed"
    saved=record([detections()[1]]);saved["reviewed_result"]=result
    assert corrective_plan(saved)["status"] == "blocked"


def test_optional_unseen_object_does_not_claim_missing_or_block_success():
    t=template();t["objects"][0]["required"]=False
    result=facts([detections(t)[1]],t=t)
    assert result["objects"][0]["status"] == "optional_unseen" and result["passed"]


def test_misplaced_protected_and_unexpected_statuses():
    moved=[o.model_copy(update={"box":o.box.model_copy(update={"x":o.box.x+.08})}) for o in detections()]
    result=facts(moved)
    assert [r["status"] for r in result["objects"]] == ["misplaced","protected_moved"]
    assert result["objects"][1]["severity"] == "critical"
    assert not result["passed"]
    extra=SceneObject(id="new",label="parcel",box=Box(x=.4,y=.7,width=.1,height=.1),confidence=.95,source="sam_3_1")
    result=facts([*detections(),extra])
    assert result["additional_objects"][0]["status"] == "unexpected"
    assert not result["passed"]


def test_duplicate_labels_and_low_confidence_require_review():
    t=template()
    for obj in t["objects"]:obj["label"]="cup"
    assert all(row["certainty"] == "uncertain" for row in facts(t=t)["objects"])
    low=[o.model_copy(update={"confidence":None}) for o in detections()]
    assert facts(low)["review_required"]


def test_assignments_are_one_to_one_and_absence_explicit():
    for kwargs in ({"assignments":{"book":"d-book","cup":"d-book"}}, {"assignments":{"book":None}}, {"assignments":{"unknown":"d-book"}}, {"ignored_detection_ids":["unknown"]}):
        with pytest.raises(ValueError):
            facts(review=InspectionReview(**kwargs,inventory_confirmed=True,revision=1))


def test_manual_edits_clear_provider_confidence_and_require_identity_review():
    changed=detections()[0].model_copy(update={"box":Box(x=.12,y=.15,width=.1,height=.12)})
    review=InspectionReview(manual_objects=[changed],inventory_confirmed=True,revision=1)
    assert facts(review=review)["objects"][0]["status"] == "uncertain"
    review.assignments={"book":"d-book"}
    result=facts(review=review)
    assert result["objects"][0]["provider_confidence"] is None
    assert result["evidence_mode"] == "human_assisted"


def test_ignored_detection_does_not_imply_confidence_in_absence():
    review=InspectionReview(ignored_detection_ids=["d-book"],inventory_confirmed=True,revision=1)
    row=facts(review=review)["objects"][0]
    assert row["status"] == "suspected_missing" and row["certainty"] == "missing"
    assert row["provider_confidence"] is None


def test_correct_position_tolerance_does_not_override_workspace_clearance():
    t=template();t["objects"][1]["locked"]=False;t["objects"][1]["box"]["x"]=.21
    items=detections(t);items[1]=items[1].model_copy(update={"box":items[1].box.model_copy(update={"x":.202})})
    result=facts(items,t=t)
    assert all(row["status"] == "correct" for row in result["objects"])
    assert not result["passed"] and any("clearance" in issue for issue in result["issues"])


def test_restoration_moves_to_reference_and_preserves_protection():
    items=detections();items[0]=items[0].model_copy(update={"box":Box(x=.25,y=.2,width=.1,height=.12)})
    plan=corrective_plan(record(items))
    assert plan["status"] == "ready" and len(plan["movements"]) == 1
    assert plan["movements"][0]["object_id"] == "book"
    assert plan["movements"][0]["destination"] == template()["objects"][0]["box"]
    assert "left and up" in plan["movements"][0]["instruction"] and "outlined reference position" in plan["movements"][0]["instruction"]
    assert plan["final_objects"][1]["box"] == template()["objects"][1]["box"]


def test_protected_movement_never_issues_correction_movements():
    items=detections();items[1]=items[1].model_copy(update={"box":Box(x=.65,y=.15,width=.1,height=.12)})
    plan=corrective_plan(record(items))
    assert plan["status"] == "blocked" and not plan["movements"]


def test_exact_destination_dependencies_are_ordered_and_cycles_refused():
    refs=[reference("a",.1),reference("b",.3)]
    objects=[SceneObject(id="a",label="a",box=refs[1].box),SceneObject(id="b",label="b",box=Box(x=.5,y=.15,width=.1,height=.12))]
    plan=restore_positions(objects,refs,Box(x=0,y=0,width=1,height=1))
    assert plan.status == "ready" and [m.object_id for m in plan.movements] == ["a","b"]
    objects[1]=objects[1].model_copy(update={"box":refs[0].box})
    plan=restore_positions(objects,refs,Box(x=0,y=0,width=1,height=1))
    assert plan.status == "search_limit" and not plan.movements
    assert "staging" in plan.message


def test_restoration_does_not_resize_objects_or_issue_partial_invalid_plan():
    refs=[reference()]
    actual=SceneObject(id="book",label="book",box=Box(x=.5,y=.4,width=.25,height=.12))
    plan=restore_positions([actual],refs,Box(x=0,y=0,width=1,height=1))
    assert plan.status == "impossible" and not plan.movements


def test_alignment_confirmation_and_coverage_are_required():
    t=template()
    assert not align_scene(t,photo(),Alignment())["comparison_allowed"]
    assert align_scene(t,photo(),Alignment(confirmed=True))["comparison_allowed"]
    cropped=align_scene(t,photo(),Alignment(tx=.3,confirmed=True))
    assert not cropped["comparison_allowed"] and cropped["workspace_coverage"] < .98


def test_similarity_translation_rotation_and_scale_round_trip():
    alignment=Alignment(tx=.03,ty=-.02,scale=1.1,rotation=7)
    inverse=inverse_coefficients((300,200),(600,400),alignment)
    angle=np.deg2rad(7);factor=1.1*300/600
    original=np.array([200.,150.])
    ref=np.array([[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]])@(original-np.array([300,200]))*factor+np.array([300*.53,200*.48])
    recovered=np.array(inverse).reshape(2,3)@np.array([*ref,1])
    assert np.max(np.abs(original-recovered)) < 1e-8


def test_registration_refuses_textureless_background():
    result=suggest_alignment(template(),photo())
    assert result["status"] == "needs_manual_alignment" and result["alignment"] is None


def test_registration_can_suggest_known_textured_translation_without_confirming_it():
    rng=np.random.default_rng(12)
    noise=rng.integers(0,255,(500,700,3),dtype=np.uint8)
    ref=Image.fromarray(noise)
    t=template();t.update(reference_image_url=encode(ref)["image_url"],image_width=700,image_height=500)
    shifted=ref.transform(ref.size,Image.Transform.AFFINE,(1,0,-12,0,1,8))
    result=suggest_alignment(t,encode(shifted)["image_url"])
    assert result["status"] == "suggestion"
    assert abs(result["alignment"]["tx"]+12/700)<.01
    assert abs(result["alignment"]["ty"]-8/500)<.01
    assert result["alignment"]["confirmed"] is False


def documented_service(template_value, counters, missing=False, bad_explanation=False):
    def handler(request):
        data=json.loads(request.content);counters.append(data["model"])
        if data["model"] == "sam-3.1":
            label=data["input"][0]["content"][0]["text"]
            original=next(o for o in template_value["objects"] if o["label"]==label)
            b=original["box"];w,h=300,200
            x,y,bw,bh=round(b["x"]*w),round(b["y"]*h),round(b["width"]*w),round(b["height"]*h)
            text="" if missing and label=="book" else f"<0f>0<|box;x1={x};y1={y};x2={x+bw-1};y2={y+bh-1};w={w};h={h};c=0.95|><|mask;x=0;y=0;c=0.95;data=12,15,!SYNTHETIC|>"
            return httpx.Response(200,json={"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":text}]}]})
        content={"summary":"Review the workspace findings.","findings":[{"object_id":"unknown" if bad_explanation else "book","explanation":"Use the reported status.","next_step":"Review the observation."}]}
        return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":json.dumps(content)}}]})
    return AIService(ProviderHTTP(AISettings(meta_key="synthetic-key",sam_provider="meta"),httpx.MockTransport(handler)))


def scan_payload(t,**kwargs):
    return {"template_id":t["id"],"template_revision":t["revision"],"image_url":photo(),"alignment":{"confirmed":True},"inventory_confirmed":True,"discover_unexpected":False,**kwargs}


def test_full_scan_review_plan_explain_verify_and_report_pipeline(client):
    client,store=client
    saved=client.post('/api/inspect/templates',json=template_input().model_dump()).json()
    calls=[];app.dependency_overrides[get_ai_service]=lambda:documented_service(saved,calls,missing=True)
    response=client.post('/api/inspect/scans',json=scan_payload(saved))
    assert response.status_code == 201,response.text
    trial=response.json();identity=trial["id"]
    assert not trial["automatic_result"]["passed"]
    reviewed=client.post(f'/api/inspect/scans/{identity}/review',json={"assignments":{"book":None},"confirmed_missing_ids":["book"],"inventory_confirmed":True,"revision":1})
    assert reviewed.status_code == 200,reviewed.text
    assert reviewed.json()["automatic_result"]["objects"][0]["status"] == "suspected_missing"
    assert reviewed.json()["reviewed_result"]["objects"][0]["status"] == "confirmed_missing"
    planned=client.post(f'/api/inspect/scans/{identity}/corrections',json={"revision":2}).json()
    assert planned["correction_plan"]["status"] == "blocked"
    explained=client.post(f'/api/inspect/scans/{identity}/explain',json={"revision":3})
    assert explained.status_code == 200 and explained.json()["explanation"]["source"] == "ai_generated_advisory"
    assert client.post(f'/api/inspect/scans/{identity}/review',json={"inventory_confirmed":True,"revision":1}).status_code == 409
    exported=client.get(f'/api/inspect/scans/{identity}/report')
    assert exported.status_code == 200 and 'data:image' not in exported.text and 'synthetic-key' not in exported.text
    app.dependency_overrides[get_ai_service]=lambda:documented_service(saved,calls)
    verified=client.post('/api/inspect/scans',json=scan_payload(saved,previous_inspection_id=identity,image_url=photo("#818181"))).json()
    assert verified["automatic_result"]["passed"] and verified["previous_inspection_id"] == identity
    assert InspectionStore(store.path).inspection(verified["id"])["automatic_result"]["passed"]
    assert len(client.get(f"/api/inspect/templates/{saved['id']}/history").json()["inspections"]) == 2


def test_unaligned_scan_blocks_before_any_provider_call(client):
    client,_=client;saved=client.post('/api/inspect/templates',json=template_input().model_dump()).json()
    calls=[];app.dependency_overrides[get_ai_service]=lambda:documented_service(saved,calls)
    response=client.post('/api/inspect/scans',json=scan_payload(saved,alignment={"confirmed":False}))
    assert response.status_code == 422 and calls == []


def test_reused_verification_photo_is_blocked_before_billed_requests(client):
    client,store=client;saved=client.post('/api/inspect/templates',json=template_input().model_dump()).json()
    calls=[];app.dependency_overrides[get_ai_service]=lambda:documented_service(saved,calls)
    initial=client.post('/api/inspect/scans',json=scan_payload(saved,image_url=photo('#818181'))).json()
    calls.clear()
    for image in (initial['current_image_url'],saved['reference_image_url']):
        response=client.post('/api/inspect/scans',json=scan_payload(saved,image_url=image,previous_inspection_id=initial['id']))
        assert response.status_code==422 and 'fresh photograph' in response.json()['detail']
    assert calls==[] and len(store.history(saved['id']))==1


def test_reuse_detection_covers_normalization_without_claiming_freshness():
    from backend.imaging import same_photograph, image_from_data_url
    textured=encode(Image.fromarray(np.random.default_rng(19).integers(0,255,(200,300,3),dtype=np.uint8)))['image_url']
    normalized=image_from_data_url(textured)['image_url']
    assert textured!=normalized and same_photograph(textured,normalized)
    assert not same_photograph(photo(),photo('#818181'))


def test_explanation_cannot_invent_identity_or_change_inspection_result(client):
    client,store=client;saved=client.post('/api/inspect/templates',json=template_input().model_dump()).json()
    calls=[];app.dependency_overrides[get_ai_service]=lambda:documented_service(saved,calls,bad_explanation=True)
    trial=client.post('/api/inspect/scans',json=scan_payload(saved)).json()
    response=client.post(f"/api/inspect/scans/{trial['id']}/explain",json={"revision":1})
    assert response.status_code == 502
    assert store.inspection(trial["id"])["explanation"] is None
    assert store.inspection(trial["id"])["automatic_result"]["passed"]


def test_verification_pins_old_template_after_edit(client):
    client,_=client;saved=client.post('/api/inspect/templates',json=template_input().model_dump()).json()
    app.dependency_overrides[get_ai_service]=lambda:documented_service(saved,[])
    trial=client.post('/api/inspect/scans',json=scan_payload(saved)).json()
    payload={**template_input().model_dump(),"revision":1,"name":"Changed"}
    assert client.put(f"/api/inspect/templates/{saved['id']}",json=payload).status_code == 200
    assert client.post('/api/inspect/scans',json=scan_payload(saved)).status_code == 409
    verified=client.post('/api/inspect/scans',json=scan_payload(saved,previous_inspection_id=trial["id"],image_url=photo("#818181"))).json()
    assert verified["template_snapshot"]["name"] == "Workshop" and verified["template_revision"] == 1
