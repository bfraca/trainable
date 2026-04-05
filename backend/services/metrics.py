"""Metric parsing from sandbox stdout and persistence."""

from __future__ import annotations

import json
import logging

from db import async_session
from models import Metric
from services.broadcaster import broadcaster

logger = logging.getLogger(__name__)


def parse_stdout_line(text: str) -> dict | None:
    """Parse a single stdout line.  Returns a dict with 'type' key:
    - {"type": "metrics", "items": [...]}
    - {"type": "chart_config", "config": {...}}
    - None if not a recognised JSON event
    """
    line = text.strip()
    if not line.startswith("{"):
        return None
    try:
        obj = json.loads(line)
    except (json.JSONDecodeError, ValueError):
        return None

    # ── chart_config event ──────────────────────────────────────────
    # {"chart_config": {"charts": [{"title":"Loss","metrics":["train_loss","val_loss"],"type":"line"}, ...]}}
    if "chart_config" in obj and isinstance(obj["chart_config"], dict):
        return {"type": "chart_config", "config": obj["chart_config"]}

    # ── metric events ───────────────────────────────────────────────
    if "step" not in obj:
        return None

    try:
        step = int(obj["step"])
    except (TypeError, ValueError):
        return None

    run_tag = obj.get("run") or None
    items: list[dict] = []

    # Batch format: {"step": 1, "metrics": {"loss": 0.5, "acc": 0.85}}
    if "metrics" in obj and isinstance(obj["metrics"], dict):
        for name, value in obj["metrics"].items():
            if isinstance(value, (int, float)):
                items.append(
                    {
                        "step": step,
                        "name": str(name),
                        "value": float(value),
                        "run_tag": run_tag,
                    }
                )

    # Single format: {"step": 1, "metric": "loss", "value": 0.5}
    elif "metric" in obj and "value" in obj:
        try:
            items.append(
                {
                    "step": step,
                    "name": str(obj["metric"]),
                    "value": float(obj["value"]),
                    "run_tag": run_tag,
                }
            )
        except (TypeError, ValueError):
            return None

    return {"type": "metrics", "items": items} if items else None


def parse_metric_lines(text: str) -> list[dict]:
    """Parse multiple stdout lines and return a flat list of metric items."""
    results: list[dict] = []
    for line in text.split("\n"):
        parsed = parse_stdout_line(line)
        if parsed and parsed["type"] == "metrics":
            results.extend(parsed["items"])
    return results


async def publish_chart_config(session_id: str, config: dict):
    """Publish a chart_config SSE event so the frontend knows how to render."""
    await broadcaster.publish(
        session_id,
        {
            "type": "chart_config",
            "data": config,
        },
    )


async def persist_and_publish(session_id: str, stage: str, parsed: list[dict]):
    """Publish metric SSE events, then persist to DB."""
    if not parsed:
        return

    # Publish batched SSE event (one message for all metrics in this line)
    batch_data = [
        {
            "step": m["step"],
            "name": m["name"],
            "value": m["value"],
            "stage": stage,
            "run_tag": m.get("run_tag"),
        }
        for m in parsed
    ]
    await broadcaster.publish(
        session_id,
        {
            "type": "metrics_batch",
            "data": {"items": batch_data},
        },
    )

    # Persist to DB
    try:
        async with async_session() as db:
            db.add_all(
                [
                    Metric(
                        session_id=session_id,
                        stage=stage,
                        step=m["step"],
                        name=m["name"],
                        value=m["value"],
                        run_tag=m.get("run_tag"),
                    )
                    for m in parsed
                ]
            )
            await db.commit()
    except Exception as e:
        logger.warning(f"Failed to persist metrics: {e}")
