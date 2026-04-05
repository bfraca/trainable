"""Tests for services/metrics.py — metric parsing from stdout and persistence."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from services.metrics import parse_metric_lines, parse_stdout_line

# ---------------------------------------------------------------------------
# parse_stdout_line — single metric format
# ---------------------------------------------------------------------------


class TestParseStdoutLineSingleMetric:
    def test_single_metric(self):
        line = json.dumps({"step": 1, "metric": "loss", "value": 0.5})
        result = parse_stdout_line(line)
        assert result["type"] == "metrics"
        assert len(result["items"]) == 1
        assert result["items"][0] == {
            "step": 1,
            "name": "loss",
            "value": 0.5,
            "run_tag": None,
        }

    def test_single_metric_with_run_tag(self):
        line = json.dumps({"step": 3, "metric": "acc", "value": 0.92, "run": "xgboost"})
        result = parse_stdout_line(line)
        assert result["items"][0]["run_tag"] == "xgboost"
        assert result["items"][0]["step"] == 3

    def test_single_metric_string_value_rejected(self):
        line = json.dumps({"step": 1, "metric": "loss", "value": "not_a_number"})
        result = parse_stdout_line(line)
        assert result is None


# ---------------------------------------------------------------------------
# parse_stdout_line — batch metric format
# ---------------------------------------------------------------------------


class TestParseStdoutLineBatchMetrics:
    def test_batch_metrics(self):
        line = json.dumps({"step": 5, "metrics": {"loss": 0.3, "acc": 0.85}})
        result = parse_stdout_line(line)
        assert result["type"] == "metrics"
        assert len(result["items"]) == 2
        names = {item["name"] for item in result["items"]}
        assert names == {"loss", "acc"}
        for item in result["items"]:
            assert item["step"] == 5
            assert item["run_tag"] is None

    def test_batch_metrics_with_run(self):
        line = json.dumps({"step": 10, "metrics": {"rmse": 1.2}, "run": "lightgbm"})
        result = parse_stdout_line(line)
        assert result["items"][0]["run_tag"] == "lightgbm"

    def test_batch_metrics_skips_non_numeric(self):
        line = json.dumps(
            {"step": 1, "metrics": {"loss": 0.5, "name": "test", "acc": 0.9}}
        )
        result = parse_stdout_line(line)
        assert len(result["items"]) == 2
        names = {item["name"] for item in result["items"]}
        assert "name" not in names

    def test_batch_metrics_empty_dict(self):
        line = json.dumps({"step": 1, "metrics": {}})
        result = parse_stdout_line(line)
        assert result is None  # no items -> None


# ---------------------------------------------------------------------------
# parse_stdout_line — chart_config format
# ---------------------------------------------------------------------------


class TestParseStdoutLineChartConfig:
    def test_chart_config(self):
        config = {
            "charts": [
                {"title": "Loss", "metrics": ["train_loss", "val_loss"], "type": "line"}
            ]
        }
        line = json.dumps({"chart_config": config})
        result = parse_stdout_line(line)
        assert result["type"] == "chart_config"
        assert result["config"] == config

    def test_chart_config_non_dict_ignored(self):
        line = json.dumps({"chart_config": "not a dict"})
        result = parse_stdout_line(line)
        # chart_config must be a dict, and no "step" key -> returns None
        assert result is None


# ---------------------------------------------------------------------------
# parse_stdout_line — edge cases
# ---------------------------------------------------------------------------


class TestParseStdoutLineEdgeCases:
    def test_non_json_line(self):
        assert parse_stdout_line("hello world") is None

    def test_empty_line(self):
        assert parse_stdout_line("") is None

    def test_whitespace_line(self):
        assert parse_stdout_line("   ") is None

    def test_json_without_step(self):
        assert parse_stdout_line(json.dumps({"foo": "bar"})) is None

    def test_invalid_step_type(self):
        assert (
            parse_stdout_line(
                json.dumps({"step": "not_int", "metric": "loss", "value": 0.5})
            )
            is None
        )

    def test_line_with_leading_whitespace(self):
        line = "  " + json.dumps({"step": 1, "metric": "loss", "value": 0.5})
        # leading whitespace means it doesn't start with '{' after strip — wait,
        # parse_stdout_line strips first
        result = parse_stdout_line(line)
        assert result is not None
        assert result["items"][0]["value"] == 0.5

    def test_broken_json(self):
        assert parse_stdout_line('{"step": 1, "metric": ') is None

    def test_integer_value_converted_to_float(self):
        line = json.dumps({"step": 1, "metric": "epochs", "value": 10})
        result = parse_stdout_line(line)
        assert result["items"][0]["value"] == 10.0
        assert isinstance(result["items"][0]["value"], float)


# ---------------------------------------------------------------------------
# parse_metric_lines — multi-line wrapper
# ---------------------------------------------------------------------------


class TestParseMetricLines:
    def test_multiple_lines(self):
        text = "\n".join(
            [
                json.dumps({"step": 1, "metric": "loss", "value": 0.5}),
                "some regular output",
                json.dumps({"step": 2, "metrics": {"loss": 0.3, "acc": 0.85}}),
                json.dumps({"chart_config": {"charts": []}}),  # chart config is skipped
            ]
        )
        results = parse_metric_lines(text)
        assert len(results) == 3  # 1 from line 1, 2 from line 3
        assert results[0]["step"] == 1
        assert results[1]["step"] == 2
        assert results[2]["step"] == 2

    def test_empty_text(self):
        assert parse_metric_lines("") == []

    def test_no_metrics(self):
        assert parse_metric_lines("just some output\nnothing here") == []


# ---------------------------------------------------------------------------
# persist_and_publish
# ---------------------------------------------------------------------------


class TestPersistAndPublish:
    @pytest.mark.asyncio
    async def test_persist_and_publish_publishes_events(self, setup_db):
        """persist_and_publish sends SSE events and persists Metric rows."""
        from services.metrics import persist_and_publish

        parsed = [
            {"step": 1, "name": "loss", "value": 0.5, "run_tag": None},
            {"step": 2, "name": "loss", "value": 0.3, "run_tag": "xgb"},
        ]

        with patch("services.metrics.broadcaster") as mock_broadcaster:
            mock_broadcaster.publish = AsyncMock()
            await persist_and_publish("sess-1", "train", parsed)

            assert mock_broadcaster.publish.call_count == 1
            # Verify batched event
            first_call = mock_broadcaster.publish.call_args_list[0]
            assert first_call[0][0] == "sess-1"
            event = first_call[0][1]
            assert event["type"] == "metrics_batch"
            items = event["data"]["items"]
            assert len(items) == 2
            assert items[0]["step"] == 1
            assert items[0]["name"] == "loss"
            assert items[0]["stage"] == "train"

    @pytest.mark.asyncio
    async def test_persist_and_publish_empty_list(self):
        from services.metrics import persist_and_publish

        with patch("services.metrics.broadcaster") as mock_broadcaster:
            mock_broadcaster.publish = AsyncMock()
            await persist_and_publish("sess-1", "train", [])
            mock_broadcaster.publish.assert_not_called()


# ---------------------------------------------------------------------------
# publish_chart_config
# ---------------------------------------------------------------------------


class TestPublishChartConfig:
    @pytest.mark.asyncio
    async def test_publish_chart_config(self):
        config = {"charts": [{"title": "Loss", "metrics": ["loss"], "type": "line"}]}

        with patch("services.metrics.broadcaster") as mock_broadcaster:
            mock_broadcaster.publish = AsyncMock()
            from services.metrics import publish_chart_config

            await publish_chart_config("sess-1", config)

            mock_broadcaster.publish.assert_called_once_with(
                "sess-1",
                {
                    "type": "chart_config",
                    "data": config,
                },
            )
