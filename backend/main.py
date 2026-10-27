import asyncio
import os
from contextlib import asynccontextmanager, suppress
from functools import lru_cache
from pathlib import Path
from dotenv import load_dotenv

from fastapi import Depends, FastAPI, HTTPException, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .adapters import ManualSegmentation
from .ai_service import AIService
from .connection import ConnectionRegistry, ConnectionTester, ConnectionTestRequest, diagnostics
from .environment import BackendEnvironment
from .security import SecuritySettings, SessionAuth
from .production import data_directory, storage_ready
from .request_limits import RequestLimitsMiddleware
from .backups import backup_loop, scheduled_backup
from .imaging import prepare_image
from .inspect_routes import build_inspect_router
from .consumer_routes import build_consumer_router
from .models import AIAnalysisRequest, PlanRequest, PlanResponse, ReasonRequest, VerifyRequest
from .planner import generate_plan, verify_positions
from .providers import AISettings, ProviderError, ProviderHTTP, capabilities, logger
from .visual_verification import ReviewedStateRequest, VisualVerifyRequest, adaptive_replan, automatic_verify, verify_reviewed

backend_environment = BackendEnvironment()
load_dotenv(Path(__file__).resolve().parents[1] / ".env.auth", override=False)
load_dotenv(Path(__file__).resolve().parents[1] / ".env.judge", override=False)
security_settings = SecuritySettings.from_env()
session_auth = SessionAuth(security_settings, session_path=data_directory()/'auth.sqlite3' if security_settings.encoded_password else None)


@asynccontextmanager
async def lifespan(_app):
    worker = None
    if security_settings.deployment == 'public':
        storage_ready()
        if os.getenv('WORLDOS_BACKUPS_ENABLED','1') == '1':
            worker = asyncio.create_task(backup_loop(data_directory()))
    yield
    if worker:
        worker.cancel()
        with suppress(asyncio.CancelledError): await worker


app = FastAPI(title="WorldOS", version="1.2.0", lifespan=lifespan, description="Visual workspace inspection, persistent reference templates, and adaptive spatial planning.")
app.add_middleware(RequestLimitsMiddleware, production=security_settings.deployment=='public',
                   max_bytes=int(os.getenv('WORLDOS_MAX_REQUEST_MB','32'))*1024*1024,
                   max_concurrent_writes=int(os.getenv('WORLDOS_MAX_CONCURRENT_WRITES','2')))
