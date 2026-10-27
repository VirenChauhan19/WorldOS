"""Synthetic provider regressions. Live evidence is recorded separately."""
import asyncio
import json
import logging

import httpx
import pytest

from backend.ai_service import AIService
from backend.connection import ConnectionRegistry, ConnectionTester, diagnostics
from backend.inspection import explain_inspection
from backend.providers import AISettings, ProviderError, ProviderHTTP
from backend.models import AIAnalysisRequest
from backend.tests.test_ai import chat, constraints, photo, reasoning_request, sam_response
from backend.tests.test_inspect import record

MODEL='meta-models/muse-spark-open-1026'


def service(handler, **kwargs):
    return AIService(ProviderHTTP(AISettings(baseten_key='test-baseten-private',sam_provider='meta',**kwargs),httpx.MockTransport(handler)))


def test_baseten_auto_selection_and_explicit_meta_fallback_configuration(monkeypatch):
    monkeypatch.setenv('WORLDOS_SAM_PROVIDER','meta')
    monkeypatch.setenv('BASETEN_API_KEY','configured-test-key')
    monkeypatch.setenv('MODEL_API_KEY','meta-test-key')
    settings=AISettings.from_env();assert settings.reasoning_provider=='baseten'
    assert settings.reasoning_config()[1]==MODEL
    assert settings.sam_provider=='meta'
    monkeypatch.setenv('WORLDOS_MUSE_PROVIDER','meta')
    assert AISettings.from_env().reasoning_provider=='meta'
    monkeypatch.setenv('WORLDOS_MUSE_PROVIDER','auto');monkeypatch.setenv('BASETEN_API_KEY','')
    assert AISettings.from_env().reasoning_provider=='meta'


def test_baseten_chat_contract_validates_json_locally_and_reports_usage(caplog):
    caplog.set_level(logging.INFO,logger='uvicorn.error.worldos.usage')
    def handler(req):
        assert str(req.url)=='https://inference.baseten.co/v1/chat/completions'
        assert req.headers['authorization']=='Bearer test-baseten-private'
        payload=json.loads(req.content)
        assert payload['model']==MODEL and 'response_format' not in payload and 'reasoning_effort' not in payload
        assert payload['max_tokens']==4096 and 'PlanningConstraints' in payload['messages'][0]['content']
        assert payload['messages'][1]['content'][1]['type']=='image_url'
        return httpx.Response(200,json=chat(constraints(),model=MODEL))
    ai=service(handler)
    result=asyncio.run(ai.reason(reasoning_request()))
    assert result['provider']=='baseten' and result['model']==MODEL and result['live_request'] is False
    assert result['usage']['total_tokens']==157 and result['inference_latency_ms']>=0
    assert result['constraints'].protected_object_ids==['coffee']
    assert 'test-baseten-private' not in caplog.text and 'Give my laptop' not in caplog.text
    assert ai.http.validated_inferences[('baseten',MODEL)]['operation']=='interpret_goal'


@pytest.mark.parametrize('value',[constraints(needs_clarification='false'),constraints(extra='not allowed'),constraints(protected_object_ids=['unknown'])])
def test_invalid_structured_or_unknown_identity_output_never_reaches_planner(value):
    calls=[]
    ai=service(lambda r:(calls.append(r) or httpx.Response(200,json=chat(value,model=MODEL))),meta_key='meta-fallback')
    with pytest.raises(ProviderError):asyncio.run(ai.reason(reasoning_request()))
    assert not ai.http.validated_inferences
    assert len(calls)==1  # Invalid output is not hidden by provider fallback.


def test_bounded_fallback_reports_actual_meta_provider_and_failure_reason():
    calls=[]
    def handler(req):
        calls.append(req.url.host)
        if req.url.host=='inference.baseten.co':return httpx.Response(429,json={'error':{'code':'rate_limit','message':'NEVER ECHO THIS'}})
        return httpx.Response(200,json=chat(constraints()))
    ai=service(handler,meta_key='meta-fallback')
    result=asyncio.run(ai.reason(reasoning_request()))
    assert calls==['inference.baseten.co','api.meta.ai']
    assert result['provider']=='meta' and result['fallback']=={'from_provider':'baseten','reason':'rate_limited'}
    assert ('baseten',MODEL) not in ai.http.validated_inferences


