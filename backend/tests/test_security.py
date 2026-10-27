"""Synthetic authentication/security tests; no real credentials or provider calls."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.middleware.cors import CORSMiddleware
from backend.security import SecuritySettings, SessionAuth, password_hash, parse_hash

PASSPHRASE = 'synthetic test passphrase only'


@pytest.fixture(scope='module')
def encoded():
    return password_hash(PASSPHRASE)


def client_for(settings, clock=lambda: 0, address='testclient', scheme='https'):
    app = FastAPI()
    auth = SessionAuth(settings, clock)
    app.middleware('http')(auth.middleware)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_methods=['GET', 'POST'], allow_headers=['Authorization', 'Content-Type'])
    app.include_router(auth.router())
    @app.get('/api/private')
    def private():
        return {'private': True}
    return TestClient(app, base_url=f'{scheme}://testserver', client=(address, 123)), auth


def test_password_storage_and_validation(encoded):
    assert PASSPHRASE not in encoded
    assert parse_hash(encoded)[0] == 600000
    assert encoded not in repr(SecuritySettings(encoded_password=encoded))
    with pytest.raises(ValueError): password_hash('short')
    with pytest.raises(ValueError): parse_hash('bad hash')


@pytest.mark.parametrize('overrides', [
    {'deployment': 'unknown'}, {'deployment': 'public'},
    {'deployment': 'public', 'hosts': ('*',)},
    {'deployment': 'public', 'origins': ('http://example.com',)},
    {'deployment': 'public', 'origins': ('https://example.com/path',)},
    {'deployment': 'public', 'origins': ()},
])
def test_unsafe_deployment_rejected(encoded, overrides):
    values = dict(encoded_password=encoded, origins=('https://example.com',), hosts=('example.com',))
    values.update(overrides)
    if overrides == {'deployment': 'public'}: values['encoded_password'] = ''
    with pytest.raises(ValueError): SecuritySettings(**values).validate()


def test_public_login_private_routes_logout_expiry_and_cors(encoded):
    now = [0]
    settings = SecuritySettings('public', encoded, ('https://app.example.com','capacitor://localhost','https://localhost'), ('testserver',))
    settings.validate()
    client, auth = client_for(settings, lambda: now[0])
    assert client.get('/api/auth/status').json()['authenticated'] is False
    for path in ('/api/private','/docs','/openapi.json'):
        assert client.get(path).status_code == 401
    response = client.post('/api/auth/login', json={'password': PASSPHRASE})
    assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
    assert response.headers['strict-transport-security']
    token = response.json()['access_token']
    assert token not in repr(auth.store.db.execute('SELECT * FROM sessions').fetchall())
    headers = {'Authorization': f'Bearer {token}'}
    assert client.get('/api/private', headers=headers).status_code == 200
    assert client.get('/api/private', headers={**headers,'Origin':'https://app.example.com'}).headers['access-control-allow-origin'] == 'https://app.example.com'
    for origin in settings.origins:
        assert client.options('/api/private', headers={'Origin':origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization'}).status_code == 200
    assert client.options('/api/private', headers={'Origin':'https://evil.example','Access-Control-Request-Method':'GET'}).status_code == 400
    assert client.post('/api/auth/logout', headers=headers).status_code == 200
    assert client.get('/api/private', headers=headers).status_code == 401
    token2 = client.post('/api/auth/login', json={'password': PASSPHRASE}).json()['access_token']
    now[0] = 8*60*60+1
    assert client.get('/api/private', headers={'Authorization':f'Bearer {token2}'}).status_code == 401


def test_failed_login_is_rate_limited_without_leaking_password(encoded):
    client, _ = client_for(SecuritySettings(encoded_password=encoded))
    for _ in range(5):
        response = client.post('/api/auth/login', json={'password': 'incorrect private input'})
        assert response.status_code == 401 and 'incorrect private input' not in response.text
    response = client.post('/api/auth/login', json={'password': PASSPHRASE})
    assert response.status_code == 429 and response.headers['retry-after'] == '900'


@pytest.mark.parametrize('deployment,scheme,address,expected', [
    ('public','http','127.0.0.1',403), ('local','http','192.0.2.1',403),
    ('local','https','192.0.2.1',403), ('local','http','127.0.0.1',200),
])
def test_insecure_and_unauthenticated_remote_access_rejected(encoded,deployment,scheme,address,expected):
    settings = SecuritySettings(deployment=deployment, encoded_password=encoded if deployment=='public' else '')
    client, _ = client_for(settings, scheme=scheme, address=address)
    assert client.get('/api/auth/status').status_code == expected


def test_main_auth_validation_never_echoes_input():
    from backend.main import app
    with TestClient(app) as client:
        response = client.post('/api/auth/login', json={'password':'test-private-input','extra':'test-private-input'})
        assert response.status_code == 422 and 'test-private-input' not in response.text
