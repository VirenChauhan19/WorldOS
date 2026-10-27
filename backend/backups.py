"""Consistent SQLite snapshots include embedded photos, not authentication sessions."""
import asyncio
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from pathlib import Path
import sqlite3
import threading
from uuid import uuid4

log = logging.getLogger('worldos.backup')
_lock = threading.Lock()


def backup_database(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not source.is_file() or source == destination or destination.exists():
        raise ValueError('Require an existing database and a new, distinct backup path.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.name+'.partial-'+uuid4().hex)
    try:
        with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True,timeout=5)) as original, closing(sqlite3.connect(partial)) as snapshot:
            original.backup(snapshot)
            if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Database backup failed integrity validation.')
            if not snapshot.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='templates'").fetchone():
                raise ValueError('This is not a WorldOS workspace database.')
        partial.chmod(0o600)
        # Same-filesystem link publishes a complete snapshot atomically and
        # refuses an existing target on both Windows and Linux.
        os.link(partial,destination)
    finally:
        partial.unlink(missing_ok=True)
    return destination


def scheduled_backup(directory, retain=7):
    with _lock:
        return _scheduled_backup(directory,retain)


def _scheduled_backup(directory, retain):
    if not 1 <= retain <= 30: raise ValueError('Backup retention must be between 1 and 30 snapshots.')
    directory = Path(directory).resolve()
    source = directory/'worldos.sqlite3'
    if not source.exists(): return None
    folder = directory/'backups'; folder.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc)
    path = folder/f'worldos-{now:%Y%m%dT%H%M%S}-{uuid4().hex[:8]}.sqlite3'
    backup_database(source,path)
    with path.open('rb') as snapshot:
        digest = hashlib.file_digest(snapshot,'sha256').hexdigest()
    metadata = {'created_at':now.isoformat(), 'file':path.name, 'sha256':digest,
                'scope':'Workspace templates, embedded photographs, inspections, unfinished checks and evaluation trials; excludes login sessions and credentials.'}
    status = folder/'.status.tmp'
    status.write_text(json.dumps(metadata),encoding='utf-8')
    os.replace(status,folder/'latest.json')
    copies = sorted(folder.glob('worldos-*.sqlite3'),key=lambda p:(p==path,p.stat().st_mtime_ns,p.name),reverse=True)
    for old in copies[retain:]:
        if old.resolve().parent == folder and not old.is_symlink(): old.unlink()
    return metadata


async def backup_loop(directory, interval_seconds=86400):
    while True:
        try:
            await asyncio.to_thread(scheduled_backup,directory)
        except Exception:
            # No file contents, environment, secrets, or exception payload in logs.
            log.error('Scheduled workspace backup failed. Check disk capacity and permissions.')
        await asyncio.sleep(interval_seconds)
