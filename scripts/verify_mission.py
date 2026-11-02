"""Opt-in real Muse task plan using the bundled public photograph and recorded SAM IDs."""
import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


async def verify(report_path):
    from backend.environment import BackendEnvironment
    from backend.imaging import prepare_image
    from backend.ai_service import AIService
    from backend.missions import make_plan
    from backend.providers import AISettings, ProviderHTTP, ProviderError

    BackendEnvironment()
    image = prepare_image((ROOT / 'public/desk-preview.webp').read_bytes())
    recorded = json.loads((ROOT / 'docs/v18-live-recognition.json').read_text(encoding='utf-8'))
    protected = [obj['id'] for obj in recorded['objects'] if obj['label'].lower() == 'monitor']
    data = {'goal': 'Help me prepare this desk for a focused study or work session using what I already have.',
            'constraints': 'Keep my monitor in place and all cables connected.', 'working_image': image,
            'analysis': {'objects': recorded['objects']}, 'history': []}
    report = {'checked_at': datetime.now(timezone.utc).isoformat(),
              'scope': 'One live Muse task plan from a public photograph and previously recorded SAM IDs. No physical task execution, after-photo assessment, accuracy benchmark, or hosted deployment check.',
              'public_source': recorded['public_source'], 'goal': data['goal'], 'constraints': data['constraints'],
              'protected_ids': protected}
    started = perf_counter()
    try:
        result = await make_plan(AIService(ProviderHTTP(AISettings.from_env())), data, protected, '')
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
    parser.add_argument('--run-live', action='store_true', required=True, help='Run one potentially billed plan with the configured provider.')
    parser.add_argument('--report', type=Path, default=ROOT / 'artifacts/mission-live-plan.json')
    args = parser.parse_args()
    raise SystemExit(asyncio.run(verify(args.report)))
