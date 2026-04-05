"""Tests for models.py — ORM model to_dict() methods and utility functions."""

from models import (
    Artifact,
    Experiment,
    Message,
    Metric,
    ProcessedDatasetMeta,
    Session,
    SessionState,
    utcnow,
)

# ---------------------------------------------------------------------------
# utcnow
# ---------------------------------------------------------------------------


def test_utcnow_returns_utc():
    from datetime import timezone

    dt = utcnow()
    assert dt.tzinfo == timezone.utc


# ---------------------------------------------------------------------------
# SessionState enum
# ---------------------------------------------------------------------------


class TestSessionState:
    def test_values(self):
        assert SessionState.CREATED == "created"
        assert SessionState.EDA_RUNNING == "eda_running"
        assert SessionState.TRAIN_DONE == "train_done"
        assert SessionState.FAILED == "failed"
        assert SessionState.CANCELLED == "cancelled"

    def test_is_string(self):
        assert isinstance(SessionState.CREATED, str)


# ---------------------------------------------------------------------------
# Experiment.to_dict
# ---------------------------------------------------------------------------


class TestExperimentToDict:
    def test_basic_fields(self):
        exp = Experiment(
            id="exp-1",
            name="Test Experiment",
            description="A test",
            dataset_ref="s3://datasets/test",
            instructions="Do things",
            created_at="2024-01-01T00:00:00",
        )
        d = exp.to_dict()
        assert d["id"] == "exp-1"
        assert d["name"] == "Test Experiment"
        assert d["description"] == "A test"
        assert d["dataset_ref"] == "s3://datasets/test"
        assert d["instructions"] == "Do things"
        assert d["latest_session_id"] is None
        assert d["latest_state"] is None

    def test_with_sessions(self):
        exp = Experiment(
            id="exp-1", name="Test", dataset_ref="s3://test", created_at="2024-01-01"
        )
        s1 = Session(
            id="s1",
            experiment_id="exp-1",
            state="eda_done",
            created_at="2024-01-01T01:00:00",
        )
        s2 = Session(
            id="s2",
            experiment_id="exp-1",
            state="train_running",
            created_at="2024-01-01T02:00:00",
        )

        d = exp.to_dict(sessions=[s1, s2])
        assert d["latest_session_id"] == "s2"
        assert d["latest_state"] == "train_running"

    def test_no_sessions(self):
        exp = Experiment(
            id="exp-1", name="Test", dataset_ref="s3://test", created_at="2024-01-01"
        )
        d = exp.to_dict(sessions=[])
        assert d["latest_session_id"] is None

    def test_none_description(self):
        exp = Experiment(
            id="exp-1",
            name="Test",
            dataset_ref="s3://test",
            description=None,
            created_at="2024-01-01",
        )
        d = exp.to_dict()
        assert d["description"] == ""


# ---------------------------------------------------------------------------
# Session.to_dict
# ---------------------------------------------------------------------------


class TestSessionToDict:
    def test_basic_fields(self):
        s = Session(
            id="s-1",
            experiment_id="exp-1",
            state="eda_running",
            created_at="2024-01-01T00:00:00",
            updated_at="2024-01-01T01:00:00",
        )
        d = s.to_dict()
        assert d["id"] == "s-1"
        assert d["experiment_id"] == "exp-1"
        assert d["state"] == "eda_running"
        assert d["created_at"] == "2024-01-01T00:00:00"
        assert d["updated_at"] == "2024-01-01T01:00:00"


# ---------------------------------------------------------------------------
# Message.to_dict
# ---------------------------------------------------------------------------


class TestMessageToDict:
    def test_basic_fields(self):
        m = Message(
            id=1,
            session_id="s-1",
            role="user",
            content="Hello",
            metadata_={"event_type": "user_message"},
            created_at="2024-01-01T00:00:00",
        )
        d = m.to_dict()
        assert d["id"] == 1
        assert d["role"] == "user"
        assert d["content"] == "Hello"
        assert d["metadata"] == {"event_type": "user_message"}

    def test_none_metadata(self):
        m = Message(
            id=1,
            session_id="s-1",
            role="user",
            content="Hi",
            metadata_=None,
            created_at="2024-01-01",
        )
        d = m.to_dict()
        assert d["metadata"] == {}


