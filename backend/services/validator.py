"""Automated post-agent validation for prep and train outputs.

Runs independently of the agent — reads output files directly from Modal Volume
and checks for common ML quality issues.
"""

import io
import json
import logging

import pandas as pd
import pyarrow.parquet as pq

from services.volume import read_volume_file, reload_volume

logger = logging.getLogger(__name__)


def _read_volume_file_safe(path: str):
    """Read a file from volume, returning None on failure."""
    try:
        return read_volume_file(path)
    except Exception:
        return None


async def validate_prep_output(session_id: str, experiment_id: str) -> dict:
    """Validate prep stage outputs. Returns dict with errors, warnings, passed checks."""
    reload_volume()

    data_dir = f"/sessions/{session_id}/prep/data"
    results = {"errors": [], "warnings": [], "passed": [], "stage": "prep"}

    # 1. Check parquet files exist and are readable
    splits = {}
    for name in ["train", "val", "test"]:
        path = f"{data_dir}/{name}.parquet"
        raw = _read_volume_file_safe(path)
        if raw is None:
            results["errors"].append(f"{name}.parquet missing or unreadable")
        else:
            splits[name] = raw
            results["passed"].append(f"{name}.parquet exists ({len(raw)} bytes)")

    if not splits:
        results["errors"].append("No parquet splits found — cannot continue validation")
        return results

    # 2. Read schemas and row counts
    schemas = {}
    row_counts = {}
    for name, raw in splits.items():
        try:
            pf = pq.ParquetFile(io.BytesIO(raw))
            schemas[name] = set((f.name, str(f.type)) for f in pf.schema_arrow)
            row_counts[name] = pf.metadata.num_rows
        except Exception as e:
            results["errors"].append(f"{name}.parquet schema read failed: {e}")

    # 3. Schema consistency across splits
    if len(schemas) > 1:
        ref_name = list(schemas.keys())[0]
        ref_schema = schemas[ref_name]
        for name, schema in schemas.items():
            if name == ref_name:
                continue
            if schema == ref_schema:
                results["passed"].append(f"{name} schema matches {ref_name}")
            else:
                missing = ref_schema - schema
                extra = schema - ref_schema
                msg = f"{name} schema differs from {ref_name}"
                if missing:
                    msg += f" (missing: {[c[0] for c in missing]})"
                if extra:
                    msg += f" (extra: {[c[0] for c in extra]})"
                results["errors"].append(msg)

    # 4. Check for nulls (sample-based for efficiency)
    if "train" in splits:
        try:
            train_df = pd.read_parquet(io.BytesIO(splits["train"]))
            null_counts = train_df.isnull().sum()
            null_cols = null_counts[null_counts > 0]
            if len(null_cols) == 0:
                results["passed"].append("No null values in train split")
            else:
                for col, count in null_cols.items():
                    results["errors"].append(
                        f"Null values in train.{col}: {count} rows"
                    )
        except Exception as e:
            results["warnings"].append(f"Could not check nulls: {e}")

    # 5. Check split ratios
    total = sum(row_counts.values())
    if total > 0 and len(row_counts) == 3:
        train_ratio = row_counts.get("train", 0) / total
        val_ratio = row_counts.get("val", 0) / total
        test_ratio = row_counts.get("test", 0) / total
        if 0.60 <= train_ratio <= 0.80:
            results["passed"].append(
                f"Train ratio {train_ratio:.2f} within expected range"
            )
        else:
            results["warnings"].append(
                f"Train ratio {train_ratio:.2f} outside expected 0.60-0.80"
            )
        if val_ratio < 0.05 or test_ratio < 0.05:
            results["warnings"].append(
                f"Small split detected: val={val_ratio:.2f}, test={test_ratio:.2f}"
            )

    # 6. Check for data leakage (hash-based row overlap)
    if "train" in splits and "test" in splits:
        try:
            train_df = pd.read_parquet(io.BytesIO(splits["train"]))
            test_df = pd.read_parquet(io.BytesIO(splits["test"]))
            # Hash rows for comparison (sample for large datasets)
            sample_size = min(1000, len(train_df), len(test_df))
            train_sample = (
                train_df.sample(n=sample_size, random_state=42)
                if len(train_df) > sample_size
                else train_df
            )
            test_sample = (
                test_df.sample(n=sample_size, random_state=42)
                if len(test_df) > sample_size
                else test_df
            )
            train_hashes = set(pd.util.hash_pandas_object(train_sample).values)
            test_hashes = set(pd.util.hash_pandas_object(test_sample).values)
            overlap = train_hashes & test_hashes
            if len(overlap) == 0:
                results["passed"].append(
                    "No row overlap detected between train and test"
                )
            else:
                results["errors"].append(
                    f"Potential data leakage: {len(overlap)} overlapping row hashes between train and test"
                )
        except Exception as e:
            results["warnings"].append(f"Could not check leakage: {e}")

    # 7. Check for constant columns
    if "train" in splits:
        try:
            train_df = pd.read_parquet(io.BytesIO(splits["train"]))
            constant_cols = [
                col for col in train_df.columns if train_df[col].nunique() <= 1
            ]
            if constant_cols:
                results["warnings"].append(
                    f"Constant columns (zero variance): {constant_cols}"
                )
            else:
                results["passed"].append("No constant columns found")
        except Exception:
            pass

    # 8. Check metadata.json exists
    metadata_raw = _read_volume_file_safe(f"{data_dir}/metadata.json")
    if metadata_raw:
        try:
            meta = json.loads(metadata_raw)
            required_keys = ["target_column", "problem_type", "features", "splits"]
            missing_keys = [k for k in required_keys if k not in meta]
            if missing_keys:
                results["warnings"].append(
                    f"metadata.json missing keys: {missing_keys}"
                )
            else:
                results["passed"].append("metadata.json exists with required keys")

            # Check target column exists in splits
            target = meta.get("target_column")
            if target and schemas:
                first_schema_cols = [c[0] for c in list(schemas.values())[0]]
                if target in first_schema_cols:
                    results["passed"].append(f"Target column '{target}' found in data")
                else:
                    results["errors"].append(
                        f"Target column '{target}' not found in parquet columns"
                    )
        except json.JSONDecodeError:
            results["warnings"].append("metadata.json exists but is not valid JSON")
    else:
        results["warnings"].append(
            "metadata.json not found — agent should produce structured metadata"
        )

    return results


