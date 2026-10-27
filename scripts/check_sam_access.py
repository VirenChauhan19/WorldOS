"""Read Meta's documented model catalog without inference or secret output.

Optional --image PATH --concept "phone" makes exactly ONE real SAM request.
Use only a photograph you authorize sending to Meta. No automatic retries.
Existing process environment takes precedence over the local ignored .env.
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import httpx
from dotenv import load_dotenv
from backend.ai_adapters import SAM31Segmentation, validate_concepts
from backend.imaging import prepare_image
from backend.providers import AISettings, META_BASE, ProviderError, ProviderHTTP, provider_failure


async def check(image=None, concept='phone'):
    load_dotenv(ROOT/'.env', override=False)
    settings=AISettings.from_env()
    report={'endpoint':META_BASE+'/responses','model':'sam-3.1','inference_requests':0}
    if not settings.meta_key:
        return {**report,'status':'missing_credentials'}
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client:
            async with client.stream('GET',META_BASE+'/models',headers={'Authorization':'Bearer '+settings.meta_key}) as response:
                raw=bytearray()
                async for chunk in response.aiter_bytes():
                    raw.extend(chunk)
                    if len(raw)>1_000_000:
                        raise ProviderError('Model catalog exceeded the supported size.')
                report['catalog_http_status']=response.status_code
                if response.status_code!=200:
                    raise provider_failure(response.status_code,raw)
                models=json.loads(raw)['data']
                report['sam_listed']=any(model.get('id')=='sam-3.1' for model in models)
                report['status']='listed_not_inference_verified' if report['sam_listed'] else 'not_listed'
        if image:
            prepared=prepare_image(Path(image).read_bytes())
            concept=validate_concepts([concept])[0]
            # Intentionally test the documented Meta route, never another provider.
            from dataclasses import replace
            adapter=SAM31Segmentation(ProviderHTTP(replace(settings,sam_provider='meta')))
            report['inference_requests']=1
            objects=await adapter.segment(prepared,concept)
            report.update(status='inference_succeeded',objects=[obj.model_dump() for obj in objects],metadata=adapter.metadata())
    except ProviderError as error:
        report.update(status=error.code,provider_http_status=error.http_status,message=str(error))
    except (OSError,ValueError,KeyError,TypeError,httpx.HTTPError):
        report.update(status='check_failed',message='Could not complete the check. No raw provider response or credential was recorded.')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',type=Path)
    parser.add_argument('--concept',default='phone')
    args=parser.parse_args()
    print(json.dumps(asyncio.run(check(args.image,args.concept)),indent=2))
