"""One opt-in real Muse question about the bundled public desk photograph."""
import argparse
import asyncio
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sys
from time import perf_counter

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


async def main(report_path):
    from PIL import Image
    from backend.environment import BackendEnvironment
    from backend.imaging import prepare_image
    from backend.ai_service import AIService
    from backend.models import SceneQuestionRequest
    from backend.providers import AISettings, ProviderHTTP, ProviderError
    BackendEnvironment()
    with Image.open(ROOT/'public/desk-preview.webp') as photo:
        photo.thumbnail((1280,1280))
        buffer=io.BytesIO();photo.convert('RGB').save(buffer,format='JPEG',quality=82)
    image=prepare_image(buffer.getvalue())
    recorded=json.loads((ROOT/'docs/v18-live-recognition.json').read_text(encoding='utf-8'))
    question='How could I make this desk easier to work at, and what should I measure before adding another device?'
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'scope':'One live Muse question about the bundled public photo and previously recorded SAM detections. No private image, physical fit test or hosted deployment check.', 'question':question,'public_source':recorded['public_source']}
    started=perf_counter()
    try:
        result=await AIService(ProviderHTTP(AISettings.from_env())).ask(SceneQuestionRequest(image_url=image['image_url'],objects=recorded['objects'],question=question))
        report.update(status='success',result=result)
    except ProviderError as error:
        report.update(status='failed',error_code=error.code,message=str(error))
    report['duration_ms']=round((perf_counter()-started)*1000)
    report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2));return 0 if report['status']=='success' else 1


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-live',action='store_true',required=True,help='Run one potentially billed question with the existing configured provider.')
    parser.add_argument('--report',type=Path,default=ROOT/'artifacts/scene-question.json')
    args=parser.parse_args();raise SystemExit(asyncio.run(main(args.report)))
