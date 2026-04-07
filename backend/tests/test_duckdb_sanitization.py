"""Tests for DuckDB query sanitization hardening in data_explorer.py."""

import pytest

from routers.data_explorer import _validate_query
from fastapi import HTTPException


# --------------------------------------------------------------------------- #
# _validate_query unit tests — fast, no I/O
# --------------------------------------------------------------------------- #


class TestValidateQuery:
    """Verify that _validate_query blocks dangerous SQL patterns."""

    def test_allows_simple_select(self):
        _validate_query("SELECT * FROM train")

    def test_allows_select_with_where(self):
        _validate_query("SELECT col FROM train WHERE x > 1")

    def test_allows_aggregate(self):
        _validate_query("SELECT COUNT(*), AVG(x) FROM train GROUP BY y")

    def test_blocks_non_select(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("UPDATE train SET x = 1")
        assert exc.value.status_code == 400
        assert "Only SELECT" in exc.value.detail

    def test_blocks_insert(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("INSERT INTO train VALUES (1,2)")
        assert exc.value.status_code == 400

    def test_blocks_delete(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("DELETE FROM train")
        assert exc.value.status_code == 400

    def test_blocks_drop(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT 1; DROP TABLE train")
        assert exc.value.status_code == 400

    def test_blocks_semicolons_multi_statement(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT 1; SELECT 2")
        assert exc.value.status_code == 400
        assert "Multiple statements" in exc.value.detail

    def test_blocks_attach(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("ATTACH '/etc/passwd' AS leak")
        assert exc.value.status_code == 400

    def test_blocks_copy(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("COPY train TO '/tmp/data.csv'")
        assert exc.value.status_code == 400

    def test_blocks_install(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("INSTALL httpfs")
        assert exc.value.status_code == 400

    def test_blocks_pragma(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("PRAGMA database_list")
        assert exc.value.status_code == 400

    def test_blocks_set(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SET enable_external_access = true")
        assert exc.value.status_code == 400

    def test_blocks_read_csv_auto(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT * FROM read_csv_auto('/etc/passwd')")
        assert exc.value.status_code == 400
        assert "forbidden functions" in exc.value.detail

    def test_blocks_read_parquet(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT * FROM read_parquet('/data/secret.parquet')")
        assert exc.value.status_code == 400

    def test_blocks_read_text(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT * FROM read_text('/etc/shadow')")
        assert exc.value.status_code == 400

    def test_blocks_read_blob(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT * FROM read_blob('/tmp/file')")
        assert exc.value.status_code == 400

    def test_blocks_glob(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT * FROM glob('/home/**')")
        assert exc.value.status_code == 400

    def test_blocks_http_get(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT * FROM http_get('http://evil.com')")
        assert exc.value.status_code == 400

    def test_blocks_write_csv(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT * FROM write_csv(train, '/tmp/out.csv')")
        assert exc.value.status_code == 400

    def test_blocks_current_setting(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT current_setting('access_mode')")
        assert exc.value.status_code == 400

    def test_blocks_begin_transaction(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("BEGIN TRANSACTION")
        assert exc.value.status_code == 400

    def test_blocks_grant(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("GRANT ALL ON train TO public")
        assert exc.value.status_code == 400

    def test_blocks_vacuum(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("VACUUM")
        assert exc.value.status_code == 400

    def test_case_insensitive_blocking(self):
        with pytest.raises(HTTPException):
            _validate_query("select * from Read_CSV_Auto('/etc/passwd')")

    def test_strips_trailing_semicolons(self):
        # A trailing semicolon is stripped before validation
        _validate_query("SELECT * FROM train;")

    def test_blocks_embedded_semicolons(self):
        with pytest.raises(HTTPException) as exc:
            _validate_query("SELECT * FROM train; DROP TABLE train")
        assert exc.value.status_code == 400
