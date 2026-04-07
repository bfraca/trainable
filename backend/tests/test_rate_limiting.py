"""Tests for per-IP rate limiting middleware.

Verifies that:
  - The limiter is attached and the 429 handler returns JSON.
  - Requests within the limit succeed normally.
  - Requests exceeding the limit receive 429 Too Many Requests.
  - The response body contains a descriptive "detail" message.
  - Different endpoints can have different rate limits.
"""

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from middleware.rate_limit import _rate_limit_exceeded_handler


def _build_app(default_limit: str = "3/minute") -> FastAPI:
    """Create a minimal FastAPI app with rate limiting for testing."""
    limiter = Limiter(
        key_func=get_remote_address,
        default_limits=[default_limit],
        storage_uri="memory://",
    )

    app = FastAPI()
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @app.get("/general")
    async def general(request: Request):
        return {"ok": True}

    @app.get("/strict")
    @limiter.limit("1/minute")
    async def strict(request: Request):
        return {"ok": True}

    @app.get("/health")
    async def health(request: Request):
        return {"status": "ok"}

    return app


@pytest.fixture
def app():
    return _build_app(default_limit="3/minute")


@pytest.mark.asyncio
async def test_requests_within_limit_succeed(app):
    """Requests within the rate limit should return 200."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        for _ in range(3):
            resp = await client.get("/general")
            assert resp.status_code == 200
            assert resp.json() == {"ok": True}


@pytest.mark.asyncio
async def test_requests_exceeding_limit_get_429(app):
    """The 4th request within the same minute should return 429."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Exhaust the 3/minute limit
        for _ in range(3):
            resp = await client.get("/general")
            assert resp.status_code == 200

        # Next request should be rate-limited
        resp = await client.get("/general")
        assert resp.status_code == 429


@pytest.mark.asyncio
async def test_429_response_is_json(app):
    """The 429 response should be JSON with a 'detail' key."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        for _ in range(3):
            await client.get("/general")
        resp = await client.get("/general")
        assert resp.status_code == 429
        body = resp.json()
        assert "detail" in body
        assert "Rate limit exceeded" in body["detail"]


@pytest.mark.asyncio
async def test_per_endpoint_limit_override():
    """An endpoint with @limiter.limit('1/minute') should be stricter."""
    app = _build_app(default_limit="100/minute")
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        # First request to /strict succeeds
        resp = await client.get("/strict")
        assert resp.status_code == 200

        # Second request should be rate-limited (1/minute)
        resp = await client.get("/strict")
        assert resp.status_code == 429

        # /general should still work (100/minute default)
        resp = await client.get("/general")
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_rate_limit_does_not_affect_undecorated_endpoints():
    """Endpoints without a per-endpoint decorator still use the default limit."""
    app = _build_app(default_limit="2/minute")
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp1 = await client.get("/general")
        resp2 = await client.get("/general")
        assert resp1.status_code == 200
        assert resp2.status_code == 200

        # Third request exceeds default limit
        resp3 = await client.get("/general")
        assert resp3.status_code == 429
