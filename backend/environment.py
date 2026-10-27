"""Load the root dotenv once, preserving process precedence and exposing no values."""
import hashlib
import hmac
import io
import os
from pathlib import Path

from dotenv import load_dotenv
from dotenv.parser import parse_stream

ROOT_ENV = Path(__file__).resolve().parents[1] / ".env"
TRACKED = ("MODEL_API_KEY", "BASETEN_API_KEY", "WORLDOS_SAM_PROVIDER", "WORLDOS_MUSE_PROVIDER",
           "WORLDOS_MUSE_MODEL", "BASETEN_MUSE_MODEL", "BASETEN_BASE_URL", "WORLDOS_AI_TIMEOUT_SECONDS")


def value_state(value):
    return "absent" if value is None else "set" if value.strip() else "empty"


def file_snapshot(path):
    try:
        raw = path.read_bytes()
        parsed = list(parse_stream(io.StringIO(raw.decode("utf-8"))))
    except FileNotFoundError:
        return None, "missing", {}, 0, 0
    except (OSError, UnicodeError):
        return None, "unreadable", {}, 0, 0
    values, duplicates = {}, 0
    for binding in parsed:
        if binding.key in TRACKED:
            duplicates += binding.key in values
            values[binding.key] = value_state(binding.value)
    # This digest stays private; it is only used to detect edits requiring restart.
    return hashlib.sha256(raw).digest(), "readable", values, sum(p.error for p in parsed), duplicates


class BackendEnvironment:
    def __init__(self, path=ROOT_ENV):
        self._path = Path(path).resolve()
        self._secret = os.urandom(32)
        self._inherited = {name: name in os.environ for name in TRACKED}
        self._file = file_snapshot(self._path)
        # Never overwrite even an empty process variable. An empty override can
        # intentionally disable paid inference in tests or a deployment.
        if self._file[1] == "readable":
            load_dotenv(self._path, override=False)
        self._loaded = {name: self._identity(name) for name in TRACKED}
        self._sources = {name: "process_environment" if self._inherited[name] else
                         "root_dotenv" if name in os.environ and self._file[2].get(name) not in {None, "absent"} else
                         "default_or_unset" for name in TRACKED}

    def _identity(self, name):
        value = os.environ.get(name)
        return hmac.digest(self._secret, ("absent" if value is None else "value:" + value).encode(), "sha256")

    def diagnostics(self):
        current = file_snapshot(self._path)
        changed = current[:2] != self._file[:2]
        variables = {}
        for name in TRACKED:
            source = self._sources[name] if hmac.compare_digest(self._loaded[name], self._identity(name)) else "runtime_environment"
            state = value_state(os.getenv(name))
            variables[name] = {"state": state, "source": source,
                               "dotenv_assignment": current[2].get(name, "absent"),
                               "empty_process_override": source == "process_environment" and state == "empty" and current[2].get(name) == "set"}
        return {"dotenv_file": "repository root .env", "dotenv_status": current[1],
                "loaded_at": "backend startup", "precedence": "process environment (including empty values) > root .env > defaults",
                "restart_required": changed, "parse_errors": current[3], "duplicate_assignments": current[4],
                "variables": variables,
                "message": "Root .env changed after startup. Restart the backend to reload it; process overrides still take precedence." if changed else
                           "Root .env is loaded once by absolute path. Values and file fingerprints are never returned. Restart after configuration changes."}
