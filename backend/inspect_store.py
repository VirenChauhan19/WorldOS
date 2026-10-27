"""Local SQLite storage with transactional migrations and optimistic revisions."""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class StoreConflict(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


class InspectionStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version > 4:
                raise StoreConflict("This Inspect database requires a newer WorldOS version.")
            if version < 1:
                db.execute("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
                db.execute("PRAGMA user_version = 1")
            if version < 2:
                db.execute("CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE, revision INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)")
                db.execute("CREATE INDEX IF NOT EXISTS inspections_template ON inspections(template_id, created_at)")
                db.execute("PRAGMA user_version = 2")
            if version < 3:
                db.execute("CREATE TABLE IF NOT EXISTS evaluation_trials (id TEXT PRIMARY KEY, template_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS evaluation_captures (id TEXT PRIMARY KEY, trial_id TEXT NOT NULL REFERENCES evaluation_trials(id), stage TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(trial_id, stage))")
                db.execute("PRAGMA user_version = 3")
            if version < 4:
                db.execute("CREATE TABLE IF NOT EXISTS wizard_drafts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)")
                db.execute("PRAGMA user_version = 4")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def templates(self):
        with self.connect() as db:
            rows = db.execute("SELECT id, revision, name, created_at, updated_at FROM templates ORDER BY updated_at DESC, id").fetchall()
        return [dict(zip(("id", "revision", "name", "created_at", "updated_at"), row)) for row in rows]

    def template(self, identity):
        with self.connect() as db:
            row = db.execute("SELECT data FROM templates WHERE id = ?", (identity,)).fetchone()
        if not row:
            raise KeyError("Workspace template not found.")
        return json.loads(row[0])

    def save_template(self, data, identity=None, revision=None):
        timestamp = now()
        if identity is None:
            identity = uuid4().hex
            result = {**data, "id": identity, "revision": 1, "created_at": timestamp, "updated_at": timestamp}
            with self.connect() as db:
                db.execute("INSERT INTO templates VALUES (?, ?, ?, ?, ?, ?)", (identity, 1, result["name"], json.dumps(result), timestamp, timestamp))
        else:
            old = self.template(identity)
            result = {**data, "id": identity, "revision": old["revision"]+1, "created_at": old["created_at"], "updated_at": timestamp}
            with self.connect() as db:
                changed = db.execute("UPDATE templates SET revision=?, name=?, data=?, updated_at=? WHERE id=? AND revision=?", (result["revision"], result["name"], json.dumps(result), timestamp, identity, revision)).rowcount
                if changed != 1:
                    raise StoreConflict("This template changed. Reload it before saving your edits.")
        return result

    def delete_template(self, identity):
        with self.connect() as db:
            if db.execute("SELECT 1 FROM evaluation_trials WHERE template_id=? LIMIT 1", (identity,)).fetchone():
                raise StoreConflict("This reference is used by saved evaluation trials. Keep it to preserve their evidence; create a new template instead.")
            if db.execute("DELETE FROM templates WHERE id=?", (identity,)).rowcount != 1:
                raise KeyError("Workspace template not found.")

    def save_inspection(self, data):
        result = {**data, "id": uuid4().hex, "revision": 1, "created_at": now()}
        with self.connect() as db:
            db.execute("INSERT INTO inspections VALUES (?, ?, ?, ?, ?)", (result["id"], result["template_id"], 1, json.dumps(result), result["created_at"]))
        return result

    def inspection(self, identity):
        with self.connect() as db:
            row = db.execute("SELECT data FROM inspections WHERE id=?", (identity,)).fetchone()
        if not row:
            raise KeyError("Inspection not found.")
        return json.loads(row[0])

    def update_inspection(self, identity, changes, revision):
        current = self.inspection(identity)
        result = {**current, **changes, "revision": current["revision"]+1}
        if "review" in changes:
            result["review_history"] = current.get("review_history", []) + [{"at": now(), "review": changes["review"], "result": changes["reviewed_result"]}]
        with self.connect() as db:
            if db.execute("UPDATE inspections SET data=?, revision=? WHERE id=? AND revision=?", (json.dumps(result), result["revision"], identity, revision)).rowcount != 1:
                raise StoreConflict("This inspection changed. Reload it before applying another review.")
            capture_id = result.get("evaluation_capture_id")
            if capture_id:
                row = db.execute("SELECT data FROM evaluation_captures WHERE id=?", (capture_id,)).fetchone()
                capture = json.loads(row[0])
                capture.update(record=result, revision=capture["revision"]+1)
                db.execute("UPDATE evaluation_captures SET data=?, revision=? WHERE id=?", (json.dumps(capture), capture["revision"], capture_id))
        return result

    def history(self, template_id):
        with self.connect() as db:
            rows = db.execute("SELECT id, revision, created_at FROM inspections WHERE template_id=? ORDER BY created_at DESC LIMIT 50", (template_id,)).fetchall()
        return [dict(zip(("id", "revision", "created_at"), row)) for row in rows]


def get_inspection_store(*, demo=False):
    directory = Path(os.getenv("WORLDOS_DATA_DIR", str(Path(__file__).resolve().parents[1] / "data")))
    if demo:
        directory = directory / 'judge-demo'
    return InspectionStore(directory / "worldos.sqlite3")
