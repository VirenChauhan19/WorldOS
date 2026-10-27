import hashlib
import sqlite3
from contextlib import contextmanager
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from .imaging import image_from_data_url, same_photograph
from .inspect_alignment import align_scene, suggest_alignment
from .inspect_models import AlignmentRequest, InspectionInput, InspectionReview, RecordAction, TemplateInput
from .inspect_store import StoreConflict, get_inspection_store
from .inspection import corrective_plan, explain_inspection, review_inspection, scan_workspace
from .inspection_trials import (CaptureInput, TrialInput, SCENARIOS, begin_attempt, create_trial, evaluation_report,
    export_trial, finish_attempt, get_trial, list_trials, save_capture)


@contextmanager
def errors():
    try:
        yield
    except StoreConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except KeyError:
        raise HTTPException(404, "Workspace template or inspection was not found.") from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except sqlite3.Error:
        raise HTTPException(503, "Inspect storage is temporarily unavailable. Check the backend data directory and retry.") from None


def get_store(request: Request):
    with errors():
        # The authenticated server-side role is the only workspace selector.
        return get_inspection_store(demo=getattr(request.state, 'access_role', 'owner') == 'judge')


def template_data(body):
    image = image_from_data_url(body.reference_image_url)
    return {**body.model_dump(exclude={"revision", "annotations_reviewed"}), "name": body.name.strip(),
            "reference_image_url": image["image_url"], "image_width": image["width"], "image_height": image["height"]}


def check_revision(record, revision):
    if record["revision"] != revision:
        raise StoreConflict("This inspection changed. Reload its latest state first.")


