"""Explicit live-provider rehearsal on credited public room photographs.

No known physical dimensions are available; this checks integration and visible
feature grounding, not metric accuracy. Results are stored only in artifacts/.
"""
import argparse
import asyncio
import base64
import json
import sys
from pathlib import Path
from time import perf_counter

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.main import get_ai_service
from backend.room_design import PhotoRequest, DesignRequest, survey_room, design_room

parser=argparse.ArgumentParser()
parser.add_argument('--photo')
parser.add_argument('--refine-recording',help='Refine a previously recorded live design')
parser.add_argument('--output',required=True)
args=parser.parse_args()

async def run():
    ai=await get_ai_service()
    if args.refine_recording:
        previous=json.loads(Path(args.refine_recording).read_text(encoding='utf-8'))
        survey=previous['survey']; original=previous['design']
        goal='Add a compact bookshelf without moving or resizing my other pieces. Keep all radiator, vent and access reservations clear.'
        request=DesignRequest(image_url=survey['image_url'],goal=goal,style='open',room={k:v for k,v in survey['room'].items() if k in {'width','depth','height'}},zones=survey['zones'],features=survey['features'],items=original['items'],placements=[{k:v for k,v in p.items() if k!='reason'} for p in previous.get('checked_placements',original['placements'])],gap=.3)
        started=perf_counter();result=await design_room(request,ai)
        output={'photo':previous['photo'],'scope':'Live refinement of recorded real-photo design; checked current placements supplied when available.','survey':survey,'design':result,'seconds':round(perf_counter()-started,2),'previous_design':original}
        Path(args.output).write_text(json.dumps(output,indent=2),encoding='utf-8')
        print(json.dumps({'stage':'refinement','seconds':output['seconds'],'items':result['items'],'placements':result['placements']}),flush=True)
        return
    if not args.photo:parser.error('--photo or --refine-recording is required')
    image='data:image/webp;base64,'+base64.b64encode(Path(args.photo).read_bytes()).decode()
    output={'photo':args.photo,'scope':'Real photograph; no physical dimensions known. Integration and visible features only.'}
    target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True)
    started=perf_counter()
    result=await survey_room(PhotoRequest(image_url=image),ai)
    output.update(survey=result,survey_seconds=round(perf_counter()-started,2))
    target.write_text(json.dumps(output,indent=2),encoding='utf-8')
    print(json.dumps({'stage':'survey','seconds':output['survey_seconds'],'status':result['status'],'summary':result['summary'],'features':result['features'],'corners':result['floor_corners']}),flush=True)
    if result['room']:
        room={k:v for k,v in result['room'].items() if k in {'width','depth','height'}}
        started=perf_counter()
        request=DesignRequest(image_url=result['image_url'],goal='Add a compact sofa, a desk near the window, and a plant. Keep the centre open and leave radiators and vents clear.',style='open',room=room,zones=result['zones'],features=result['features'],items=[],gap=.3)
        result=await design_room(request,ai)
        output.update(design=result,design_seconds=round(perf_counter()-started,2))
        target.write_text(json.dumps(output,indent=2),encoding='utf-8')
        print(json.dumps({'stage':'design','seconds':output['design_seconds'],'title':result['title'],'items':[i['label'] for i in result['items']],'placements':result['placements']}),flush=True)

asyncio.run(run())
