"""Minimal health readiness with no provider calls or configuration disclosure."""
import os
from pathlib import Path
import tempfile
from .inspect_store import get_inspection_store


def data_directory():
    return Path(os.getenv('WORLDOS_DATA_DIR',str(Path(__file__).resolve().parents[1]/'data')))


def storage_ready():
    store = get_inspection_store()
    with store.connect() as db:
        db.execute('SELECT id FROM templates LIMIT 1').fetchone()
    with tempfile.TemporaryFile(dir=store.path.parent) as probe:
        probe.write(b'worldos-readiness'); probe.flush()
    return True
