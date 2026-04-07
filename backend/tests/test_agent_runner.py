"""Integration tests for services/agent/runner.py — run_agent orchestration.

These tests mock the Claude Agent SDK to verify that run_agent correctly:
- Publishes SSE events in the right order with correct data shapes
- Persists messages to the database
- Handles timeouts, cancellations, and general errors
- Loads conversation history for follow-up prompts
- Reads previous stage reports for context injection
- Cleans up session state in the finally block
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from claude_agent_sdk import AssistantMessage, ResultMessage

from services.agent.runner import _load_conversation_history, run_agent


# ---------------------------------------------------------------------------
# Helpers — fake SDK message types and async iterators
# ---------------------------------------------------------------------------


def _make_assistant_message(*texts: str):
    """Create a fake AssistantMessage with text blocks."""
    msg = AssistantMessage()
    msg.content = [SimpleNamespace(text=t) for t in texts]
    return msg


def _make_result_message():
    """Create a fake ResultMessage signalling agent completion."""
    return ResultMessage()


class _AsyncIter:
    """Wraps a list of messages into an async iterator for ``async for``."""

    def __init__(self, items):
        self._items = list(items)
        self._idx = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._idx >= len(self._items):
            raise StopAsyncIteration
        item = self._items[self._idx]
        self._idx += 1
        return item


class _AsyncIterSlow:
    """Async iterator that blocks indefinitely (timeout / cancellation tests)."""

    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.sleep(100)
        raise StopAsyncIteration  # pragma: no cover


class _AsyncIterError:
    """Async iterator that raises on first ``__anext__``."""

    def __init__(self, exc):
        self._exc = exc

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise self._exc


def _patch_query(messages):
    """Patch ``query`` to return an async iterator over *messages*.

    Uses ``new=`` with a plain callable (not AsyncMock) so that
    ``query(prompt, options)`` returns an async iterator directly
    rather than wrapping it in a coroutine.
    """
    return patch(
        "services.agent.runner.query",
        new=MagicMock(return_value=_AsyncIter(messages)),
    )


def _patch_query_slow():
    """Patch ``query`` to block forever (for timeout / cancellation tests)."""
    return patch(
        "services.agent.runner.query",
        new=MagicMock(return_value=_AsyncIterSlow()),
    )


def _patch_query_error(exc):
    """Patch ``query`` to raise *exc* on the first iteration."""
    return patch(
        "services.agent.runner.query",
        new=MagicMock(return_value=_AsyncIterError(exc)),
    )


# ---------------------------------------------------------------------------
# Shared patches — applied to every test via the ``agent_mocks`` fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def agent_mocks():
    """Provide commonly-needed mocks for run_agent tests.

    Patches save_and_publish (captures events), publish_artifacts, post_stage_hook,
    render_system_prompt, get_opener, create_mcp_server, read_volume_file, and settings.
    """
    published: list[tuple[str, str, dict, str | None]] = []

    async def _capture(session_id, event_type, data, role=None):
        published.append((session_id, event_type, data, role))

    with (
        patch(
            "services.agent.runner.save_and_publish",
            side_effect=_capture,
        ) as mock_sap,
        patch(
            "services.agent.runner.publish_artifacts",
            new_callable=AsyncMock,
        ) as mock_pa,
        patch(
            "services.agent.runner.post_stage_hook",
            new_callable=AsyncMock,
        ) as mock_psh,
        patch(
            "services.agent.runner.render_system_prompt",
            return_value="You are a helpful ML assistant.",
        ),
        patch(
            "services.agent.runner.get_opener",
            return_value="Begin the stage.",
        ),
        patch(
            "services.agent.runner.create_mcp_server",
            return_value=MagicMock(),
        ),
        patch(
            "services.agent.runner.read_volume_file",
            side_effect=FileNotFoundError("no report"),
        ) as mock_rvf,
        patch(
            "services.agent.runner.settings",
            MagicMock(
                agent_timeout_seconds=30,
                agent_max_turns=5,
                claude_model="claude-sonnet-4-20250514",
                claude_code_oauth_token="fake-token",
            ),
        ),
    ):
        yield {
            "published": published,
            "save_and_publish": mock_sap,
            "publish_artifacts": mock_pa,
            "post_stage_hook": mock_psh,
            "read_volume_file": mock_rvf,
        }


# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------


def _types(published):
    return [ev[1] for ev in published]


def _data(published, event_type):
    return [ev[2] for ev in published if ev[1] == event_type]


# ---------------------------------------------------------------------------
# Test: successful agent run (happy path)
# ---------------------------------------------------------------------------


class TestRunAgentSuccess:
    @pytest.mark.asyncio
    async def test_happy_path_event_sequence(self, agent_mocks):
        """state_change(running) -> agent_message -> state_change(done)."""
        with _patch_query([
            _make_assistant_message("Here is my analysis."),
            _make_result_message(),
        ]):
            result = await run_agent(
                session_id="s1",
                experiment_id="e1",
                stage="eda",
                instructions="Analyze the dataset",
            )

        evts = agent_mocks["published"]
        assert _types(evts)[0] == "state_change"
        assert evts[0][2] == {"state": "eda_running"}
        assert "agent_message" in _types(evts)
        assert _types(evts)[-1] == "state_change"
        assert evts[-1][2] == {"state": "eda_done"}
        assert result == "Here is my analysis."

    @pytest.mark.asyncio
    async def test_multiple_text_blocks_collected(self, agent_mocks):
        """Multiple text blocks across messages are published and concatenated."""
        with _patch_query([
            _make_assistant_message("Part 1.", "Part 2."),
            _make_assistant_message("Part 3."),
            _make_result_message(),
        ]):
            result = await run_agent(
                session_id="s2", experiment_id="e2", stage="eda", instructions="Go",
            )

        msgs = _data(agent_mocks["published"], "agent_message")
        assert len(msgs) == 3
        assert msgs[0] == {"text": "Part 1."}
        assert msgs[1] == {"text": "Part 2."}
        assert msgs[2] == {"text": "Part 3."}
        assert result == "Part 1.Part 2.Part 3."

    @pytest.mark.asyncio
    async def test_publish_artifacts_and_post_hook_called(self, agent_mocks):
        """After agent finishes, publish_artifacts and post_stage_hook are invoked."""
        with _patch_query([_make_result_message()]):
            await run_agent(
                session_id="s3", experiment_id="e3", stage="prep", instructions="Prep",
            )

        agent_mocks["publish_artifacts"].assert_awaited_once_with("s3", "e3", "prep")
        agent_mocks["post_stage_hook"].assert_awaited_once_with("s3", "e3", "prep")

    @pytest.mark.asyncio
    async def test_non_text_blocks_skipped(self, agent_mocks):
        """Blocks without a .text attribute are silently skipped."""
        block_no_text = SimpleNamespace()  # no .text
        msg = AssistantMessage()
        msg.content = [block_no_text, SimpleNamespace(text="Real text.")]

        with _patch_query([msg, _make_result_message()]):
            result = await run_agent(
                session_id="s4", experiment_id="e4", stage="eda", instructions="Go",
            )

        assert _data(agent_mocks["published"], "agent_message") == [{"text": "Real text."}]
        assert result == "Real text."

    @pytest.mark.asyncio
    async def test_empty_text_blocks_skipped(self, agent_mocks):
        """Blocks with empty .text are skipped."""
        with _patch_query([
            _make_assistant_message("", "Actual text."),
            _make_result_message(),
        ]):
            result = await run_agent(
                session_id="s5", experiment_id="e5", stage="eda", instructions="Go",
            )

        assert len(_data(agent_mocks["published"], "agent_message")) == 1
        assert result == "Actual text."


# ---------------------------------------------------------------------------
# Test: event data shapes and roles
# ---------------------------------------------------------------------------


class TestEventDataShapes:
    @pytest.mark.asyncio
    async def test_state_change_has_system_role(self, agent_mocks):
        with _patch_query([_make_result_message()]):
            await run_agent(
                session_id="ds1", experiment_id="e1", stage="train", instructions="Go",
            )

        for ev in agent_mocks["published"]:
            if ev[1] == "state_change":
                assert ev[3] == "system"

    @pytest.mark.asyncio
    async def test_agent_message_has_assistant_role(self, agent_mocks):
        with _patch_query([_make_assistant_message("Hi"), _make_result_message()]):
            await run_agent(
                session_id="ds2", experiment_id="e2", stage="eda", instructions="Go",
            )

        for ev in agent_mocks["published"]:
            if ev[1] == "agent_message":
                assert ev[3] == "assistant"

    @pytest.mark.asyncio
    async def test_stage_prefix_in_states(self, agent_mocks):
        with _patch_query([_make_result_message()]):
            await run_agent(
                session_id="ds3", experiment_id="e3", stage="prep", instructions="Go",
            )

        states = _data(agent_mocks["published"], "state_change")
        assert states[0] == {"state": "prep_running"}
        assert states[-1] == {"state": "prep_done"}


# ---------------------------------------------------------------------------
# Test: timeout handling
# ---------------------------------------------------------------------------


class TestRunAgentTimeout:
    @pytest.mark.asyncio
    async def test_timeout_publishes_error_and_failed(self, agent_mocks):
        with (
            _patch_query_slow(),
            patch(
                "services.agent.runner.settings",
                MagicMock(
                    agent_timeout_seconds=0.01,
                    agent_max_turns=5,
                    claude_model="claude-sonnet-4-20250514",
                    claude_code_oauth_token="fake-token",
                ),
            ),
        ):
            result = await run_agent(
                session_id="st1", experiment_id="et", stage="eda", instructions="Go",
            )

        assert "agent_error" in _types(agent_mocks["published"])
        err = _data(agent_mocks["published"], "agent_error")
        assert len(err) == 1
        assert "timed out" in err[0]["error"]
        assert _data(agent_mocks["published"], "state_change")[-1] == {"state": "failed"}
        assert result == ""


# ---------------------------------------------------------------------------
# Test: cancellation handling
# ---------------------------------------------------------------------------


class TestRunAgentCancellation:
    @pytest.mark.asyncio
    async def test_cancellation_publishes_aborted(self, agent_mocks):
        with _patch_query_slow():
            task = asyncio.create_task(
                run_agent(
                    session_id="sc1", experiment_id="ec", stage="prep", instructions="Go",
                )
            )
            await asyncio.sleep(0.05)
            task.cancel()
            # Runner catches CancelledError internally; task completes normally
            await task

        assert "agent_aborted" in _types(agent_mocks["published"])
        aborted = _data(agent_mocks["published"], "agent_aborted")
        assert aborted[0]["reason"] == "user_cancelled"
        assert aborted[0]["stage"] == "prep"
        assert _data(agent_mocks["published"], "state_change")[-1] == {"state": "cancelled"}

    @pytest.mark.asyncio
    async def test_silent_cancellation_suppresses_events(self, agent_mocks):
        from services.agent.tasks import _silent_aborts

        _silent_aborts.add("sc2")
        try:
            with _patch_query_slow():
                task = asyncio.create_task(
                    run_agent(
                        session_id="sc2", experiment_id="es", stage="eda", instructions="Go",
                    )
                )
                await asyncio.sleep(0.05)
                task.cancel()
                # Runner catches CancelledError internally; task completes normally
                await task

            assert "agent_aborted" not in _types(agent_mocks["published"])
            assert all(
                d["state"] != "cancelled"
                for d in _data(agent_mocks["published"], "state_change")
            )
        finally:
            _silent_aborts.discard("sc2")


# ---------------------------------------------------------------------------
# Test: general exception handling
# ---------------------------------------------------------------------------


class TestRunAgentError:
    @pytest.mark.asyncio
    async def test_error_publishes_and_reraises(self, agent_mocks):
        with _patch_query_error(RuntimeError("SDK broke")):
            with pytest.raises(RuntimeError, match="SDK broke"):
                await run_agent(
                    session_id="se1", experiment_id="ee", stage="train", instructions="Go",
                )

        assert "agent_error" in _types(agent_mocks["published"])
        assert "SDK broke" in _data(agent_mocks["published"], "agent_error")[0]["error"]
        assert _data(agent_mocks["published"], "state_change")[-1] == {"state": "failed"}


# ---------------------------------------------------------------------------
# Test: cleanup always runs
# ---------------------------------------------------------------------------


class TestCleanup:
    @pytest.mark.asyncio
    async def test_cleanup_on_success(self, agent_mocks):
        with (
            _patch_query([_make_result_message()]),
            patch("services.agent.tasks.cleanup_session") as mock_cl,
        ):
            await run_agent(
                session_id="cl1", experiment_id="e1", stage="eda", instructions="Go",
            )
        mock_cl.assert_called_once_with("cl1")

    @pytest.mark.asyncio
    async def test_cleanup_on_error(self, agent_mocks):
        with (
            _patch_query_error(ValueError("bad")),
            patch("services.agent.tasks.cleanup_session") as mock_cl,
        ):
            with pytest.raises(ValueError):
                await run_agent(
                    session_id="cl2", experiment_id="e1", stage="eda", instructions="Go",
                )
        mock_cl.assert_called_once_with("cl2")


# ---------------------------------------------------------------------------
# Test: previous stage report loading
# ---------------------------------------------------------------------------


class TestPreviousStageContext:
    @pytest.mark.asyncio
    async def test_prep_loads_eda_report(self, agent_mocks):
        def _read(path):
            if "eda/report.md" in path:
                return b"# EDA Report\n1599 rows."
            raise FileNotFoundError("nope")

        agent_mocks["read_volume_file"].side_effect = _read
        with _patch_query([_make_result_message()]):
            await run_agent(
                session_id="cx1", experiment_id="e1", stage="prep", instructions="Go",
            )

        paths = [str(c) for c in agent_mocks["read_volume_file"].call_args_list]
        assert any("eda/report.md" in p for p in paths)

    @pytest.mark.asyncio
    async def test_train_loads_prep_report_and_metadata(self, agent_mocks):
        def _read(path):
            if "prep/report.md" in path:
                return b"# Prep Report"
            if "prep/data/metadata.json" in path:
                return b'{"target_column": "quality"}'
            raise FileNotFoundError(path)

        agent_mocks["read_volume_file"].side_effect = _read
        with _patch_query([_make_result_message()]):
            await run_agent(
                session_id="cx2", experiment_id="e2", stage="train", instructions="Go",
            )

        paths = [str(c) for c in agent_mocks["read_volume_file"].call_args_list]
        assert any("prep/report.md" in p for p in paths)
        assert any("prep/data/metadata.json" in p for p in paths)

    @pytest.mark.asyncio
    async def test_eda_skips_report_loading(self, agent_mocks):
        with _patch_query([_make_result_message()]):
            await run_agent(
                session_id="cx3", experiment_id="e3", stage="eda", instructions="Go",
            )
        agent_mocks["read_volume_file"].assert_not_called()


# ---------------------------------------------------------------------------
# Test: conversation history
# ---------------------------------------------------------------------------


class TestConversationHistory:
    @pytest.mark.asyncio
    async def test_history_loaded_for_user_prompt(self, agent_mocks):
        history = [
            {"role": "user", "content": "Analyze distributions"},
            {"role": "assistant", "content": "Here they are..."},
        ]
        with (
            _patch_query([_make_result_message()]),
            patch(
                "services.agent.runner._load_conversation_history",
                new_callable=AsyncMock,
                return_value=history,
            ) as mock_load,
        ):
            await run_agent(
                session_id="ch1", experiment_id="e1", stage="eda",
                instructions="Analyze", user_prompt="Show correlations",
            )
        mock_load.assert_awaited_once_with("ch1")

    @pytest.mark.asyncio
    async def test_no_history_without_user_prompt(self, agent_mocks):
        with (
            _patch_query([_make_result_message()]),
            patch(
                "services.agent.runner._load_conversation_history",
                new_callable=AsyncMock,
            ) as mock_load,
        ):
            await run_agent(
                session_id="ch2", experiment_id="e2", stage="eda",
                instructions="Analyze", user_prompt=None,
            )
        mock_load.assert_not_awaited()


# ---------------------------------------------------------------------------
# Test: _load_conversation_history (DB integration)
# ---------------------------------------------------------------------------


class TestLoadConversationHistory:
    @pytest.mark.asyncio
    async def test_empty_returns_empty_list(self):
        result = await _load_conversation_history("nonexistent")
        assert result == []

    @pytest.mark.asyncio
    async def test_loads_user_and_agent_messages(self):
        from db import async_session
        from models import Message

        sid = "lh1"
        async with async_session() as db:
            db.add(Message(
                session_id=sid, role="user", content="Analyze", metadata_={},
            ))
            db.add(Message(
                session_id=sid, role="assistant", content="Done.",
                metadata_={"event_type": "agent_message"},
            ))
            # system and tool messages should be excluded
            db.add(Message(
                session_id=sid, role="system", content="changed",
                metadata_={"event_type": "state_change"},
            ))
            db.add(Message(
                session_id=sid, role="tool", content="output",
                metadata_={"event_type": "tool_end"},
            ))
            await db.commit()

        result = await _load_conversation_history(sid)
        assert len(result) == 2
        assert result[0] == {"role": "user", "content": "Analyze"}
        assert result[1] == {"role": "assistant", "content": "Done."}

    @pytest.mark.asyncio
    async def test_non_agent_message_assistant_excluded(self):
        from db import async_session
        from models import Message

        sid = "lh2"
        async with async_session() as db:
            db.add(Message(
                session_id=sid, role="assistant", content="Report",
                metadata_={"event_type": "report_ready"},
            ))
            await db.commit()

        result = await _load_conversation_history(sid)
        assert result == []


# ---------------------------------------------------------------------------
# Test: all three stages produce correct state strings
# ---------------------------------------------------------------------------


class TestAllStages:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("stage", ["eda", "prep", "train"])
    async def test_stage_state_strings(self, agent_mocks, stage):
        with _patch_query([_make_result_message()]):
            await run_agent(
                session_id=f"as-{stage}", experiment_id=f"ae-{stage}",
                stage=stage, instructions=f"Do {stage}",
            )

        states = _data(agent_mocks["published"], "state_change")
        assert states[0] == {"state": f"{stage}_running"}
        assert states[-1] == {"state": f"{stage}_done"}
