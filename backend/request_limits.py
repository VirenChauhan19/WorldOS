"""Bound request memory, upload time and authenticated inference load."""
import asyncio
import time
from collections import defaultdict, deque
from starlette.responses import JSONResponse


class RequestLimitsMiddleware:
    def __init__(self, app, max_bytes=32*1024*1024, production=False, clock=time.monotonic, ai_per_minute=20, max_concurrent_writes=2):
        if max_bytes < 1 or max_concurrent_writes < 1:
            raise ValueError('Request size and concurrency limits must be positive.')
        self.app, self.max_bytes, self.production, self.clock = app, max_bytes, production, clock
        self.ai_per_minute = ai_per_minute
        self.max_concurrent_writes = max_concurrent_writes
        self.events = defaultdict(deque)
        self.active_ai = 0
        self.active_writes = 0

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith('/api/'):
            return await self.app(scope, receive, send)
        path, method = scope['path'], scope['method']
        if method == 'OPTIONS':
            return await self.app(scope, receive, send)
        headers = {key.lower(): value for key, value in scope.get('headers', [])}
        limit = 8192 if path.startswith('/api/auth/') else self.max_bytes
        async def reject(status, message):
            await JSONResponse({'detail':message},status,headers={'Cache-Control':'no-store',**({'Retry-After':'60'} if status==429 else {})})(scope,receive,send)
        try:
            length = int(headers.get(b'content-length', b'0'))
            if length < 0: raise ValueError()
        except ValueError:
            return await reject(400,'Invalid request length.')
        if length > limit:
            return await reject(413,'Request is too large. Choose a smaller photo and retry.')
        ai = method == 'POST' and (path.startswith('/api/ai/') or path == '/api/inspect/scans' or path.endswith('/explain'))
        if self.production and not path.startswith('/api/auth/'):
            now = self.clock()
            state = scope.get('state',{})
            judge = state.get('access_role') == 'judge'
            key = ('shared-judge-demo' if judge else state.get('auth_fingerprint','local'), 'ai' if ai else 'api')
            # Prune inactive entries so this map cannot grow without bound.
            self.events = defaultdict(deque,{k:v for k,v in self.events.items() if v and v[-1] > now-60})
            events = self.events[key]
            while events and events[0] <= now-60: events.popleft()
            allowance = min(10,self.ai_per_minute) if judge and ai else self.ai_per_minute if ai else 120
            if len(events) >= allowance or (ai and self.active_ai >= 2):
                return await reject(429,'Too many requests. Wait a minute before retrying; no action was queued.')
            events.append(now)
        counted = self.production and method in {'POST','PUT','PATCH','DELETE'}
        if counted and self.active_writes >= self.max_concurrent_writes:
            return await reject(429,'Another upload or action is running. Wait a minute and retry; no action was queued.')
        if counted: self.active_writes += 1
        try:
            return await self.consume(scope,receive,send,limit,ai,reject)
        finally:
            if counted: self.active_writes -= 1

    async def consume(self, scope, receive, send, limit, ai, reject):
        # Consume at most the configured limit, including chunked transfers.
        chunks, size = [], 0
        deadline = self.clock()+30
        while True:
            try:
                message = await asyncio.wait_for(receive(), max(.01, deadline-self.clock()))
            except TimeoutError:
                return await reject(408,'Upload timed out. Reconnect and select the photo again.')
            if message['type'] == 'http.disconnect': return
            chunk = message.get('body',b''); size += len(chunk)
            if size > limit:
                return await reject(413,'Request is too large. Choose a smaller photo and retry.')
            chunks.append(chunk)
            if not message.get('more_body',False): break
        body = b''.join(chunks)
        delivered = False
        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type':'http.request','body':body,'more_body':False}
            return await receive()
        if ai: self.active_ai += 1
        try:
            return await self.app(scope,bounded_receive,send)
        finally:
            if ai: self.active_ai -= 1
