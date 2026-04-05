"""Load prompt templates from YAML files in the prompts/ directory."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

_PROMPTS_DIR = Path(__file__).parent


@lru_cache(maxsize=None)
def _load_yaml(stage: str) -> dict:
    path = _PROMPTS_DIR / f"{stage}.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def get_system_prompt(stage: str) -> str:
    """Return the raw system prompt template for a stage (eda, prep, train)."""
    return _load_yaml(stage)["system"]


def get_opener(stage: str) -> str:
    """Return the opening user message for a stage."""
    return _load_yaml(stage)["opener"]


def get_tool_description() -> str:
    """Return the execute_code tool description template."""
    return _load_yaml("tool")["execute_code"]["description"]


def render_system_prompt(
    stage: str,
    *,
    experiment_id: str,
    session_id: str,
    instructions: str = "",
    prev_context: str = "(No previous stage report available)",
) -> str:
    """Load a stage prompt template and fill in the placeholders.

    Uses .replace() instead of .format() because templates contain Python
    code examples with {epoch+1}, {train_loss} etc. that .format() chokes on.
    """
    template = get_system_prompt(stage)
    return (
        template.replace("{experiment_id}", experiment_id)
        .replace("{session_id}", session_id)
        .replace("{instructions}", instructions or "No specific instructions.")
        .replace("{prev_context}", prev_context)
    )


def render_tool_description(
    *,
    experiment_id: str,
    session_id: str,
    stage: str,
) -> str:
    """Load the tool description template and fill in placeholders."""
    template = get_tool_description()
    return (
        template.replace("{experiment_id}", experiment_id)
        .replace("{session_id}", session_id)
        .replace("{stage}", stage)
    )
