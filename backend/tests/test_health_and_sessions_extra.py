"""Additional tests for main.py health endpoint and session router edge cases."""

from unittest.mock import AsyncMock, patch

import pytest

# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# _infer_stage helper
# ---------------------------------------------------------------------------


class TestInferStage:
    def test_created_state(self):
        from routers.sessions import _infer_stage

        assert _infer_stage("created") == "eda"

    def test_eda_running(self):
        from routers.sessions import _infer_stage

        assert _infer_stage("eda_running") == "eda"

    def test_eda_done(self):
        from routers.sessions import _infer_stage

        assert _infer_stage("eda_done") == "eda"

    def test_prep_running(self):
        from routers.sessions import _infer_stage

        assert _infer_stage("prep_running") == "prep"

    def test_prep_done(self):
        from routers.sessions import _infer_stage

        assert _infer_stage("prep_done") == "prep"

    def test_train_running(self):
        from routers.sessions import _infer_stage

        assert _infer_stage("train_running") == "train"

    def test_train_done(self):
        from routers.sessions import _infer_stage

        assert _infer_stage("train_done") == "train"

    def test_failed_defaults_to_eda(self):
        from routers.sessions import _infer_stage

        assert _infer_stage("failed") == "eda"

    def test_cancelled_defaults_to_eda(self):
        from routers.sessions import _infer_stage

        assert _infer_stage("cancelled") == "eda"


# ---------------------------------------------------------------------------
# Session creation with invalid experiment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_session_invalid_experiment(client):
    resp = await client.post("/api/experiments/nonexistent/sessions")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Abort session
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_abort_session_not_found(client):
    resp = await client.post("/api/sessions/nonexistent/abort")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_abort_session_not_running(client, sample_csv):
    """Abort when no agent is running returns not_running."""

    async def _create_experiment(c, csv):
        with open(csv, "rb") as f:
            resp = await c.post(
                "/api/experiments",
                data={"name": "Test", "description": "", "instructions": ""},
                files={"files": ("data.csv", f, "text/csv")},
            )
        return resp.json()["id"], resp.json()["session_id"]

    _, session_id = await _create_experiment(client, sample_csv)
    resp = await client.post(f"/api/sessions/{session_id}/abort")
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_running"


# ---------------------------------------------------------------------------
# Stage prerequisites
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_start_prep_without_eda_done(client, sample_csv):
    """Prep requires eda_done; starting prep from 'created' should fail."""

    async def _create(c, csv):
        with open(csv, "rb") as f:
            resp = await c.post(
                "/api/experiments",
                data={"name": "Test", "description": "", "instructions": ""},
                files={"files": ("data.csv", f, "text/csv")},
            )
        return resp.json()["session_id"]

    session_id = await _create(client, sample_csv)
    resp = await client.post(
        f"/api/sessions/{session_id}/stages/prep/start",
        json={},
    )
    assert resp.status_code == 400
    assert "eda_done" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_start_train_without_prep_done(client, sample_csv):
    """Train requires prep_done; starting from 'created' should fail."""

    async def _create(c, csv):
        with open(csv, "rb") as f:
            resp = await c.post(
                "/api/experiments",
                data={"name": "Test", "description": "", "instructions": ""},
                files={"files": ("data.csv", f, "text/csv")},
            )
        return resp.json()["session_id"]

    session_id = await _create(client, sample_csv)
    resp = await client.post(
        f"/api/sessions/{session_id}/stages/train/start",
        json={},
    )
    assert resp.status_code == 400
    assert "prep_done" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Send message to nonexistent session
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_message_session_not_found(client):
    resp = await client.post(
        "/api/sessions/nonexistent/messages",
        json={"content": "Hello"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Get metrics with filters
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_metrics_with_stage_filter(client, sample_csv):
    """Metrics endpoint supports stage and name query params."""

    async def _create(c, csv):
        with open(csv, "rb") as f:
            resp = await c.post(
                "/api/experiments",
                data={"name": "Test", "description": "", "instructions": ""},
                files={"files": ("data.csv", f, "text/csv")},
            )
        return resp.json()["session_id"]

    session_id = await _create(client, sample_csv)
    # Empty metrics with filters should still return 200
    resp = await client.get(
        f"/api/sessions/{session_id}/metrics",
        params={"stage": "train", "name": "loss"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# Start EDA from non-standard allowed states
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_start_eda_not_allowed_from_eda_done(client, sample_csv):
    """EDA can only start from created/failed/cancelled, not eda_done."""

    async def _create(c, csv):
        with open(csv, "rb") as f:
            resp = await c.post(
                "/api/experiments",
                data={"name": "Test", "description": "", "instructions": ""},
                files={"files": ("data.csv", f, "text/csv")},
            )
        return resp.json()["session_id"]

    session_id = await _create(client, sample_csv)

    # Manually set state to eda_done by running+completing eda
    with patch(
        "routers.sessions.run_agent", new_callable=AsyncMock, return_value="done"
    ):
        resp = await client.post(
            f"/api/sessions/{session_id}/stages/eda/start", json={}
        )
        assert resp.status_code == 200

    # Wait a bit for the background task to update state
    import asyncio

    await asyncio.sleep(0.2)

    # Now EDA should be blocked from eda_done state
    # (need to clear the running task first)
    from services.agent.tasks import _running_tasks

    _running_tasks.pop(session_id, None)

    resp = await client.post(f"/api/sessions/{session_id}/stages/eda/start", json={})
    # State is now eda_running or eda_done — either way, not in ALLOWED_EDA
    assert resp.status_code in (400, 409)
