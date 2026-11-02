"""One opt-in automatic recognition chain on the bundled licensed public photograph.

Uses the configured existing providers, with no manual concepts or mocked model
results. This checks connectivity/integration, not physical-camera accuracy.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


async def verify(report_path):
    from PIL import Image
    from backend.environment import BackendEnvironment
    from backend.ai_service import AIService
    from backend.imaging import prepare_image
    from backend.models import AIAnalysisRequest
    from backend.providers import AISettings, ProviderError, ProviderHTTP

    BackendEnvironment()

    class BoundedHTTP(ProviderHTTP):
        calls = 0

        async def post(self, **kwargs):
            self.calls += 1
            if self.calls > 14:  # 12 concepts + discovery and its existing fallback
                raise RuntimeError('Recognition exceeded the bounded request budget.')
            return await super().post(**kwargs)

    raw = (ROOT / 'public/desk-preview.webp').read_bytes()
    with Image.open(io.BytesIO(raw)) as photo:
        photo.thumbnail((1280, 1280))
        buffer = io.BytesIO()
        photo.convert('RGB').save(buffer, format='JPEG', quality=82)
    image = prepare_image(buffer.getvalue())
    http = BoundedHTTP(AISettings.from_env())
    report = {
        'checked_at': datetime.now(timezone.utc).isoformat(),
        'scope': 'One automatic recognition chain on the bundled public Unsplash photograph, compressed to match live camera capture. Not a hardware or physical accuracy test.',
        'public_source': 'https://unsplash.com/photos/ElFBCgOfoIM',
        'image_sha256': hashlib.sha256(buffer.getvalue()).hexdigest(),
        'image_dimensions': {'width': image['width'], 'height': image['height']},
        'concepts_supplied': [], 'purpose': 'live',
        'physical_camera_tested': False, 'public_deployment_verified': False,
    }
    started = perf_counter()
    try:
        async with asyncio.timeout(130):
            result = await AIService(http).analyze(AIAnalysisRequest(image_url=image['image_url'], concepts=[], purpose='live'))
        report.update(status='success' if result['objects'] else 'empty',
                      discovery_model=(result.get('concept_discovery') or {}).get('model'),
                      discovery_latency_ms=(result.get('concept_discovery') or {}).get('inference_latency_ms'),
                      concept_latency_ms=result.get('concept_latency_ms'),
                      localization_model=result['model'], live_request=result['live_request'],
                      concepts=result['concepts'], summary=result['summary'],
                      object_count=len(result['objects']), total_objects=result['total_objects'],
                      unmatched_concepts=result['unmatched_concepts'], truncated=result['truncated'],
                      objects=[obj.model_dump() if hasattr(obj, 'model_dump') else obj for obj in result['objects']])
    except ProviderError as error:
        report.update(status='failed', error_code=error.code, message=str(error), provider_http_status=error.http_status)
    except TimeoutError:
        report.update(status='failed', error_code='timeout', message='The complete chain exceeded 130 seconds.')
    report.update(duration_ms=round((perf_counter() - started) * 1000), external_request_count=http.calls)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'objects'}, indent=2))
    return 0 if report['status'] == 'success' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-live', action='store_true', required=True, help='Run one potentially billed recognition chain on a public photograph.')
    parser.add_argument('--report', type=Path, default=ROOT / 'artifacts/live-recognition.json')
    args = parser.parse_args()
    raise SystemExit(asyncio.run(verify(args.report)))
