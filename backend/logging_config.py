"""Structured logging configuration.

Provides a JSON formatter for production and a human-readable formatter for
local development.  Set ``LOG_FORMAT=json`` to enable JSON output (useful for
log aggregation services like Datadog, ELK, or CloudWatch).

Usage in ``main.py``::

    from logging_config import setup_logging
    setup_logging(level=settings.log_level, fmt=settings.log_format)
"""

import json
import logging
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """Emit each log record as a single JSON line.

    Includes timestamp, level, logger name, message, and any ``extra``
    fields attached to the record.
    """

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Include exception info when present
        if record.exc_info and record.exc_info[0] is not None:
            entry["exception"] = self.formatException(record.exc_info)

        # Forward any extra fields set via `logger.info("...", extra={...})`
        for key in ("request_id", "method", "path", "status", "duration_ms"):
            value = getattr(record, key, None)
            if value is not None:
                entry[key] = value

        return json.dumps(entry, default=str)


def setup_logging(level: str = "INFO", fmt: str = "text") -> None:
    """Configure the root logger.

    Parameters
    ----------
    level:
        Log level name (DEBUG, INFO, WARNING, ERROR, CRITICAL).
    fmt:
        ``"json"`` for structured JSON lines, anything else for human-readable.
    """
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Remove existing handlers to avoid duplicate output when this is
    # called more than once (e.g. in tests).
    for handler in root.handlers[:]:
        root.removeHandler(handler)

    handler = logging.StreamHandler()
    if fmt == "json":
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s")
        )

    root.addHandler(handler)
