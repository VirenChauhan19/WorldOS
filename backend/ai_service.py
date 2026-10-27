import asyncio
from time import perf_counter

from .ai_adapters import MuseSparkReasoning, SAM31Segmentation, validate_concepts
from .imaging import image_from_data_url
from .inference_cache import InferenceCache
from .models import AIAnalysisRequest, ReasonRequest
from .providers import ProviderError, ProviderHTTP


def iou(a, b):
    intersection = max(0, min(a.x + a.width, b.x + b.width) - max(a.x, b.x)) * max(0, min(a.y + a.height, b.y + b.height) - max(a.y, b.y))
    return intersection / (a.width * a.height + b.width * b.height - intersection)


class AIService:
    def __init__(self, http: ProviderHTTP):
        self.http = http
        self.sam = SAM31Segmentation(http)
        self.muse = MuseSparkReasoning(http)
        self.cache = InferenceCache()

    async def analyze(self, request: AIAnalysisRequest):
        # Validate before any billable request. Block an unsupported Baseten path before discovery.
        if self.http.settings.sam_provider == "baseten":
            raise ProviderError("Baseten SAM is blocked: provide the deployment ID and verified SAM request/response contract. No external request was made. Optional verified alternative: WORLDOS_SAM_PROVIDER=meta.", 503)
        image = image_from_data_url(request.image_url)
        concepts = validate_concepts(request.concepts)
        return await self.cache.get({"operation": "analyze", "image": image["image_url"], "concepts": concepts},
                                    lambda: self._analyze(image, concepts))

    async def _analyze(self, image, concepts):
        summary = "User-supplied segmentation concepts."
        if not concepts:
            discovery = await self.muse.discover(image["image_url"])
            concepts, summary = discovery.concepts, discovery.summary
        semaphore = asyncio.Semaphore(3)
        timings = {}

        async def segment(index, concept):
            async with semaphore:
                started = perf_counter()
                detections = await self.sam.segment(image, concept)
                timings[concept] = round((perf_counter() - started) * 1000)
                return [obj.model_copy(update={"id": f"sam-{index}-{obj.id.removeprefix('sam-')}"}) for obj in detections]

        # Collect every task, including failures; don't leak background billable calls.
        batches = await asyncio.gather(*(segment(i, concept) for i, concept in enumerate(concepts)), return_exceptions=True)
        for batch in batches:
            if isinstance(batch, BaseException):
                raise batch
        detections = []
        duplicates = 0
        for batch in batches:
            for obj in batch:
                if any(iou(obj.box, old.box) > .9 for old in detections):
                    duplicates += 1
                else:
                    detections.append(obj)
        if len(detections) > 12:
            raise ProviderError(f"SAM found {len(detections)} distinct objects; the planner supports 12. Narrow the concepts or annotate manually. No partial inventory was applied.", 422)
        warnings = ["Review every detection and label, add missed obstacles, and correct overlapping boxes before planning. Detection is not an exhaustive inventory."]
        if duplicates:
            warnings.append(f"Removed {duplicates} near-identical detections across concepts; review the retained labels.")
        return {"objects": detections, "concepts": concepts, "summary": summary, "annotation_source": "sam_3_1", "provider": "meta", "model": "sam-3.1", "warnings": warnings,
                "message": f"SAM returned {len(detections)} object(s). Review annotations before planning." if detections else "No matches returned. Try different noun phrases or annotate manually.",
                "image_width": image["width"], "image_height": image["height"], "concept_latency_ms": timings}

    async def reason(self, request: ReasonRequest):
        image_url = image_from_data_url(request.image_url)["image_url"] if request.image_url else None
        canonical = request.model_copy(update={"image_url": image_url})
        return await self.cache.get({"operation": "reason", **canonical.model_dump()}, lambda: self._reason(canonical))

    async def _reason(self, request):
        result = await self.muse.interpret(request)
        return {"constraints": result, **self.muse.metadata(),
                "confidence": None, "message": "Review interpreted constraints before applying them. Muse Spark does not supply a calibrated confidence score for this response."}
