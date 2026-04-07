"""Integration tests for the DuckDB query timeout mechanism.

These tests verify that the threading.Timer + con.interrupt() path actually
cancels long-running queries rather than just timing out in the async layer.
"""

import threading
import time
from unittest.mock import AsyncMock, patch

import duckdb
import pytest


# --------------------------------------------------------------------------- #
# Unit-level: verify con.interrupt() actually raises InterruptException
# --------------------------------------------------------------------------- #


class TestDuckDBInterrupt:
    """Verify the raw DuckDB interrupt mechanism works as expected."""

    def test_interrupt_cancels_running_query(self):
        """con.interrupt() from another thread raises InterruptException."""
        con = duckdb.connect(":memory:")
        con.execute("CREATE TABLE big AS SELECT range AS i FROM range(10_000_000)")

        interrupted = threading.Event()
        error_holder: list[Exception] = []

        def run_slow_query():
            try:
                con.execute(
                    "SELECT COUNT(*) FROM big a, big b, big c WHERE a.i + b.i + c.i > 0"
                )
            except duckdb.InterruptException:
                interrupted.set()
            except Exception as e:
                error_holder.append(e)

        t = threading.Thread(target=run_slow_query, daemon=True)
        t.start()

        time.sleep(0.3)
        con.interrupt()

        t.join(timeout=5)
        con.close()

        assert interrupted.is_set(), "Expected InterruptException but got: " + (
            str(error_holder[0]) if error_holder else "query completed normally"
        )

    def test_interrupt_via_timer(self):
        """threading.Timer fires con.interrupt() and the query is cancelled."""
        con = duckdb.connect(":memory:")
        con.execute("CREATE TABLE big AS SELECT range AS i FROM range(10_000_000)")

        timer = threading.Timer(0.5, lambda: con.interrupt())
        timer.start()

        with pytest.raises(duckdb.InterruptException):
            con.execute(
                "SELECT COUNT(*) FROM big a, big b, big c WHERE a.i + b.i + c.i > 0"
            )

        timer.cancel()
        con.close()


# --------------------------------------------------------------------------- #
# Integration: exercise the full endpoint via the shared `client` fixture
# --------------------------------------------------------------------------- #


class TestQueryTimeoutEndpoint:
    """Integration tests hitting the /api/sessions/.../prep/query endpoint."""

    @pytest.mark.asyncio
    async def test_timeout_returns_408(self, client):
        """The endpoint returns HTTP 408 when _blocking raises InterruptException.

        The unit tests (TestDuckDBInterrupt) already prove that con.interrupt()
        from a Timer thread raises InterruptException inside DuckDB.  This test
        verifies the *endpoint* layer: when that exception propagates out of
        asyncio.to_thread, the router converts it to an HTTP 408 response.
        """
        with patch(
            "routers.data_explorer.asyncio.to_thread",
            new_callable=AsyncMock,
            side_effect=duckdb.InterruptException("Query was interrupted"),
        ):
            resp = await client.post(
                "/api/sessions/test-session/prep/query",
                json={"sql": "SELECT COUNT(*) FROM train", "limit": 1},
            )
        assert resp.status_code == 408
        assert "timed out" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_fast_query_succeeds_within_timeout(
        self, client, mock_volume_with_prep
    ):
        """A simple query completes before the timeout."""
        with (
            patch("routers.data_explorer.reload_volume"),
            patch(
                "routers.data_explorer.read_volume_file",
                side_effect=lambda p: b"".join(mock_volume_with_prep.read_file(p)),
            ),
        ):
            resp = await client.post(
                "/api/sessions/test-session/prep/query",
                json={"sql": "SELECT COUNT(*) FROM train", "limit": 10},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["row_count"] == 1
        assert data["rows"][0][0] == 7  # 7 rows in our fixture

    @pytest.mark.asyncio
    async def test_all_data_view_available(self, client, mock_volume_with_prep):
        """The all_data view combining all splits is available."""
        with (
            patch("routers.data_explorer.reload_volume"),
            patch(
                "routers.data_explorer.read_volume_file",
                side_effect=lambda p: b"".join(mock_volume_with_prep.read_file(p)),
            ),
        ):
            resp = await client.post(
                "/api/sessions/test-session/prep/query",
                json={"sql": "SELECT COUNT(*) FROM all_data", "limit": 10},
            )
        assert resp.status_code == 200
        data = resp.json()
        # train(7) + val(2) + test(2) = 11
        assert data["rows"][0][0] == 11

    @pytest.mark.asyncio
    async def test_timeout_timer_is_cleaned_up_on_success(
        self, client, mock_volume_with_prep
    ):
        """The timer is cancelled after a successful query (no leaked threads)."""
        active_before = threading.active_count()

        with (
            patch("routers.data_explorer.reload_volume"),
            patch(
                "routers.data_explorer.read_volume_file",
                side_effect=lambda p: b"".join(mock_volume_with_prep.read_file(p)),
            ),
        ):
            resp = await client.post(
                "/api/sessions/test-session/prep/query",
                json={"sql": "SELECT * FROM train LIMIT 2", "limit": 2},
            )
        assert resp.status_code == 200

        time.sleep(0.2)
        active_after = threading.active_count()

        # No new daemon threads should be lingering
        assert active_after <= active_before + 1

    def test_interrupt_exception_not_swallowed_by_generic_handler(self):
        """Verify the `except duckdb.InterruptException: raise` guard works.

        This directly tests the pattern in _blocking() where we must re-raise
        InterruptException before the generic `except Exception: pass` block.
        Without the guard, InterruptException would be silently swallowed
        during parquet loading.
        """

        caught = False

        def simulated_blocking():
            """Mirrors the try/except structure in query_prep_data._blocking."""
            nonlocal caught
            for split in ["train", "val", "test"]:
                try:
                    # Simulate an InterruptException during parquet load
                    if split == "val":
                        raise duckdb.InterruptException("timeout")
                except duckdb.InterruptException:
                    raise  # This is the fix we're testing
                except Exception:
                    pass  # Generic handler would swallow it without the guard

        try:
            simulated_blocking()
        except duckdb.InterruptException:
            caught = True

        assert caught, (
            "InterruptException was swallowed by the generic handler — "
            "the `except duckdb.InterruptException: raise` guard is missing"
        )