@pytest.mark.parametrize('status,code',[(401,'invalid_credentials'),(402,'insufficient_credits'),(403,'unsupported_model_access'),(429,'rate_limited'),(504,'timeout')])
def test_baseten_failures_are_sanitized_and_not_retried_without_meta_key(status,code):
    calls=[]
    ai=service(lambda r:(calls.append(r) or httpx.Response(status,text='test-baseten-private upstream echo')))
    with pytest.raises(ProviderError) as failure:asyncio.run(ai.reason(reasoning_request()))
    assert failure.value.code==code and 'private' not in str(failure.value)
    assert len(calls)==1


def test_credit_exhaustion_in_429_is_classified_separately():
    ai=service(lambda _:httpx.Response(429,json={'error':{'code':'insufficient_quota','message':'private'}}))
    with pytest.raises(ProviderError) as error:asyncio.run(ai.reason(reasoning_request()))
    assert error.value.code=='insufficient_credits'


def test_timeout_is_bounded_and_does_not_expose_transport_error():
    def handler(req):raise httpx.ReadTimeout('private key in upstream error',request=req)
    with pytest.raises(ProviderError) as failure:asyncio.run(service(handler).reason(reasoning_request()))
    assert failure.value.code=='timeout' and 'private' not in str(failure.value)


def test_meta_sam_is_independent_of_baseten_reasoning():
    def handler(req):
        assert str(req.url)=='https://api.meta.ai/v1/responses'
        assert req.headers['authorization']=='Bearer test-meta-private'
        return httpx.Response(200,json=sam_response())
    result=asyncio.run(service(handler,meta_key='test-meta-private').analyze(AIAnalysisRequest(image_url=photo(),concepts=['book'])))
    assert result['provider']=='meta' and result['model']=='sam-3.1'


def test_baseten_inspection_explanation_and_unknown_id_guard():
    def response(identity):return httpx.Response(200,json=chat({'summary':'Review the reported workspace difference.','findings':[{'object_id':identity,'explanation':'The object is displaced.','next_step':'Review the deterministic correction plan.'}]},model=MODEL))
    result=asyncio.run(explain_inspection(record(),service(lambda _:response('book'))))
    assert result['provider']=='baseten' and result['source']=='ai_generated_advisory'
    with pytest.raises(ProviderError):asyncio.run(explain_inspection(record(),service(lambda _:response('invented'))))


def test_inspection_prompt_inlines_nested_schema_and_requests_data_only():
    def handler(request):
        prompt=json.loads(request.content)['messages'][0]['content']
        assert 'JSON DATA INSTANCE, not the JSON Schema itself' in prompt
        assert 'only allowed top-level output fields are: summary, findings.' in prompt
        schema=json.loads(prompt.split('JSON Schema for data validation: ',1)[1])
        assert '$defs' not in json.dumps(schema) and '$ref' not in json.dumps(schema)
        finding=schema['properties']['findings']['items']
        assert set(finding['required'])=={'object_id','explanation','next_step'}
        assert finding['additionalProperties'] is False and schema['additionalProperties'] is False
        assert finding['properties']['explanation']['maxLength']==1000
        return httpx.Response(200,json=chat({'summary':'Review is still required.','findings':[{'object_id':'book','explanation':'A placement needs review.','next_step':'Check the observed object.'}]},model=MODEL))
    result=asyncio.run(explain_inspection(record(),service(handler)))
    assert result['findings'][0]['object_id']=='book'


def test_schema_metadata_echo_remains_rejected_without_fallback_or_success():
    # Regression shape reproduced by real Baseten requests; synthetic content here.
    calls=[]
    value={'$defs':{'InspectionFinding':{'type':'object'}},'summary':'Review required.','findings':[]}
    ai=service(lambda r:(calls.append(r) or httpx.Response(200,json=chat(value,model=MODEL))),meta_key='synthetic-meta-fallback')
    with pytest.raises(ProviderError) as error:
        asyncio.run(explain_inspection(record(),ai))
    assert error.value.code=='malformed_response'
    assert len(calls)==1 and not ai.http.validated_inferences


