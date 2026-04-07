"""Request logging middleware with correlation IDs.

Adds a unique ``X-Request-ID`` header to every response so that log entries
can be correlated across the request lifecycle.  Logs method, path, status
code, and duration for every HTTP request at INFO level.
"""

import logging
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("trainable.requests")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log every request with timing and a correlation ID."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        # Attach the request ID so downstream code can include it in logs.
        request.state.request_id = request_id

        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000

        response.headers["X-Request-ID"] = request_id

        logger.info(
            "method=%s path=%s status=%d duration_ms=%.1f request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id,
        )

        return response
