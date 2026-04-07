"""API-key authentication middleware.

When ``API_KEY`` is set in the environment (or .env), every request must
include a matching ``Authorization: Bearer <key>`` header.  Requests to
the health-check and OpenAPI docs endpoints are always allowed through.

If ``API_KEY`` is empty or unset the middleware is a no-op — the app
behaves exactly as before (open access).  This keeps the local-dev
experience frictionless while protecting deployed instances.
"""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from config import settings

logger = logging.getLogger(__name__)

# Paths that never require authentication
_PUBLIC_PATHS: set[str] = {
    "/api/health",
    "/docs",
    "/redoc",
    "/openapi.json",
}


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Reject requests that lack a valid API key (when one is configured)."""

    async def dispatch(self, request: Request, call_next):
        # Skip auth when no key is configured (local dev)
        if not settings.api_key:
            return await call_next(request)

        # Allow public endpoints unconditionally
        if request.url.path in _PUBLIC_PATHS:
            return await call_next(request)

        # Check Authorization header
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer ") :]
        else:
            token = ""

        if token != settings.api_key:
            logger.warning(
                "Rejected unauthenticated request: %s %s",
                request.method,
                request.url.path,
            )
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing API key"},
            )

        return await call_next(request)
