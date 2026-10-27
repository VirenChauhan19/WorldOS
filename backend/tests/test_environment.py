"""Synthetic configuration files only; never edit the developer's root dotenv."""
import json
import os
from pathlib import Path

import pytest

from backend.environment import BackendEnvironment, ROOT_ENV, TRACKED


def clear_settings(monkeypatch):
    monkeypatch.setattr(os, "environ", dict(os.environ))
    for name in TRACKED:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("PYTHON_DOTENV_DISABLED", raising=False)


@pytest.mark.parametrize("inherited", ["", "process-test-secret"])
def test_process_precedence_preserves_keys_including_empty_overrides(tmp_path, monkeypatch, inherited):
    clear_settings(monkeypatch)
    path = tmp_path / ".env"
    content = "MODEL_API_KEY=file-test-secret\nBASETEN_API_KEY=baseten-test-secret\nWORLDOS_SAM_PROVIDER=meta\n"
    path.write_text(content)
    monkeypatch.setenv("MODEL_API_KEY", inherited)
    environment = BackendEnvironment(path)
    result = environment.diagnostics()
    meta = result["variables"]["MODEL_API_KEY"]
    assert os.environ["MODEL_API_KEY"] == inherited
    assert os.environ["BASETEN_API_KEY"] == "baseten-test-secret"
    assert path.read_text() == content
    assert meta["source"] == "process_environment"
    assert meta["empty_process_override"] == (inherited == "")
    assert result["variables"]["BASETEN_API_KEY"]["source"] == "root_dotenv"
    assert not result["restart_required"]
    assert "test-secret" not in json.dumps(result)


def test_missing_and_empty_configuration_are_distinct(tmp_path, monkeypatch):
    clear_settings(monkeypatch)
    path = tmp_path / ".env"
    missing = BackendEnvironment(path).diagnostics()
    assert missing["dotenv_status"] == "missing"
    assert missing["variables"]["MODEL_API_KEY"]["state"] == "absent"
    path.write_text("MODEL_API_KEY=\n")
    empty = BackendEnvironment(path).diagnostics()
    assert empty["variables"]["MODEL_API_KEY"]["state"] == "empty"
    assert empty["variables"]["MODEL_API_KEY"]["source"] == "root_dotenv"
    assert empty["variables"]["BASETEN_API_KEY"]["state"] == "absent"


def test_absolute_root_loading_does_not_depend_on_launch_directory(tmp_path, monkeypatch):
    clear_settings(monkeypatch)
    assert ROOT_ENV == Path(__file__).resolve().parents[2] / ".env"
    root = tmp_path / "project"
    root.mkdir()
    path = root / ".env"
    path.write_text("MODEL_API_KEY=absolute-root-test-secret\n")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / ".env").write_text("MODEL_API_KEY=wrong-location-test-secret\n")
    monkeypatch.chdir(elsewhere)
    result = BackendEnvironment(path).diagnostics()
    assert os.environ["MODEL_API_KEY"] == "absolute-root-test-secret"
    assert result["variables"]["MODEL_API_KEY"]["source"] == "root_dotenv"


def test_disk_edits_require_restart_and_passive_diagnostics_never_reload(tmp_path, monkeypatch):
    clear_settings(monkeypatch)
    path = tmp_path / ".env"
    path.write_text("MODEL_API_KEY=first-test-secret\n")
    environment = BackendEnvironment(path)
    path.write_text("MODEL_API_KEY=second-test-secret\n")
    result = environment.diagnostics()
    assert result["restart_required"]
    assert os.environ["MODEL_API_KEY"] == "first-test-secret"
    assert "test-secret" not in json.dumps(result)
    path.unlink()
    assert environment.diagnostics()["dotenv_status"] == "missing"
    assert environment.diagnostics()["restart_required"]
    monkeypatch.setenv("MODEL_API_KEY", "changed-runtime-test-secret")
    assert environment.diagnostics()["variables"]["MODEL_API_KEY"]["source"] == "runtime_environment"


def test_malformed_duplicate_and_unknown_assignments_are_sanitized(tmp_path, monkeypatch, caplog):
    clear_settings(monkeypatch)
    path = tmp_path / ".env"
    path.write_text("MODEL_API_KEY=first-test-secret\nMODEL_API_KEY=second-test-secret\nSECRET_UNKNOWN=hidden-test-secret\ninvalid line containing private-test-secret\n")
    result = BackendEnvironment(path).diagnostics()
    assert result["parse_errors"] == 1
    assert result["duplicate_assignments"] == 1
    assert os.environ["MODEL_API_KEY"] == "second-test-secret"
    assert "SECRET_UNKNOWN" not in json.dumps(result)
    assert "test-secret" not in json.dumps(result) + caplog.text


def test_unreadable_dotenv_keeps_inherited_configuration(tmp_path, monkeypatch):
    clear_settings(monkeypatch)
    monkeypatch.setenv("MODEL_API_KEY", "inherited-test-secret")
    path = tmp_path / ".env"
    path.write_bytes(b"\xff")
    result = BackendEnvironment(path).diagnostics()
    assert result["dotenv_status"] == "unreadable"
    assert result["variables"]["MODEL_API_KEY"]["state"] == "set"
    assert os.environ["MODEL_API_KEY"] == "inherited-test-secret"
