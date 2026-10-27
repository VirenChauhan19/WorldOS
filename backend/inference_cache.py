"""Process-local validated-result cache. Never persist photos, keys, or failures."""
import asyncio
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from time import monotonic

from .providers import ProviderError


class InferenceCache:
    def __init__(self, ttl=120, capacity=16, max_pending=8, clock=monotonic):
        self.ttl, self.capacity, self.max_pending, self.clock = ttl, capacity, max_pending, clock
        self.results = OrderedDict()
        self.pending = {}

    async def get(self, payload, operation):
        key = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        now = self.clock()
        for expired in [k for k, (at, _) in self.results.items() if now - at >= self.ttl]:
            del self.results[expired]
        if key in self.results:
            at, value = self.results[key]
            self.results.move_to_end(key)
            return {**deepcopy(value), "inference_cache": {"status": "hit", "age_ms": round((now-at)*1000)}}
        shared = key in self.pending
        if not shared:
            if len(self.pending) >= self.max_pending:
                raise ProviderError("AI engine is busy. Wait for the current scan before retrying.", 429, "busy")

            async def run():
                # Bound shared work independently of any individual HTTP caller.
                async with asyncio.timeout(120):
                    value = await operation()
                value = {**value, "inferred_at": datetime.now(timezone.utc).isoformat()}
                self.results[key] = (self.clock(), deepcopy(value))
                while len(self.results) > self.capacity:
                    self.results.popitem(last=False)
                return value

            self.pending[key] = {"task": asyncio.create_task(run()), "waiters": 0}
        entry = self.pending[key]
        entry["waiters"] += 1
        try:
            value = await asyncio.shield(entry["task"])
            return {**deepcopy(value), "inference_cache": {"status": "shared" if shared else "miss", "age_ms": 0}}
        finally:
            entry["waiters"] -= 1
            if entry["waiters"] == 0:
                # Remove before awaiting cleanup: a retry must not join a failed
                # task or have its newer pending entry removed by this waiter.
                if self.pending.get(key) is entry:
                    self.pending.pop(key)
                # Don't leave billable work running when all consumers time out/disconnect.
                if not entry["task"].done():
                    entry["task"].cancel()
                await asyncio.gather(entry["task"], return_exceptions=True)
