"""Data exploration endpoints using DuckDB for querying processed parquet files."""

import asyncio
import io
import logging
import re

import duckdb
import pyarrow.parquet as pq
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_db
from models import ProcessedDatasetMeta
from services.volume import read_volume_file, reload_volume

logger = logging.getLogger(__name__)
router = APIRouter()

# Only allow SELECT statements — block writes, filesystem access, and DDL
_FORBIDDEN_PATTERNS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|COPY|EXPORT|IMPORT|INSTALL|LOAD|CALL|PRAGMA|EXECUTE)\b",
    re.IGNORECASE,
)
_FORBIDDEN_FUNCTIONS = re.compile(
    r"\b(read_csv|read_csv_auto|read_parquet|read_json|read_json_auto|read_text|glob|list_files)\s*\(",
    re.IGNORECASE,
)


def _validate_query(sql: str) -> None:
    """Reject anything that isn't a plain SELECT query."""
    stripped = sql.strip().rstrip(";").strip()
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
    limit: int = 100


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
    max_limit = min(body.limit, 1000)
    if "LIMIT" not in sql.upper():
        sql += f" LIMIT {max_limit}"

    def _blocking():
        reload_volume()
        data_dir = f"/sessions/{session_id}/prep/data"
        con = duckdb.connect(":memory:")
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
            con.close()

    try:
        return await asyncio.to_thread(_blocking)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query error: {e}")


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
