"""Default software tests never inherit a developer's real paid credentials."""
import os
import pytest

# Set before importing the application, independently of the operator's .env.auth.
os.environ['WORLDOS_DEPLOYMENT'] = 'local'
os.environ['WORLDOS_AUTH_PASSWORD_HASH'] = ''
os.environ['WORLDOS_JUDGE_PASSWORD_HASH'] = ''
os.environ['WORLDOS_JUDGE_ACCESS_EXPIRES_AT'] = ''
os.environ['WORLDOS_ALLOWED_HOSTS'] = 'localhost,127.0.0.1,[::1],testserver'
os.environ['WORLDOS_CORS_ORIGINS'] = 'http://localhost:5173,http://127.0.0.1:5173'


@pytest.fixture(autouse=True)
def isolate_credentials(request, monkeypatch):
    if request.node.get_closest_marker("live") and os.getenv("WORLDOS_RUN_LIVE_AI") == "1":
        return
    for name in ("MODEL_API_KEY", "BASETEN_API_KEY"):
        monkeypatch.setenv(name, "")
    monkeypatch.setenv("WORLDOS_MUSE_PROVIDER", "auto")