def test_connection_probe_is_baseten_only_and_has_safe_latency():
    calls=[]
    def handler(req):
        calls.append(req);payload=json.loads(req.content)
        assert payload=={'model':MODEL,'messages':[{'role':'user','content':'Reply briefly with OK.'}],'max_tokens':256}
        return httpx.Response(200,json=chat({},model=MODEL,object='chat.completion'))
    ai=service(handler,meta_key='meta-fallback');registry=ConnectionRegistry()
    result=asyncio.run(ConnectionTester(ai.http,registry).test('muse'))
    entry=result['integrations']['muse']
    assert entry['provider']=='baseten' and entry['last_test']['status']=='validated_test_response'
    assert entry['last_test']['inference_latency_ms']>=0 and entry['last_inference']['usage']['total_tokens']==157
    assert entry['fallback_available'] and len(calls)==1 and 'private' not in json.dumps(result)


def test_connection_failure_never_uses_meta_to_claim_baseten_success():
    calls=[];ai=service(lambda r:(calls.append(r) or httpx.Response(401,text='secret')),meta_key='meta-fallback')
    result=asyncio.run(ConnectionTester(ai.http,ConnectionRegistry()).test('muse'))
    assert result['integrations']['muse']['last_test']['status']=='invalid_credentials' and len(calls)==1


@pytest.mark.parametrize('kwargs',[{'baseten_base_url':'https://untrusted.example/v1'},{'baseten_base_url':'http://inference.baseten.co/v1'},{'baseten_muse_model':'secret-string'},{'muse_provider':'invalid'}])
def test_configuration_cannot_send_credentials_to_an_arbitrary_host(kwargs):
    with pytest.raises(ProviderError):AISettings(**kwargs).validate()


def test_baseten_telemetry_is_scoped_to_credential_and_model():
    registry=ConnectionRegistry();old=AISettings(baseten_key='old')
    registry.begin(old,'muse');registry.finish(old,'muse','success','fixture',live=True,metadata={'inference_latency_ms':10,'usage':{}})
    assert registry.state(old,'muse')['ever_live_request_succeeded']
    assert not registry.state(AISettings(baseten_key='changed'),'muse')['ever_live_request_succeeded']


def test_concurrent_fallback_metadata_does_not_cross_requests():
    async def handler(req):
        payload=json.loads(req.content);text=payload['messages'][1]['content'][0]['text']
        if req.url.host=='inference.baseten.co' and 'fallback case' in text:return httpx.Response(503,json={'error':{}})
        await asyncio.sleep(.001)
        return httpx.Response(200,json=chat(constraints(),model=payload['model']))
    ai=service(handler,meta_key='meta-fallback')
    async def run():return await asyncio.gather(ai.reason(reasoning_request(goal='fallback case')),ai.reason(reasoning_request(goal='baseten case')))
    first,second=asyncio.run(run())
    assert first['provider']=='meta' and second['provider']=='baseten' and 'fallback' not in second


def test_passive_diagnostics_and_health_reflect_validated_application_calls(monkeypatch):
    # Synthetic metadata only; no real connection claim outside this unit test.
    from fastapi.testclient import TestClient
    from backend.main import app, configured_ai_service
    monkeypatch.setenv('BASETEN_API_KEY','isolated-telemetry-test')
    settings=AISettings.from_env();http=configured_ai_service(settings).http
    http.record_validated({'provider':'baseten','model':MODEL,'operation':'interpret_goal','live_request':True,'inferred_at':'2026-10-26T12:00:00Z','inference_latency_ms':42,'usage':{'total_tokens':50}})
    c=TestClient(app)
    data=c.get('/api/ai/diagnostics');assert 'isolated-telemetry-test' not in data.text
    assert data.json()['integrations']['muse']['last_inference']['inference_latency_ms']==42
    assert c.get('/api/health').json()['ai']['muse']['status']=='live_verified'
    monkeypatch.setenv('BASETEN_API_KEY','different-telemetry-test')
    assert c.get('/api/ai/diagnostics').json()['integrations']['muse']['last_inference'] is None
