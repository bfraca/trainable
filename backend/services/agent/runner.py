"""Core agent loop — orchestrates Claude Agent SDK calls."""

from __future__ import annotations

import asyncio
import logging

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    query,
)
from sqlalchemy import select

from config import settings
from db import async_session
from models import Message
from prompts import get_opener, render_system_prompt
from services.volume import read_volume_file

from .events import post_stage_hook, publish_artifacts, save_and_publish
from .tasks import _silent_aborts
from .tools import create_mcp_server

logger = logging.getLogger(__name__)


async def _load_conversation_history(session_id: str) -> list[dict]:
    """Load prior messages from DB to give the agent conversation context."""

    messages = []
    try:
        async with async_session() as db:
            result = await db.execute(
                select(Message)
                .where(Message.session_id == session_id)
                .order_by(Message.id)
            )
            for msg in result.scalars().all():
                event_type = (msg.metadata_ or {}).get("event_type", "")
                # Only include user messages and agent text messages for context
                if msg.role == "user":
                    messages.append({"role": "user", "content": msg.content})
                elif msg.role == "assistant" and event_type == "agent_message":
                    messages.append({"role": "assistant", "content": msg.content})
    except Exception as e:
        logger.error("Failed to load history: %s", e)
    return messages


async def run_agent(
    session_id: str,
    experiment_id: str,
    stage: str,
    instructions: str,
    dataset_ref: str = "",
    user_prompt: str | None = None,
    gpu: str | None = None,
):
    collected_text = ""

    try:
        # Read previous stage report for context injection
        prev_context = "(No previous stage report available)"
        if stage in ("prep", "train"):
            prev_stage = "eda" if stage == "prep" else "prep"
            report_path = f"/sessions/{session_id}/{prev_stage}/report.md"
            try:
                prev_context = read_volume_file(report_path).decode(
                    "utf-8", errors="replace"
                )
                logger.info(
                    "Loaded %s report (%d chars) as context",
                    prev_stage,
                    len(prev_context),
                )
            except Exception as e:
                logger.debug("Could not load {prev_stage} report: %s", e)

            # For train stage, also inject prep metadata.json for structured context
            if stage == "train":
                metadata_path = f"/sessions/{session_id}/prep/data/metadata.json"
                try:
                    metadata_text = read_volume_file(metadata_path).decode(
                        "utf-8", errors="replace"
                    )
                    prev_context += f"\n\n## Prep Metadata (machine-readable)\n```json\n{metadata_text}\n```"
                    logger.info(
                        "Loaded prep metadata.json (%d chars) as context",
                        len(metadata_text),
                    )
                except Exception as e:
                    logger.debug("Could not load prep metadata.json: %s", e)

        system_prompt = render_system_prompt(
            stage,
            experiment_id=experiment_id,
            session_id=session_id,
            instructions=instructions,
            prev_context=prev_context,
        )

        if user_prompt:
            prompt = user_prompt
        else:
            prompt = get_opener(stage)

        await save_and_publish(
            session_id, "state_change", {"state": f"{stage}_running"}, role="system"
        )

        model = settings.claude_model

        # Load conversation history for follow-up messages
        if user_prompt:
            history = await _load_conversation_history(session_id)
            if history:
                context_parts = []
                for msg in history[:-1]:
                    prefix = "User" if msg["role"] == "user" else "Assistant"
                    context_parts.append(f"{prefix}: {msg['content']}")
                if context_parts:
                    conversation_context = "\n\n".join(context_parts)
                    system_prompt += (
                        f"\n\n## Prior conversation\n{conversation_context}"
                    )

        # Create per-call MCP server (concurrency-safe -- each run gets its own handler)
        mcp_server = create_mcp_server(session_id, experiment_id, stage, gpu=gpu)

        options = ClaudeAgentOptions(
            system_prompt=system_prompt,
            model=model,
            permission_mode="bypassPermissions",
            max_turns=settings.agent_max_turns,
            stderr=lambda line: (
                logger.debug("CLI: %s", line.strip()) if line.strip() else None
            ),
            tools=["mcp__trainable__execute_code"],
            allowed_tools=["mcp__trainable__execute_code"],
            mcp_servers={"trainable": mcp_server},
            env={"CLAUDE_CODE_OAUTH_TOKEN": settings.claude_code_oauth_token},
        )

        logger.info("Starting %s session=%s model=%s", stage, session_id, model)

        async with asyncio.timeout(settings.agent_timeout_seconds):
            async for message in query(prompt=prompt, options=options):
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if hasattr(block, "text") and block.text:
                            collected_text += block.text
                            await save_and_publish(
                                session_id,
                                "agent_message",
                                {"text": block.text},
                                role="assistant",
                            )
                            logger.info("Agent text: %s", block.text[:120])

                elif isinstance(message, ResultMessage):
                    logger.info("Agent done")

        # After agent finishes, read back the report and file list from volume
        await publish_artifacts(session_id, experiment_id, stage)

        # Post-stage hooks: validation, S3 sync, metadata extraction
        await post_stage_hook(session_id, experiment_id, stage)

        await save_and_publish(
            session_id, "state_change", {"state": f"{stage}_done"}, role="system"
        )

    except TimeoutError:
        logger.error(
            "Agent timed out after %ds for session %s stage %s",
            settings.agent_timeout_seconds,
            session_id,
            stage,
        )
        await save_and_publish(
            session_id,
            "agent_error",
            {"error": f"Agent timed out after {settings.agent_timeout_seconds}s"},
            role="system",
        )
        await save_and_publish(
            session_id, "state_change", {"state": "failed"}, role="system"
        )

    except asyncio.CancelledError:
        silent = session_id in _silent_aborts
        _silent_aborts.discard(session_id)
        logger.info(
            "Cancelled: session=%s stage=%s silent=%s", session_id, stage, silent
        )
        if not silent:
            await save_and_publish(
                session_id,
                "agent_aborted",
                {"reason": "user_cancelled", "stage": stage},
                role="system",
            )
            await save_and_publish(
                session_id, "state_change", {"state": "cancelled"}, role="system"
            )

    except Exception as e:
        logger.exception("Error in %s for session %s", stage, session_id)
        await save_and_publish(
            session_id, "agent_error", {"error": str(e)}, role="system"
        )
        await save_and_publish(
            session_id, "state_change", {"state": "failed"}, role="system"
        )
        raise

    finally:
        from .tasks import cleanup_session

        cleanup_session(session_id)

    return collected_text
