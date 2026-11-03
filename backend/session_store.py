"""Opaque session fingerprints only; no passphrases, provider keys, or raw tokens."""
import hashlib
import sqlite3
import threading
from pathlib import Path


def fingerprint(token):
    return hashlib.sha256(token.encode()).hexdigest()


class SessionStore:
    def __init__(self, path=None):
        if path:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.db = sqlite3.connect(str(path) if path else ':memory:', timeout=5, check_same_thread=False)
        with self.db:
            version = self.db.execute('PRAGMA user_version').fetchone()[0]
            if version > 2:
                raise ValueError('Session database requires a newer WorldOS version.')
            self.db.execute('CREATE TABLE IF NOT EXISTS sessions (fingerprint TEXT PRIMARY KEY, expires REAL NOT NULL, credential_id TEXT NOT NULL)')
            if version < 2:
                self.db.execute("ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'owner'")
            self.db.execute('PRAGMA user_version = 2')
            self.db.execute('CREATE TABLE IF NOT EXISTS demo_usage (key TEXT PRIMARY KEY, used INTEGER NOT NULL, expires REAL NOT NULL)')
        if path:
            Path(path).chmod(0o600)

    def create(self, token, expires, credential_id, now, role='owner'):
        with self.lock, self.db:
            self.db.execute('DELETE FROM sessions WHERE expires <= ? OR (role = ? AND credential_id != ?)', (now, role, credential_id))
            if self.db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] >= 256:
                return False
            if role == 'guest' and self.db.execute("SELECT COUNT(*) FROM sessions WHERE role='guest'").fetchone()[0] >= 32:
                return False
            self.db.execute('INSERT INTO sessions VALUES (?,?,?,?)', (fingerprint(token), expires, credential_id, role))
            return True

    def reserve_demo(self, limits, now):
        """Atomically reserve all limits, shared across sessions and server restarts."""
        with self.lock, self.db:
            self.db.execute('BEGIN IMMEDIATE')
            self.db.execute('DELETE FROM demo_usage WHERE expires<=?', (now,))
            for key, allowance, _expires in limits:
                row = self.db.execute('SELECT used FROM demo_usage WHERE key=?', (key,)).fetchone()
                if row and row[0] >= allowance:
                    return False
            for key, _allowance, expires in limits:
                self.db.execute('INSERT INTO demo_usage VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET used=used+1', (key, expires))
            return True

    def valid(self, token, credential_id, now):
        return self.identity(token, { 'owner': credential_id }, now) == 'owner'

    def identity(self, token, credentials, now):
        with self.lock:
            row = self.db.execute('SELECT role, credential_id FROM sessions WHERE fingerprint=? AND expires>?', (fingerprint(token), now)).fetchone()
            return row[0] if row and credentials.get(row[0]) == row[1] else None

    def revoke(self, token):
        with self.lock, self.db:
            self.db.execute('DELETE FROM sessions WHERE fingerprint=?', (fingerprint(token),))

    def check(self):
        with self.lock:
            self.db.execute('SELECT COUNT(*) FROM sessions').fetchone()

    def close(self):
        with self.lock:
            self.db.close()