async def validate_train_output(session_id: str, experiment_id: str) -> dict:
    """Validate train stage outputs."""
    reload_volume()

    workspace = f"/sessions/{session_id}/train"
    results = {"errors": [], "warnings": [], "passed": [], "stage": "train"}

    # 1. Check model file exists
    model_found = False
    for ext in [".pkl", ".joblib", ".pt", ".h5", ".onnx"]:
        model_raw = _read_volume_file_safe(f"{workspace}/models/model{ext}")
        if model_raw:
            model_found = True
            results["passed"].append(
                f"Model file found: model{ext} ({len(model_raw)} bytes)"
            )
            break
    if not model_found:
        results["errors"].append("No model file found in models/ directory")

    # 2. Check report exists
    report_raw = _read_volume_file_safe(f"{workspace}/report.md")
    if report_raw:
        results["passed"].append(f"report.md exists ({len(report_raw)} bytes)")
    else:
        results["warnings"].append("report.md not found")

    # 3. Check metadata.json
    metadata_raw = _read_volume_file_safe(f"{workspace}/data/metadata.json")
    if metadata_raw:
        try:
            meta = json.loads(metadata_raw)
            if "best_model" in meta and "test_metrics" in meta:
                results["passed"].append("metadata.json has model and test metrics")

                # Check for suspicious metrics (overfitting / broken)
                for metric_name, value in meta.get("test_metrics", {}).items():
                    if isinstance(value, (int, float)):
                        if value == 1.0 and metric_name in (
                            "accuracy",
                            "f1",
                            "r2",
                            "roc_auc",
                        ):
                            results["warnings"].append(
                                f"Perfect {metric_name}=1.0 on test set — possible overfitting"
                            )
                        if value == 0.0 and metric_name in ("accuracy", "f1", "r2"):
                            results["warnings"].append(
                                f"{metric_name}=0.0 on test set — possible broken model"
                            )
            else:
                results["warnings"].append(
                    "metadata.json missing 'best_model' or 'test_metrics'"
                )
        except json.JSONDecodeError:
            results["warnings"].append("metadata.json is not valid JSON")
    else:
        results["warnings"].append("metadata.json not found")

    return results
