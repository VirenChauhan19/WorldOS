"""One explicit real-provider check using the bundled public desk photograph."""
import argparse
import asyncio
import base64
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


async def main(report_path):
    from PIL import Image
    from backend.environment import BackendEnvironment
    from backend.ai_service import AIService
    from backend.models import LiveAnalysisRequest
    from backend.providers import AISettings, ProviderHTTP, ProviderError
    from backend.models import LiveObservation
    from pydantic import ValidationError

    class DiagnosticHTTP(ProviderHTTP):
        # Record contract diagnostics only; never credentials or raw payloads.
        async def post(self, **kwargs):
            data = await super().post(**kwargs)
            choice = data.get('choices', [{}])[0]
            report['finish_reason'] = choice.get('finish_reason')
            try:
                LiveObservation.model_validate_json(choice.get('message', {}).get('content', ''), strict=True)
            except ValidationError as error:
                report['validation_errors'] = [{'location': item['loc'], 'type': item['type']} for item in error.errors()]
            return data
    BackendEnvironment()
    with Image.open(ROOT / 'public/desk-preview.webp') as photo:
        photo.thumbnail((768, 768))
        buffer = io.BytesIO()
        photo.convert('RGB').save(buffer, format='JPEG', quality=70)
    image_url = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()
    report = {'checked_at': datetime.now(timezone.utc).isoformat(),
              'scope': 'One API observation of the bundled public desk photo. Not a camera, tracking or accuracy benchmark.'}
    started = perf_counter()
    try:
        result = await AIService(DiagnosticHTTP(AISettings.from_env())).observe_live(LiveAnalysisRequest(image_url=image_url))
        result['objects'] = [obj.model_dump() for obj in result['objects']]
        report.update(status='success', result=result)
    except ProviderError as error:
        report.update(status='failed', error_code=error.code, message=str(error))
    report['duration_ms'] = round((perf_counter() - started) * 1000)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'success' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-live', action='store_true', required=True)
    parser.add_argument('--report', type=Path, default=ROOT / 'artifacts/live-observation.json')
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.report)))
