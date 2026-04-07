"""Data exploration endpoints using DuckDB for querying processed parquet files.

Security hardening
------------------
* Only ``SELECT`` statements are accepted — DDL, DML, and system commands are
  blocked via regex before the query reaches DuckDB.
* Filesystem-access functions (``read_csv_auto``, ``read_parquet``, …) are
  blocked so users cannot read arbitrary files from the host.
* ``enable_external_access`` is disabled **before** running any user SQL.
* A configurable per-query timeout (default 30 s) prevents runaway queries.
* Multi-statement attacks (semicolons) are rejected.
* ``LIMIT`` is auto-appended when missing and hard-capped via config.
"""

import asyncio
import io
import logging
import re
import threading

import duckdb
import pyarrow.parquet as pq
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db import get_db
from models import ProcessedDatasetMeta
from services.volume import read_volume_file, reload_volume

logger = logging.getLogger(__name__)
router = APIRouter()

# --------------------------------------------------------------------------- #
# Query validation
# --------------------------------------------------------------------------- #

# Block writes, DDL, system commands, and extension management
_FORBIDDEN_PATTERNS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|COPY|EXPORT"
    r"|IMPORT|INSTALL|LOAD|CALL|PRAGMA|EXECUTE|SET|RESET|BEGIN|COMMIT"
    r"|ROLLBACK|GRANT|REVOKE|VACUUM|CHECKPOINT|FORCE)\b",
    re.IGNORECASE,
)

# Block functions that read from the filesystem or network
_FORBIDDEN_FUNCTIONS = re.compile(
    r"\b(read_csv|read_csv_auto|read_parquet|read_json|read_json_auto"
    r"|read_text|read_blob|glob|list_files|httpfs|http_get|http_post"
    r"|s3_get|s3_put|write_csv|write_parquet|current_setting)\s*\(",
    re.IGNORECASE,
)


def _validate_query(sql: str) -> None:
    """Reject anything that isn't a plain, single SELECT query."""
    stripped = sql.strip().rstrip(";").strip()

    # Block multi-statement attacks
    if ";" in stripped:
        raise HTTPException(
            status_code=400, detail="Multiple statements are not allowed"
        )

    if not stripped.upper().startswith("SELECT"):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed")

    if _FORBIDDEN_PATTERNS.search(stripped):
        raise HTTPException(
            status_code=400, detail="Query contains forbidden statements"
        )
    if _FORBIDDEN_FUNCTIONS.search(stripped):
        raise HTTPException(
            status_code=400,
            detail="Query contains forbidden functions (filesystem access)",
        )


class QueryRequest(BaseModel):
    sql: str
    limit: int = Field(default=100, le=1000, ge=1)


def _load_parquet_to_duckdb(
    con: duckdb.DuckDBPyConnection, raw: bytes, table_name: str
):
    """Load parquet bytes into a DuckDB table via pyarrow."""
    arrow_table = pq.read_table(io.BytesIO(raw))  # noqa: F841 — referenced by DuckDB SQL below
    con.execute(f"CREATE TABLE {table_name} AS SELECT * FROM arrow_table")


@router.post("/sessions/{session_id}/prep/query")
async def query_prep_data(session_id: str, body: QueryRequest):
    """Run a read-only DuckDB SQL query against the processed parquet files.

    Available tables: train, val, test (from parquet splits).
    Also creates an all_data view combining all splits with a 'split' column.
    """

    # Validate user SQL before entering the thread (fast, no I/O)
    sql = body.sql.strip().rstrip(";")
    _validate_query(sql)
    max_limit = min(body.limit, settings.query_max_limit)
    if "LIMIT" not in sql.upper():
        sql += f" LIMIT {max_limit}"

    timeout_sec = settings.query_timeout_seconds

    # Shared holders so _blocking() can expose the timer & connection for
    # cleanup by the outer scope, and the timer can reach the connection.
    timer_holder: list[threading.Timer] = []
    con_holder: list[duckdb.DuckDBPyConnection] = []

    def _blocking():
        reload_volume()
        data_dir = f"/sessions/{session_id}/prep/data"
        con = duckdb.connect(":memory:")
        con_holder.append(con)

        # Start the timeout timer *after* the connection exists so the
        # interrupt callback can never find an empty con_holder.
        timer = threading.Timer(timeout_sec, lambda: con.interrupt())
        timer_holder.append(timer)
        timer.start()

        try:
            for split in ["train", "val", "test"]:
                path = f"{data_dir}/{split}.parquet"
                try:
                    raw = read_volume_file(path)
                    _load_parquet_to_duckdb(con, raw, split)
                except Exception:
                    pass

            tables = [name[0] for name in con.execute("SHOW TABLES").fetchall()]
            if not tables:
                raise HTTPException(status_code=404, detail="No processed data found")

            if len(tables) > 1:
                union_sql = " UNION ALL ".join(
                    f"SELECT *, '{t}' as split FROM {t}" for t in tables
                )
                con.execute(f"CREATE VIEW all_data AS {union_sql}")

            # Lock down the connection before running user SQL
            con.execute("SET enable_external_access = false")

            result = con.execute(sql)
            columns = [desc[0] for desc in result.description]
            rows = result.fetchall()

            return {
                "columns": columns,
                "rows": [list(row) for row in rows],
                "row_count": len(rows),
                "tables_available": tables,
            }
        finally:
            timer.cancel()
            con.close()

    try:
        return await asyncio.to_thread(_blocking)
    except duckdb.InterruptException:
        raise HTTPException(
            status_code=408, detail=f"Query timed out after {timeout_sec}s"
        )
    except HTTPException:
        raise
    except duckdb.Error as e:
        raise HTTPException(status_code=400, detail=f"Query error: {e}")
    except Exception as e:
        logger.exception("Unexpected error in query_prep_data")
        raise HTTPException(status_code=400, detail=f"Query error: {e}")
    finally:
        # Belt-and-suspenders: cancel the timer if _blocking() raised
        # before reaching its own finally block.
        if timer_holder:
            timer_holder[0].cancel()


@router.get("/sessions/{session_id}/prep/preview")
async def preview_prep_data(
    session_id: str,
    split: str = Query("train", pattern="^(train|val|test)$"),
    limit: int = Query(50, le=1000),
):
    """Quick preview of a processed data split (first N rows)."""

    def _blocking():
        reload_volume()
        path = f"/sessions/{session_id}/prep/data/{split}.parquet"
        try:
            raw = read_volume_file(path)
        except Exception:
            raise HTTPException(status_code=404, detail=f"{split}.parquet not found")

        con = duckdb.connect(":memory:")
        try:
            _load_parquet_to_duckdb(con, raw, split)
            result = con.execute(f"SELECT * FROM {split} LIMIT ?", [limit])
            columns = [desc[0] for desc in result.description]
            rows = result.fetchall()
            return {
                "split": split,
                "columns": columns,
                "rows": [list(row) for row in rows],
                "row_count": len(rows),
            }
        finally:
            con.close()

    return await asyncio.to_thread(_blocking)


@router.get("/sessions/{session_id}/prep/metadata")
async def get_prep_metadata(session_id: str, db: AsyncSession = Depends(get_db)):
    """Get the processed dataset metadata for a session."""

    result = await db.execute(
        select(ProcessedDatasetMeta).where(
            ProcessedDatasetMeta.session_id == session_id
        )
    )
    meta = result.scalar_one_or_none()
    if not meta:
        raise HTTPException(
            status_code=404, detail="No processed dataset metadata found"
        )
    return meta.to_dict()