# ---------------------------------------------------------------------------
# Artifact.to_dict
# ---------------------------------------------------------------------------


class TestArtifactToDict:
    def test_basic_fields(self):
        a = Artifact(
            id=1,
            session_id="s-1",
            stage="eda",
            artifact_type="chart",
            name="plot.png",
            path="/sessions/s-1/eda/figures/plot.png",
            s3_path="s3://datasets/experiments/exp-1/plot.png",
            metadata_={"width": 800},
            created_at="2024-01-01T00:00:00",
        )
        d = a.to_dict()
        assert d["id"] == 1
        assert d["stage"] == "eda"
        assert d["artifact_type"] == "chart"
        assert d["name"] == "plot.png"
        assert d["s3_path"] == "s3://datasets/experiments/exp-1/plot.png"

    def test_none_s3_path(self):
        a = Artifact(
            id=1,
            session_id="s-1",
            stage="eda",
            artifact_type="chart",
            name="plot.png",
            path="/path",
            s3_path=None,
            created_at="2024-01-01",
        )
        d = a.to_dict()
        assert d["s3_path"] is None

    def test_none_metadata(self):
        a = Artifact(
            id=1,
            session_id="s-1",
            stage="eda",
            artifact_type="chart",
            name="plot.png",
            path="/path",
            metadata_=None,
            created_at="2024-01-01",
        )
        d = a.to_dict()
        assert d["metadata"] == {}


# ---------------------------------------------------------------------------
# Metric.to_dict
# ---------------------------------------------------------------------------


class TestMetricToDict:
    def test_basic_fields(self):
        m = Metric(
            id=1,
            session_id="s-1",
            stage="train",
            step=5,
            name="loss",
            value=0.35,
            run_tag="xgboost",
            created_at="2024-01-01T00:00:00",
        )
        d = m.to_dict()
        assert d["step"] == 5
        assert d["name"] == "loss"
        assert d["value"] == 0.35
        assert d["stage"] == "train"
        assert d["run_tag"] == "xgboost"

    def test_none_run_tag(self):
        m = Metric(
            id=1,
            session_id="s-1",
            stage="train",
            step=1,
            name="acc",
            value=0.9,
            run_tag=None,
            created_at="2024-01-01",
        )
        d = m.to_dict()
        assert d["run_tag"] is None


# ---------------------------------------------------------------------------
# ProcessedDatasetMeta.to_dict
# ---------------------------------------------------------------------------


class TestProcessedDatasetMetaToDict:
    def test_basic_fields(self):
        meta = ProcessedDatasetMeta(
            id=1,
            session_id="s-1",
            experiment_id="exp-1",
            columns=[{"name": "x", "dtype": "float64"}],
            feature_columns=["x"],
            target_column="y",
            total_rows=100,
            train_rows=70,
            val_rows=15,
            test_rows=15,
            quality_stats={"missing_pct": {}},
            source_files=["/data/raw.csv"],
            output_files=[{"name": "train.parquet"}],
            s3_synced="done",
            s3_prefix="s3://bucket/prefix",
            created_at="2024-01-01T00:00:00",
        )
        d = meta.to_dict()
        assert d["session_id"] == "s-1"
        assert d["experiment_id"] == "exp-1"
        assert d["target_column"] == "y"
        assert d["total_rows"] == 100
        assert d["train_rows"] == 70
        assert d["s3_synced"] == "done"
        assert isinstance(d["columns"], list)
        assert isinstance(d["feature_columns"], list)

    def test_none_fields_default_to_empty(self):
        meta = ProcessedDatasetMeta(
            id=1,
            session_id="s-1",
            experiment_id="exp-1",
            columns=None,
            feature_columns=None,
            total_rows=0,
            quality_stats=None,
            source_files=None,
            output_files=None,
            created_at="2024-01-01",
        )
        d = meta.to_dict()
        assert d["columns"] == []
        assert d["feature_columns"] == []
        assert d["quality_stats"] == {}
        assert d["source_files"] == []
        assert d["output_files"] == []