def build_inspect_router(get_ai_service, run_ai):
    router = APIRouter(prefix="/api/inspect", tags=["WorldOS Inspect"])

    @router.get("/templates")
    def templates(store=Depends(get_store)):
        return {"templates": store.templates()}

    @router.post("/templates", status_code=201)
    def create(body: TemplateInput, store=Depends(get_store)):
        with errors():
            return store.save_template(template_data(body))

    @router.get("/templates/{identity}")
    def get_template(identity: str, store=Depends(get_store)):
        with errors():
            return store.template(identity)

    @router.put("/templates/{identity}")
    def update(identity: str, body: TemplateInput, store=Depends(get_store)):
        with errors():
            if body.revision is None:
                raise StoreConflict("Reload the template revision before editing.")
            return store.save_template(template_data(body), identity, body.revision)

    @router.delete("/templates/{identity}")
    def delete(identity: str, store=Depends(get_store)):
        with errors():
            store.delete_template(identity)
            return {"deleted": True}

    @router.get("/templates/{identity}/history")
    def history(identity: str, store=Depends(get_store)):
        with errors():
            store.template(identity)
            return {"inspections": store.history(identity)}

    @router.post("/alignment")
    def alignment(body: AlignmentRequest, store=Depends(get_store)):
        with errors():
            template = store.template(body.template_id)
            if body.evaluation_trial_id:
                template = get_trial(store, body.evaluation_trial_id)["template_snapshot"]
                if template["id"] != body.template_id:
                    raise ValueError("Evaluation alignment must use its pinned workspace.")
            if body.previous_inspection_id:
                previous = store.inspection(body.previous_inspection_id)
                if previous["template_id"] != body.template_id:
                    raise ValueError("Alignment must use the same workspace as the previous inspection.")
                template = previous["template_snapshot"]
            if body.automatic:
                return suggest_alignment(template, body.image_url)
            return align_scene(template, body.image_url, body.alignment)

    @router.post("/scans", status_code=201)
    async def scan(body: InspectionInput, store=Depends(get_store), service=Depends(get_ai_service)):
        with errors():
            if body.evaluation_capture_id:
                capture, template, token = begin_attempt(store, body.evaluation_capture_id, body)
                if token is None:
                    return capture["record"]
                trial = get_trial(store, capture["trial_id"])
                initial = next((c for c in trial["captures"] if c["stage"] == "inspection"), None)
                previous_id = initial["record"]["id"] if capture["stage"] == "corrected" and initial and initial["record"] else None
                request = body.model_copy(update={"previous_inspection_id": previous_id, "inventory_confirmed": False})
                started = perf_counter()
                try:
                    result = await run_ai(scan_workspace(template, request, service))
                except HTTPException as exc:
                    finish_attempt(store, capture["id"], token, round((perf_counter()-started)*1000),
                        error={"status": exc.status_code, "message": str(exc.detail)})
                    raise
                except Exception:
                    finish_attempt(store, capture["id"], token, round((perf_counter()-started)*1000),
                        error={"status": 500, "message": "Inspection could not finish. The saved photo and labels are preserved; reload the trial and retry explicitly."})
                    raise HTTPException(500, "Inspection could not finish. Reload the saved trial and retry explicitly.") from None
                return finish_attempt(store, capture["id"], token, round((perf_counter()-started)*1000), record=result)
            template = store.template(body.template_id)
            if body.previous_inspection_id:
                previous = store.inspection(body.previous_inspection_id)
                if previous["template_id"] != body.template_id:
                    raise ValueError("Verification must use the same workspace template as the preceding inspection.")
                template = previous["template_snapshot"]
                if any(same_photograph(body.image_url, earlier) for earlier in
                       (previous["current_image_url"], template["reference_image_url"])):
                    raise ValueError("Verification needs a fresh photograph after correction. The reference or previous inspection photo was reused; no inference was started.")
            if template["revision"] != body.template_revision:
                raise StoreConflict("The template changed. Reload it, or verify against the previous inspection's pinned template revision.")
            result = await run_ai(scan_workspace(template, body, service))
            return store.save_inspection(result)

    @router.get("/scans/{identity}")
    def get_scan(identity: str, store=Depends(get_store)):
        with errors():
            return store.inspection(identity)

    @router.post("/scans/{identity}/review")
    def review(identity: str, body: InspectionReview, store=Depends(get_store)):
        with errors():
            record = store.inspection(identity)
            check_revision(record, body.revision)
            result = review_inspection(record, body)
            return store.update_inspection(identity, {"reviewed_result": result, "review": body.model_dump(), "correction_plan": None, "explanation": None}, body.revision)

    @router.post("/scans/{identity}/corrections")
    def corrections(identity: str, body: RecordAction, store=Depends(get_store)):
        with errors():
            record = store.inspection(identity)
            check_revision(record, body.revision)
            plan = corrective_plan(record)
            return store.update_inspection(identity, {"correction_plan": plan}, body.revision)

    @router.post("/scans/{identity}/explain")
    async def explain(identity: str, body: RecordAction, store=Depends(get_store), service=Depends(get_ai_service)):
        with errors():
            record = store.inspection(identity)
            check_revision(record, body.revision)
            result = await run_ai(explain_inspection(record, service))
            return store.update_inspection(identity, {"explanation": result}, body.revision)

    @router.get("/scans/{identity}/report")
    def report(identity: str, store=Depends(get_store)):
        with errors():
            record = store.inspection(identity)
            # Retain reproducibility/provenance without putting photos in a JSON
            # download by default. Images persist in the private local database.
            image_hashes = {"reference": hashlib.sha256(record["template_snapshot"]["reference_image_url"].encode()).hexdigest(),
                            "current": hashlib.sha256(record["current_image_url"].encode()).hexdigest(),
                            "aligned": hashlib.sha256(record["aligned_image"]["image_url"].encode()).hexdigest()}
            del record["template_snapshot"]["reference_image_url"]
            del record["current_image_url"]
            del record["aligned_image"]["image_url"]
            return JSONResponse({"app": "WorldOS Inspect", "version": "1.1.0", "image_hashes_sha256_of_data_urls": image_hashes, **record},
                                headers={"Content-Disposition": f'attachment; filename="worldos-inspect-{identity}.json"'})

    @router.get("/evaluation/trials")
    def trials(template_id: str | None = None, store=Depends(get_store)):
        with errors():
            return {"trials": list_trials(store, template_id), "scenarios": SCENARIOS}

    @router.post("/evaluation/trials", status_code=201)
    def new_trial(body: TrialInput, store=Depends(get_store)):
        with errors():
            return create_trial(store, body)

    @router.get("/evaluation/trials/{identity}")
    def trial(identity: str, store=Depends(get_store)):
        with errors():
            return get_trial(store, identity)

    @router.post("/evaluation/trials/{identity}/captures", status_code=201)
    def capture(identity: str, body: CaptureInput, store=Depends(get_store)):
        with errors():
            return save_capture(store, identity, body)

    @router.get("/evaluation/trials/{identity}/export")
    def trial_export(identity: str, store=Depends(get_store)):
        with errors():
            return JSONResponse(export_trial(get_trial(store, identity)), headers={"Content-Disposition": f'attachment; filename="worldos-trial-{identity}.json"'})

    @router.get("/evaluation/report")
    def benchmark(store=Depends(get_store)):
        with errors():
            return evaluation_report(store)

    return router
