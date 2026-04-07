"""Centralized configuration — single source of truth for all settings.

All values can be overridden via environment variables or a .env file.
Variable names match the field names in UPPER_CASE (e.g. SANDBOX_TIMEOUT=300).
"""

from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    # -- Database --
    database_url: str = "sqlite+aiosqlite:///trainable.db"
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_recycle: int = 3600

    # -- S3 / MinIO --
    s3_endpoint: str = "http://localhost:4566"
    s3_endpoint_external: Optional[str] = None  # falls back to s3_endpoint
    aws_access_key_id: str = "test"
    aws_secret_access_key: str = "test"
    aws_region: str = "us-east-1"

    # -- Modal --
    modal_app_name: str = "trainable"
    modal_volume_name: str = "trainable-data"

    # -- Claude / Agent --
    claude_model: str = "claude-opus-4-6"
    claude_code_oauth_token: str = ""
    agent_max_turns: int = 30
    agent_timeout_seconds: int = Field(
        default=1800,
        description="Overall wall-clock timeout for an agent run (seconds)",
    )
    agent_abort_timeout: float = 5.0

    # -- Sandbox --
    sandbox_timeout: int = Field(
        default=600, description="Per-execution timeout in Modal sandbox (seconds)"
    )

    # -- SSE / Broadcaster --
    sse_keepalive_seconds: float = 30.0
    broadcaster_max_queue_size: int = 1000

    # -- Authentication --
    api_key: str = ""  # Set API_KEY env var to enable auth; empty = open access

    # -- CORS --
    cors_origins: list[str] = ["*"]

    # -- Upload limits --
    max_upload_size_bytes: int = 500 * 1024 * 1024  # 500 MB

    # -- Data explorer --
    query_default_limit: int = 100
    query_max_limit: int = 1000
    query_timeout_seconds: int = 30  # Per-query DuckDB timeout
    preview_default_limit: int = 50

    # -- Logging --
    log_level: str = "INFO"


settings = Settings()
