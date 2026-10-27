"""Owner and optional expiring demo access. Model credentials never enter sessions."""
import base64
import hashlib
import hmac
import ipaddress
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse
from .session_store import SessionStore, fingerprint


def password_hash(password: str):
    if not 14 <= len(password) <= 1024:
        raise ValueError("Use a unique passphrase with 14 to 1024 characters.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    return "pbkdf2_sha256$600000$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def parse_hash(encoded):
    try:
        algorithm, rounds, salt, digest = encoded.split("$")
        rounds = int(rounds)
        salt, digest = base64.b64decode(salt, validate=True), base64.b64decode(digest, validate=True)
        if algorithm != "pbkdf2_sha256" or not 600_000 <= rounds <= 1_000_000 or len(salt) != 16 or len(digest) != 32:
            raise ValueError()
        return rounds, salt, digest
    except (ValueError, TypeError):
        raise ValueError("Invalid WORLDOS_AUTH_PASSWORD_HASH. Generate it using scripts/create_login.py.") from None


@dataclass(frozen=True)
class SecuritySettings:
    deployment: str = "local"
    encoded_password: str = field(default="", repr=False)
    origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    hosts: tuple[str, ...] = ("localhost", "127.0.0.1", "[::1]", "testserver")
    judge_password: str = field(default="", repr=False)
    judge_expires_at: str = ""

    @classmethod
    def from_env(cls):
        setting = cls(os.getenv("WORLDOS_DEPLOYMENT", "local"), os.getenv("WORLDOS_AUTH_PASSWORD_HASH", ""),
                      tuple(v.strip() for v in os.getenv("WORLDOS_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if v.strip()),
                      tuple(v.strip() for v in os.getenv("WORLDOS_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1],testserver").split(",") if v.strip()),
                      os.getenv('WORLDOS_JUDGE_PASSWORD_HASH',''), os.getenv('WORLDOS_JUDGE_ACCESS_EXPIRES_AT',''))
        setting.validate()
        return setting

    def validate(self):
        if self.deployment not in {"local", "public"}:
            raise ValueError("WORLDOS_DEPLOYMENT must be local or public.")
        if self.encoded_password:
            parse_hash(self.encoded_password)
        if self.judge_password:
            if not self.encoded_password:
                raise ValueError('Judge access requires an owner login.')
            try:
                parse_hash(self.judge_password)
            except ValueError:
                raise ValueError('Invalid WORLDOS_JUDGE_PASSWORD_HASH.') from None
            self.judge_deadline()
        if self.deployment == "public":
            if not self.encoded_password:
                raise ValueError("Public deployment requires WORLDOS_AUTH_PASSWORD_HASH.")
            if not self.hosts or any("*" in h or "/" in h for h in self.hosts):
                raise ValueError("Public deployment requires exact WORLDOS_ALLOWED_HOSTS.")
            if not self.origins:
                raise ValueError("Public deployment requires explicit WORLDOS_CORS_ORIGINS.")
            for origin in self.origins:
                url = urlparse(origin)
                if origin not in {"capacitor://localhost", "https://localhost"} and (url.scheme != "https" or not url.hostname or url.username or url.password or url.path or url.query or url.fragment or "*" in origin):
                    raise ValueError("Public CORS origins must be exact HTTPS origins or the Capacitor app origin.")

    def judge_deadline(self):
        try:
            deadline = datetime.fromisoformat(self.judge_expires_at.replace('Z','+00:00'))
            if deadline.tzinfo is None:
                raise ValueError()
            return deadline.timestamp()
        except (ValueError, TypeError, OverflowError):
            raise ValueError('WORLDOS_JUDGE_ACCESS_EXPIRES_AT must be an ISO timestamp with timezone.') from None


class SessionAuth:
    def __init__(self, settings, clock=time.time, session_path=None):
        self.settings, self.clock = settings, clock
        self.store, self.attempts = SessionStore(session_path), {}
        self.credential_id = fingerprint(settings.encoded_password)
        self.lock = threading.Lock()

    @property
    def cookie_name(self):
        return '__Host-worldos_session' if self.settings.deployment == 'public' else 'worldos_session_local'

    def token(self, request):
        authorization = request.headers.get('authorization')
        if authorization is not None:
            return authorization[7:] if authorization.startswith('Bearer ') and len(authorization) <= 256 else ''
        token = request.cookies.get(self.cookie_name, '')
        return token if len(token) <= 256 else ''

    def cookie_session(self, request):
        return not request.headers.get('authorization') and bool(request.cookies.get(self.cookie_name))

    @staticmethod
    def csrf_token(token):
        return hmac.new(token.encode(), b'WorldOS-CSRF-v1', hashlib.sha256).hexdigest()

    def same_origin(self, request):
        return request.headers.get('origin') == f'{request.url.scheme}://{request.url.netloc}'

    @property
    def required(self):
        return bool(self.settings.encoded_password)

    def authorized(self, request):
        return self.access_role(request) is not None

    @property
    def judge_enabled(self):
        return bool(self.settings.judge_password) and self.clock() < self.settings.judge_deadline()

    def access_role(self, request):
        token = self.token(request)
        credentials = {'owner': self.credential_id}
        if self.judge_enabled:
            credentials['judge'] = fingerprint(self.settings.judge_password)
        return self.store.identity(token, credentials, self.clock()) if token else None

    def login(self, password, address, access='owner'):
        now = self.clock()
        with self.lock:
            self.attempts = {key: [at for at in events if at > now-900] for key, events in self.attempts.items() if events[-1] > now-900}
            events = [at for at in self.attempts.get(address, []) if at > now-900]
            if len(events) >= 5 or sum(len(v) for v in self.attempts.values()) >= 100:
                raise HTTPException(429, "Too many sign-in attempts. Wait 15 minutes and retry.", headers={"Retry-After": "900"})
            self.attempts[address] = [*events, now]
        if access == 'judge' and not self.judge_enabled:
            raise HTTPException(401, 'Judge access is unavailable or has expired. Ask the owner to enable it.')
        encoded = self.settings.judge_password if access == 'judge' else self.settings.encoded_password
        rounds, salt, expected = parse_hash(encoded)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, rounds)
        if not hmac.compare_digest(actual, expected):
            raise HTTPException(401, "Incorrect passphrase.")
        if access == 'judge':
            owner_rounds, owner_salt, owner_digest = parse_hash(self.settings.encoded_password)
            if hmac.compare_digest(hashlib.pbkdf2_hmac('sha256',password.encode(),owner_salt,owner_rounds),owner_digest):
                raise HTTPException(409, 'Judge and owner passphrases must be different. Ask the owner to change the judge passphrase.')
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.attempts.pop(address, None)
        duration = min(2*60*60, int(self.settings.judge_deadline()-now)) if access == 'judge' else 8*60*60
        if duration <= 0:
            raise HTTPException(401, 'Judge access has expired.')
        if not self.store.create(token, now+duration, fingerprint(encoded), now, access):
            raise HTTPException(429, "Too many active sessions. Sign out another device or retry later.")
        return {"access_token": token, "token_type": "bearer", "expires_in": duration, 'access':access}

    async def middleware(self, request, call_next):
        api = request.url.path.startswith(("/api/", "/app/", "/inspect/")) or request.url.path in {"/app", "/inspect", "/docs", "/redoc", "/openapi.json"}
        if api and request.method != "OPTIONS":
            address = request.client.host if request.client else ""
            try:
                local = ipaddress.ip_address(address).is_loopback
            except ValueError:
                local = address == "testclient"  # ASGI test transport; cannot be a TCP client address.
            if (self.settings.deployment == "public" or not local) and request.url.scheme != "https":
                return JSONResponse({"detail": "HTTPS is required for deployed API access."}, 403, headers={"Cache-Control": "no-store"})
            if not self.required:
                if not local:
                    return JSONResponse({"detail": "Remote access requires an authenticated HTTPS deployment."}, 403, headers={"Cache-Control": "no-store"})
            exempt = request.url.path in {"/api/auth/status", "/api/auth/login"}
            role = self.access_role(request) if self.required else 'owner'
            request.state.access_role = role
            if self.required and not exempt and not role:
                return JSONResponse({"detail": "Sign in to WorldOS to continue."}, 401, headers={"Cache-Control": "no-store", "WWW-Authenticate": "Bearer"})
            if self.required and not exempt:
                judge_routes = {'/api/auth/logout','/api/health','/api/analyze','/api/plan','/api/verify','/api/replan',
                                '/api/ai/diagnostics','/api/ai/analyze','/api/ai/reason','/api/ai/verify','/api/verify/reviewed','/app','/inspect'}
                if role == 'judge' and request.url.path not in judge_routes and not request.url.path.startswith(('/api/inspect/','/app/','/inspect/')):
                    return JSONResponse({'detail':'This action requires owner access.'},403,headers={'Cache-Control':'no-store'})
                request.state.auth_fingerprint = fingerprint(self.token(request))
                if self.cookie_session(request) and request.method not in {'GET','HEAD'}:
                    expected = self.csrf_token(self.token(request))
                    if not self.same_origin(request) or not hmac.compare_digest(request.headers.get('x-csrf-token',''), expected):
                        return JSONResponse({'detail':'Refresh your session before retrying this action.'},403,headers={'Cache-Control':'no-store'})
        response = await call_next(request)
        if api:
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        if request.url.path in {'/', '/sw.js', '/manifest.webmanifest', '/healthz'}:
            response.headers['Cache-Control'] = 'no-store' if request.url.path in {'/','/healthz'} else 'no-cache'
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if self.settings.deployment == "public":
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
            response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
            response.headers['Permissions-Policy'] = 'camera=(self), microphone=(), geolocation=()'
        return response

    def router(self):
        router = APIRouter(prefix="/api/auth", tags=["Session access"])

        @router.get("/status")
        def status(request: Request):
            role = self.access_role(request) if self.required else 'owner'
            authorized = bool(role) if self.required else False
            cookie = authorized and self.cookie_session(request)
            return {"required": self.required, "authenticated": not self.required or authorized, "deployment": self.settings.deployment,
                    'access':role, 'judge_enabled':self.judge_enabled,
                    'judge_expires_at':self.settings.judge_expires_at if role == 'judge' else None,
                    'session_mode': 'cookie' if cookie else 'bearer', 'csrf_token': self.csrf_token(self.token(request)) if cookie else None}

        @router.post("/login")
        def login(body: Login, request: Request, response: Response):
            if not self.required:
                raise HTTPException(409, "Sign-in is not configured for local-only access.")
            if body.mode == 'cookie' and not self.same_origin(request):
                raise HTTPException(403, 'Browser sign-in must originate from this WorldOS website.')
            result = self.login(body.password, request.client.host if request.client else "unknown", body.access)
            if body.mode == 'cookie':
                token = result['access_token']
                response.set_cookie(self.cookie_name, token, max_age=result['expires_in'], httponly=True,
                                    secure=self.settings.deployment=='public', samesite='strict', path='/')
                return {'authenticated':True, 'session_mode':'cookie', 'csrf_token':self.csrf_token(token), 'expires_in':result['expires_in'],
                        'access':result['access'], 'judge_expires_at':self.settings.judge_expires_at if result['access']=='judge' else None}
            return {**result, 'session_mode':'bearer', 'judge_expires_at':self.settings.judge_expires_at if result['access']=='judge' else None}

        @router.post("/logout")
        def logout(request: Request, response: Response):
            self.store.revoke(self.token(request))
            response.delete_cookie(self.cookie_name, secure=self.settings.deployment=='public', httponly=True, samesite='strict', path='/')
            return {"signed_out": True}

        return router


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=1024, repr=False)
    mode: Literal['cookie', 'bearer'] = 'bearer'
    access: Literal['owner', 'judge'] = 'owner'
