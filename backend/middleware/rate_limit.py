"""Per-IP rate limiting using slowapi.

Default limits (configurable via environment variables):
  - General API:    60 requests / minute  (RATE_LIMIT_DEFAULT)
  - Agent start:     5 requests / minute  (RATE_LIMIT_AGENT_START)
  - File upload:    10 requests / minute  (RATE_LIMIT_UPLOAD)

When a client exceeds the limit they receive ``429 Too Many Requests``
with a JSON body: ``{"detail": "Rate limit exceeded: ..."}``.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from config import settings

logger = logging.getLogger(__name__)

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[settings.rate_limit_default],
    storage_uri="memory://",
)


def _rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """Return JSON 429 instead of the default HTML response."""
    logger.warning(
        "Rate limit exceeded: %s %s from %s",
        request.method,
        request.url.path,
        get_remote_address(request),
    )
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}"},
    )


def setup_rate_limiting(app: FastAPI) -> None:
    """Attach the limiter, middleware, and exception handler to the FastAPI app."""
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
