"""Tests for the request logging middleware and structured logging configuration."""

import json
import logging

import pytest
from httpx import ASGITransport, AsyncClient

from logging_config import JSONFormatter, setup_logging


# --------------------------------------------------------------------------- #
# JSONFormatter tests
# --------------------------------------------------------------------------- #


class TestJSONFormatter:
    """Test the structured JSON log formatter."""

    def test_basic_format(self):
        formatter = JSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="hello %s",
            args=("world",),
            exc_info=None,
        )
        output = formatter.format(record)
        data = json.loads(output)

        assert data["level"] == "INFO"
        assert data["logger"] == "test"
        assert data["message"] == "hello world"
        assert "timestamp" in data

    def test_exception_included(self):
        formatter = JSONFormatter()
        try:
            raise ValueError("boom")
        except ValueError:
            record = logging.LogRecord(
                name="test",
                level=logging.ERROR,
                pathname="test.py",
                lineno=1,
                msg="failed",
                args=(),
                exc_info=True,
            )
            # exc_info=True causes LogRecord to capture current exception
            import sys

            record.exc_info = sys.exc_info()

        output = formatter.format(record)
        data = json.loads(output)

        assert "exception" in data
        assert "ValueError" in data["exception"]
        assert "boom" in data["exception"]

    def test_extra_fields_forwarded(self):
        formatter = JSONFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="request",
            args=(),
            exc_info=None,
        )
        record.request_id = "abc-123"
        record.method = "GET"
        record.path = "/api/health"
        record.status = 200
        record.duration_ms = 12.5

        output = formatter.format(record)
        data = json.loads(output)

        assert data["request_id"] == "abc-123"
        assert data["method"] == "GET"
        assert data["path"] == "/api/health"
        assert data["status"] == 200
        assert data["duration_ms"] == 12.5


# --------------------------------------------------------------------------- #
# setup_logging tests
# --------------------------------------------------------------------------- #


class TestSetupLogging:
    """Test the logging configuration function."""

    def test_text_format(self):
        setup_logging(level="DEBUG", fmt="text")
        root = logging.getLogger()
        assert root.level == logging.DEBUG
        assert len(root.handlers) == 1
        assert not isinstance(root.handlers[0].formatter, JSONFormatter)

    def test_json_format(self):
        setup_logging(level="WARNING", fmt="json")
        root = logging.getLogger()
        assert root.level == logging.WARNING
        assert len(root.handlers) == 1
        assert isinstance(root.handlers[0].formatter, JSONFormatter)

    def test_replaces_existing_handlers(self):
        root = logging.getLogger()
        root.addHandler(logging.StreamHandler())
        root.addHandler(logging.StreamHandler())
        assert len(root.handlers) >= 2

        setup_logging(level="INFO", fmt="text")
        assert len(root.handlers) == 1


# --------------------------------------------------------------------------- #
# RequestLoggingMiddleware integration tests
# --------------------------------------------------------------------------- #


@pytest.fixture()
def _app():
    """Create a minimal FastAPI app with the request logging middleware."""
    from fastapi import FastAPI

    from middleware.request_logging import RequestLoggingMiddleware

    test_app = FastAPI()
    test_app.add_middleware(RequestLoggingMiddleware)

    @test_app.get("/test")
    async def test_endpoint():
        return {"ok": True}

    @test_app.get("/error")
    async def error_endpoint():
        raise ValueError("test error")

    return test_app


@pytest.mark.asyncio
async def test_adds_request_id_header(_app):
    """The middleware should add an X-Request-ID header to responses."""
    async with AsyncClient(
        transport=ASGITransport(app=_app), base_url="http://test"
    ) as client:
        response = await client.get("/test")

    assert response.status_code == 200
    assert "X-Request-ID" in response.headers
    # Should be a valid UUID-like string
    assert len(response.headers["X-Request-ID"]) > 0


@pytest.mark.asyncio
async def test_preserves_client_request_id(_app):
    """When the client sends X-Request-ID, the middleware should preserve it."""
    async with AsyncClient(
        transport=ASGITransport(app=_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/test", headers={"X-Request-ID": "my-custom-id-123"}
        )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "my-custom-id-123"


@pytest.mark.asyncio
async def test_logs_request(caplog, _app):
    """The middleware should log method, path, status, and duration."""
    with caplog.at_level(logging.INFO, logger="trainable.requests"):
        async with AsyncClient(
            transport=ASGITransport(app=_app), base_url="http://test"
        ) as client:
            await client.get("/test")

    assert any("method=GET" in r.message for r in caplog.records)
    assert any("path=/test" in r.message for r in caplog.records)
    assert any("status=200" in r.message for r in caplog.records)
    assert any("duration_ms=" in r.message for r in caplog.records)
