"""In-process SSE event broadcaster using asyncio.Queue."""

import asyncio
import json
import logging
from typing import AsyncGenerator

from config import settings

logger = logging.getLogger(__name__)


class Broadcaster:
    """Manages per-session event subscriptions for SSE streaming."""

    def __init__(self):
        self._subscribers: dict[str, list[asyncio.Queue]] = {}

    async def subscribe(self, session_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(
            maxsize=settings.broadcaster_max_queue_size
        )
        self._subscribers.setdefault(session_id, []).append(queue)
        return queue

    def unsubscribe(self, session_id: str, queue: asyncio.Queue):
        subs = self._subscribers.get(session_id, [])
        if queue in subs:
            subs.remove(queue)

    async def publish(self, session_id: str, event: dict):
        for queue in self._subscribers.get(session_id, []):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop oldest event to make room (backpressure)
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    pass

    async def stream(self, session_id: str) -> AsyncGenerator[dict, None]:
        queue = await self.subscribe(session_id)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=settings.sse_keepalive_seconds
                    )
                    yield {"data": json.dumps(event)}
                except asyncio.TimeoutError:
                    yield {"comment": "keepalive"}
        finally:
            self.unsubscribe(session_id, queue)


broadcaster = Broadcaster()
