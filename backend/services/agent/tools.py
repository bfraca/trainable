"""MCP tool setup and code auto-save helpers."""

from __future__ import annotations

import logging
import re

from prompts import render_tool_description
from services.mcp_tools import create_trainable_mcp_server
from services.sandbox import run_code
from services.volume import get_volume, reload_volume, write_to_volume

from .events import save_and_publish

logger = logging.getLogger(__name__)

# Per-session code step counter for naming scripts
_code_counter: dict[str, int] = {}

# Per-session set of known file paths (for detecting new files after code runs)
_known_files: dict[str, set[str]] = {}

# ---------------------------------------------------------------------------
# Code auto-save helpers
# ---------------------------------------------------------------------------


def _extract_slug(code: str) -> str:
    """Extract a short descriptive slug from code for naming the script file."""
    for line in code.splitlines():
        line = line.strip()
        # Try top-level comment
        if line.startswith("#") and not line.startswith("#!"):
            text = line.lstrip("# ").strip()
            if len(text) > 3:
                slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
                return slug[:40]
        # Try function/class def
        m = re.match(r"(?:def|class)\s+(\w+)", line)
        if m:
            return m.group(1)[:40]
    # Fallback: first significant import or assignment
    for line in code.splitlines():
        line = line.strip()
        if line.startswith("import ") or line.startswith("from "):
            mod = line.split()[-1].split(".")[-1]
            return mod[:40]
    return "code"


def _script_filename(code: str, session_id: str) -> str:
    """Generate a sequential, descriptive filename for a code execution."""
    counter = _code_counter.get(session_id, 0) + 1
    _code_counter[session_id] = counter
    slug = _extract_slug(code)
    return f"step_{counter:02d}_{slug}.py"


async def detect_new_files(session_id: str, stage: str):
    """Scan the stage workspace and emit file_created for any new files since last check."""

    workspace = f"/sessions/{session_id}/{stage}"
    try:
        reload_volume()
        vol = get_volume()
        current_files = set()
        for entry in vol.listdir(workspace, recursive=True):
            if entry.type.name == "FILE":
                current_files.add(entry.path)

        known = _known_files.get(session_id, set())
        new_files = current_files - known
        _known_files[session_id] = current_files

        for path in sorted(new_files):
            name = path.split("/")[-1]
            await save_and_publish(
                session_id,
                "file_created",
                {
                    "path": path,
                    "name": name,
                    "type": "file",
                    "stage": stage,
                },
            )

        if new_files:
            logger.info("Detected %d new files in %s/", len(new_files), stage)
    except Exception as e:
        logger.warning("File detection error: %s", e)


# ---------------------------------------------------------------------------
# Tool handler factory (created per run_agent call to capture session context)
# ---------------------------------------------------------------------------


def create_execute_code_handler(session_id: str, stage: str, gpu: str | None = None):
    """Create an execute_code handler bound to a specific session/stage (concurrency-safe)."""

    async def _execute_code(args):
        code = args.get("code", "") if isinstance(args, dict) else str(args)

        await save_and_publish(
            session_id,
            "tool_start",
            {"tool": "execute_code", "input": {"code": code[:500]}},
            role="tool",
        )

        # Auto-save code as a .py file
        filename = _script_filename(code, session_id)
        script_path = f"/sessions/{session_id}/{stage}/scripts/{filename}"
        try:
            await write_to_volume(code, script_path)
            _known_files.setdefault(session_id, set()).add(script_path)
            await save_and_publish(
                session_id,
                "file_created",
                {
                    "path": script_path,
                    "name": filename,
                    "type": "file",
                    "stage": stage,
                },
            )
        except Exception as e:
            logger.error("Failed to save script {filename}: %s", e)

        try:
            result = await run_code(code, session_id, stage=stage, gpu=gpu)
        except Exception as e:
            error_msg = f"Sandbox error: {e}"
            await save_and_publish(
                session_id,
                "tool_end",
                {"tool": "execute_code", "output": error_msg},
                role="tool",
            )
            return {"content": [{"type": "text", "text": error_msg}], "is_error": True}

        output = result["stdout"]
        if result["returncode"] != 0:
            output = f"Exit code {result['returncode']}.\nSTDOUT:\n{result['stdout']}\nSTDERR:\n{result['stderr']}"
        elif result["stderr"]:
            output += f"\n[stderr]: {result['stderr']}"
        output = output or "(no output)"

        # Detect new files created by the executed code
        await detect_new_files(session_id, stage)

        await save_and_publish(
            session_id,
            "tool_end",
            {"tool": "execute_code", "output": output[:2000]},
            role="tool",
        )

        return {"content": [{"type": "text", "text": output}]}

    return _execute_code


def create_mcp_server(
    session_id: str, experiment_id: str, stage: str, gpu: str | None = None
):
    """Create a per-call MCP server with a bound tool handler."""
    handler = create_execute_code_handler(session_id, stage, gpu=gpu)
    tool_desc = render_tool_description(
        experiment_id=experiment_id,
        session_id=session_id,
        stage=stage,
    )
    return create_trainable_mcp_server(
        {
            "execute_code": {
                "description": tool_desc,
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": "Python code to execute in the sandbox",
                        },
                    },
                    "required": ["code"],
                },
                "handler": handler,
            },
        }
    )
