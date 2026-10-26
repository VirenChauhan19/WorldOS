import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image

from .adapters import ManualSegmentation
from .ai_service import AIService
from .connection import ConnectionRegistry, ConnectionTester, ConnectionTestRequest, diagnostics
from .imaging import prepare_image
from .models import AIAnalysisRequest, PlanRequest, PlanResponse, ReasonRequest, VerifyRequest
from .planner import generate_plan, verify_positions
from .providers import AISettings, ProviderError, ProviderHTTP, capabilities, logger
from .visual_verification import ReviewedStateRequest, VisualVerifyRequest, adaptive_replan, automatic_verify, verify_reviewed

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
app = FastAPI(title="WorldOS", version="0.3.0", description="Reviewed AI or manual annotations, visual verification, and adaptive spatial planning.")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("WORLDOS_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","), allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
MAX_BYTES = int(os.getenv("WORLDOS_MAX_UPLOAD_MB", "12")) * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 24_000_000
connection_registry = ConnectionRegistry()


def get_connection_registry():
    return connection_registry


@app.get("/api/health")
def health(registry: ConnectionRegistry = Depends(get_connection_registry)):
    try:
        settings = AISettings.from_env()
        ai = capabilities(settings)
        for name, entry in diagnostics(settings, registry)["integrations"].items():
            if entry["last_test"]["live_request_succeeded"]:
                ai[name].update(status="live_verified", message="An explicit provider inference test succeeded in this server process.")
        ai["live_tested"] = any(registry.state(settings, name)["ever_live_request_succeeded"] for name in ("muse", "sam"))
    except (ValueError, ProviderError):
        ai = {"configuration_error": "Check backend AI environment settings."}
    return {"status": "ok", "vision": "manual", "reasoning": "deterministic_rules", "ai": ai}


def get_ai_service():
    try:
        return AIService(ProviderHTTP(AISettings.from_env()))
    except (ValueError, ProviderError):
        raise HTTPException(503, "Invalid backend AI configuration. Check environment settings.") from None


@app.get("/api/ai/diagnostics")
def ai_diagnostics(response: Response, registry: ConnectionRegistry = Depends(get_connection_registry)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return diagnostics(AISettings.from_env(), registry)
    except (ValueError, ProviderError):
        selected = os.getenv("WORLDOS_SAM_PROVIDER", "baseten")
        return {"configuration_error": "Invalid backend AI settings. Check WORLDOS_SAM_PROVIDER, WORLDOS_MUSE_MODEL, and WORLDOS_AI_TIMEOUT_SECONDS.", "selected_sam_provider": selected if selected in {"meta", "baseten"} else None,
                "credentials": {"meta_api_key_configured": bool(os.getenv("MODEL_API_KEY", "").strip()), "baseten_api_key_configured": bool(os.getenv("BASETEN_API_KEY", "").strip()), "baseten_sam_model_id_configured": bool(os.getenv("BASETEN_SAM_MODEL_ID", "").strip())}, "integrations": {}}


@app.post("/api/ai/connection-test")
async def ai_connection_test(request: ConnectionTestRequest, response: Response, service: AIService = Depends(get_ai_service), registry: ConnectionRegistry = Depends(get_connection_registry)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await ConnectionTester(service.http, registry).test(request.integration)
    except ProviderError as error:
        raise HTTPException(error.status, str(error)) from None


async def run_ai(operation):
    try:
        async with asyncio.timeout(120):
            result = await operation
            logger.info('{"event":"ai_result","outcome":"validated"}')
            return result
    except ProviderError as error:
        logger.info('{"event":"ai_result","outcome":"rejected","status":%s}', error.status)
        raise HTTPException(error.status, str(error)) from None
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    except TimeoutError:
        raise HTTPException(504, "AI analysis reached its total two-minute time limit. No result was applied; use fewer concepts or manual mode.") from None


@app.post("/api/ai/analyze")
async def ai_analyze(request: AIAnalysisRequest, service: AIService = Depends(get_ai_service)):
    return await run_ai(service.analyze(request))


@app.post("/api/ai/reason")
async def ai_reason(request: ReasonRequest, service: AIService = Depends(get_ai_service)):
    return await run_ai(service.reason(request))


@app.post("/api/ai/verify")
async def ai_verify(request: VisualVerifyRequest, service: AIService = Depends(get_ai_service)):
    return await run_ai(automatic_verify(request, service, plan_with_constraints))


@app.post("/api/verify/reviewed")
def reviewed_verify(request: ReviewedStateRequest):
    try:
        return verify_reviewed(request, plan_with_constraints)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None


@app.post("/api/replan")
def replan(request: ReviewedStateRequest):
    try:
        return adaptive_replan(request, plan_with_constraints)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None


@app.post("/api/analyze")
async def analyze(image: UploadFile):
    try:
        data = await image.read(MAX_BYTES + 1)
    finally:
        await image.close()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"Image exceeds {MAX_BYTES // 1024 // 1024} MB.")
    try:
        prepared = prepare_image(data)
    except ValueError as error:
        raise HTTPException(415, str(error)) from None
    return {**prepared,
            "objects": ManualSegmentation().segment(data), "annotation_source": "manual",
            "message": "Image validated and orientation corrected. Annotate manually or explicitly run AI Analysis; uploading alone never sends an image to a model provider."}


def resolve_constraints(request: PlanRequest) -> PlanRequest:
    if not request.constraints:
        return request
    protected = set(request.constraints.protected_object_ids)
    return request.model_copy(update={"objects": [obj.model_copy(update={"locked": obj.locked or obj.id in protected}) for obj in request.objects]})


def plan_with_constraints(request: PlanRequest) -> PlanResponse:
    result = generate_plan(resolve_constraints(request))
    if any(obj.source != "manual" for obj in request.objects):
        result.warnings[0] = "Scene includes AI annotations. User review is required; annotations may omit or misidentify objects."
    if request.constraints:
        result.reasoning_source = "user_reviewed_constraints"
        result.warnings[2] = "Reviewed protected-object constraints were applied. The deterministic planner calculates all movements and collisions."
    return result


@app.post("/api/plan", response_model=PlanResponse)
def plan(request: PlanRequest):
    try:
        return plan_with_constraints(request)
    except ValueError as error:
        raise HTTPException(422, str(error))


@app.post("/api/verify")
def verify(request: VerifyRequest):
    try:
        planned = plan_with_constraints(request.plan_request)
        if planned.status not in {"ready", "already_clear"}:
            raise ValueError("Generate a feasible plan before verifying final positions.")
        return verify_positions(request, planned)
    except ValueError as error:
        raise HTTPException(422, str(error))


# Build with `npm run build` before starting the server for a single-origin app.
dist = Path(__file__).resolve().parents[1] / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
