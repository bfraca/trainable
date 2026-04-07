"""Tests for API-key authentication middleware."""

import pytest
from httpx import ASGITransport, AsyncClient

from main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def auth_client(monkeypatch):
    """Return an async-client factory that configures the API_KEY setting."""

    async def _make_client(api_key: str = ""):
        # Patch settings at module level so the middleware picks it up
        from config import settings

        monkeypatch.setattr(settings, "api_key", api_key)
        transport = ASGITransport(app=app)
        return AsyncClient(transport=transport, base_url="http://test")

    return _make_client


# --------------------------------------------------------------------------- #
# No API key configured → everything is open
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_no_key_configured_allows_all(auth_client):
    """When API_KEY is empty, all endpoints are accessible."""
    client = await auth_client("")
    resp = await client.get("/api/health")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_no_key_configured_allows_protected(auth_client):
    """When API_KEY is empty, even non-health endpoints are open."""
    client = await auth_client("")
    # experiments list may return 200 with empty list
    resp = await client.get("/api/experiments")
    assert resp.status_code == 200


# --------------------------------------------------------------------------- #
# API key configured → unauthenticated requests are rejected
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_missing_header_returns_401(auth_client):
    """Request without Authorization header → 401."""
    client = await auth_client("secret-key-123")
    resp = await client.get("/api/experiments")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or missing API key"


@pytest.mark.asyncio
async def test_wrong_key_returns_401(auth_client):
    """Request with wrong API key → 401."""
    client = await auth_client("secret-key-123")
    resp = await client.get(
        "/api/experiments",
        headers={"Authorization": "Bearer wrong-key"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_correct_key_allows_request(auth_client):
    """Request with correct API key → passes through."""
    client = await auth_client("secret-key-123")
    resp = await client.get(
        "/api/experiments",
        headers={"Authorization": "Bearer secret-key-123"},
    )
    assert resp.status_code == 200


# --------------------------------------------------------------------------- #
# Public endpoints bypass auth
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_health_bypasses_auth(auth_client):
    """Health endpoint is always accessible, even with API_KEY set."""
    client = await auth_client("secret-key-123")
    resp = await client.get("/api/health")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_docs_bypass_auth(auth_client):
    """OpenAPI docs endpoints bypass auth."""
    client = await auth_client("secret-key-123")
    resp = await client.get("/openapi.json")
    assert resp.status_code == 200