app.middleware("http")(session_auth.middleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(security_settings.hosts))
app.add_middleware(CORSMiddleware, allow_origins=list(security_settings.origins), allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"])
app.include_router(session_auth.router())


@app.exception_handler(RequestValidationError)
async def safe_auth_validation(request, error):
    if request.url.path.startswith("/api/auth/"):
        return JSONResponse({"detail": "Invalid sign-in request."}, 422, headers={"Cache-Control": "no-store"})
    return await request_validation_exception_handler(request, error)
MAX_BYTES = int(os.getenv("WORLDOS_MAX_UPLOAD_MB", "12")) * 1024 * 1024
connection_registry = ConnectionRegistry()


def get_connection_registry():
    return connection_registry


@app.get('/healthz', include_in_schema=False)
def production_health():
    try:
        storage_ready()
        session_auth.store.check()
    except Exception:
        return JSONResponse({'status':'unavailable'},503,headers={'Cache-Control':'no-store'})
    return {'status':'ok'}


@app.post('/api/admin/backups')
def create_workspace_backup():
    try:
        storage_ready()
        return scheduled_backup(data_directory())
    except Exception:
        raise HTTPException(503,'Backup failed. Check storage capacity and permissions; existing workspace data is unchanged.') from None


@app.get('/api/admin/backups/latest')
def download_workspace_backup():
    import json
    import re
    folder = (data_directory()/'backups').resolve()
    try:
        data = json.loads((folder/'latest.json').read_text(encoding='utf-8'))
        if not re.fullmatch(r'worldos-\d{8}T\d{6}-[a-f0-9]{8}\.sqlite3', data['file']): raise ValueError()
        path = folder/data['file']
        if path.is_symlink() or path.resolve().parent != folder or not path.is_file(): raise ValueError()
        return FileResponse(path,media_type='application/octet-stream',filename=path.name,headers={'Cache-Control':'no-store'})
    except (OSError,ValueError,KeyError,TypeError):
        raise HTTPException(404,'No valid workspace backup is available. Create a backup first.') from None


@app.get("/api/health")
def health(registry: ConnectionRegistry = Depends(get_connection_registry)):
    try:
        settings = AISettings.from_env()
        ai = capabilities(settings)
        entries = diagnostics(settings, registry, configured_ai_service(settings).http)["integrations"]
        for name, entry in entries.items():
            ai[name]["readiness"] = entry["readiness"]
            if entry["readiness"]["status"] == "verified":
                ai[name].update(status="live_verified", message="A validated real provider inference succeeded in this server process.")
            elif entry["readiness"]["status"] in {"needs_retest", "checking"}:
                ai[name].update(status=entry["readiness"]["status"], message=entry["readiness"]["message"])
        ai["live_tested"] = any(entry["last_test"]["ever_live_request_succeeded"] or (entry.get("last_inference") or {}).get("live_request", False) for entry in entries.values())
    except (ValueError, ProviderError):
        ai = {"configuration_error": "Check backend AI environment settings."}
    return {"status": "ok", "vision": "manual", "reasoning": "deterministic_rules", "ai": ai}


@lru_cache(maxsize=2)
def configured_ai_service(settings):
    # Scope cache to all backend settings, including credential identity. No cross-key reuse.
    return AIService(ProviderHTTP(settings))


async def get_ai_service():
    try:
        return configured_ai_service(AISettings.from_env())
    except (ValueError, ProviderError):
        raise HTTPException(503, "Invalid backend AI configuration. Check environment settings.") from None


@app.get("/api/ai/diagnostics")
def ai_diagnostics(response: Response, registry: ConnectionRegistry = Depends(get_connection_registry)):
    response.headers["Cache-Control"] = "no-store"
    try:
        settings = AISettings.from_env()
        return {**diagnostics(settings, registry, configured_ai_service(settings).http), "environment": backend_environment.diagnostics()}
    except (ValueError, ProviderError):
        selected = os.getenv("WORLDOS_SAM_PROVIDER", "baseten")
        return {"configuration_error": "Invalid backend AI settings. Check WORLDOS_SAM_PROVIDER, WORLDOS_MUSE_PROVIDER, WORLDOS_MUSE_MODEL, BASETEN_MUSE_MODEL, BASETEN_BASE_URL, and WORLDOS_AI_TIMEOUT_SECONDS.", "selected_sam_provider": selected if selected in {"meta", "baseten"} else None, "environment": backend_environment.diagnostics(),
                "credentials": {"meta_api_key_configured": bool(os.getenv("MODEL_API_KEY", "").strip()), "baseten_api_key_configured": bool(os.getenv("BASETEN_API_KEY", "").strip()), "baseten_sam_model_id_configured": bool(os.getenv("BASETEN_SAM_MODEL_ID", "").strip())}, "integrations": {}}


@app.post("/api/ai/connection-test")
async def ai_connection_test(request: ConnectionTestRequest, response: Response, service: AIService = Depends(get_ai_service), registry: ConnectionRegistry = Depends(get_connection_registry)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return {**await ConnectionTester(service.http, registry).test(request.integration), "environment": backend_environment.diagnostics()}
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


app.include_router(build_inspect_router(get_ai_service, run_ai))
app.include_router(build_consumer_router())


@app.middleware("http")
async def private_inspection_responses(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/inspect/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# Build with `npm run build` before starting the server for a single-origin app.
dist = Path(__file__).resolve().parents[1] / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
