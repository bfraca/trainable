# Trainable Agents — Architecture & Reference

Trainable uses **three specialized AI agents** — EDA, Prep, and Train — that share a common execution architecture but differ in their system prompts, goals, and validation rules. Each agent is a Claude instance running via the **Claude Agent SDK**, equipped with a single MCP tool (`execute_code`) that runs Python in an isolated Modal sandbox.

---

## Shared Architecture

All three agents share the same runtime pipeline:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │ SSE │   FastAPI     │ SDK │   Claude      │ MCP │   Modal      │
│  (Next.js)   │◄────│   Backend     │◄───►│   Agent       │────►│  Sandbox     │
│              │     │              │     │              │     │  (Python)    │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

### How an agent runs

1. **Trigger**: User clicks "Start EDA/Prep/Train" or sends a follow-up message.
2. **Backend** (`routers/sessions.py`) validates prerequisites and launches `run_agent()` as a background async task.
3. **Agent setup** (`services/agent.py`):
   - Loads the previous stage's report as context (prep reads EDA report, train reads prep report + metadata).
   - Builds a stage-specific **system prompt** with session/experiment IDs, user instructions, and previous context injected.
   - Creates a **per-call MCP server** with a bound `execute_code` tool handler (concurrency-safe — each run gets its own handler instance).
   - Initializes the Claude Agent SDK with `max_turns=30` and `bypassPermissions` mode.
4. **Agentic loop**: Claude generates Python code → calls `execute_code` → receives stdout/stderr → decides what to do next. This repeats up to 30 turns.
5. **Post-stage hooks**: After the agent finishes, the backend automatically runs validation, S3 sync, and metadata extraction.
6. **State update**: Session state transitions to `{stage}_done`.

### The `execute_code` tool

This is the **only tool** available to all three agents. It:

- Accepts a `code` string parameter (Python source code).
- Auto-saves the code as a numbered `.py` script to the stage's `scripts/` directory on the Modal Volume.
- Executes the code in a **Modal sandbox** — an isolated container with Python 3.11 and pre-installed ML libraries.
- The sandbox mounts the shared Modal Volume at `/data`, giving access to:
  - `/data/datasets/{experiment_id}/` — raw uploaded files
  - `/data/sessions/{session_id}/{stage}/` — stage workspace for outputs
- A `trainable` SDK module is injected into every execution, providing `log()` and `configure_dashboard()` for live metrics streaming.
- Returns stdout/stderr and exit code to the agent.
- Has a **10-minute timeout** per execution.

### Real-time communication

Every agent action is published to the frontend via **Server-Sent Events (SSE)**:

| Event               | When                     | Data                                           |
| ------------------- | ------------------------ | ---------------------------------------------- |
| `state_change`      | Stage starts/ends        | `{state: "eda_running"}`                       |
| `agent_message`     | Agent produces text      | `{text: "..."}`                                |
| `tool_start`        | Code execution begins    | `{tool: "execute_code", input: {code: "..."}}` |
| `tool_end`          | Code execution finishes  | `{tool: "execute_code", output: "..."}`        |
| `code_output`       | Stdout chunk streamed    | `{stream: "stdout", text: "..."}`              |
| `file_created`      | New file detected        | `{path, name, stage}`                          |
| `report_ready`      | Report.md content        | `{content: "...", stage}`                      |
| `files_ready`       | All stage files listed   | `{files: [...], stage}`                        |
| `metric`            | Training metric logged   | `{step, metrics, run}`                         |
| `chart_config`      | Dashboard layout defined | `{charts: [...]}`                              |
| `validation_result` | Post-stage validation    | `{passed, warnings, errors}`                   |
| `s3_sync_complete`  | Artifacts uploaded to S3 | `{files_synced, s3_prefix}`                    |
| `agent_error`       | Agent crashed            | `{error: "..."}`                               |
| `agent_aborted`     | User cancelled           | `{reason, stage}`                              |

---

## Agent 1: EDA (Exploratory Data Analysis)

**Purpose**: Understand the dataset — its shape, quality, distributions, and relationships — before any transformations.

**Entry state**: `created` → transitions to `eda_running`
**Exit state**: `eda_done`

### What it does

1. Lists dataset files at `/data/datasets/{experiment_id}/`
2. Loads and inspects the data (shape, dtypes, `.head()`, `.describe()`)
3. Performs statistical profiling:
   - Missing values (count + percentage per column)
   - Duplicate rows
   - Numeric columns: mean, std, min, max, skewness, outlier count (IQR method)
   - Categorical columns: cardinality, top values, rare categories (<1% frequency)
4. Identifies the likely **target column** and **problem type** (classification vs regression)
5. For classification targets: plots class distribution, reports balance ratio
6. For regression targets: plots distribution, reports skewness
7. Computes feature-target correlations (Pearson for numeric, chi-squared for categorical)
8. Checks for **data leakage** signals (perfect predictors, ID-like columns, date leakage)
9. Checks for **multicollinearity** (correlation heatmap, flags |r| > 0.9 pairs)
10. Creates visualizations (saved as PNGs to `figures/`)
11. Writes a comprehensive `report.md`

### Output artifacts

| Path                                    | Description                                       |
| --------------------------------------- | ------------------------------------------------- |
| `/data/sessions/{id}/eda/report.md`     | Markdown report with findings and recommendations |
| `/data/sessions/{id}/eda/figures/*.png` | Charts: distributions, correlations, heatmaps     |
| `/data/sessions/{id}/eda/data/`         | Summary CSVs, profiling outputs                   |
| `/data/sessions/{id}/eda/scripts/`      | Auto-saved Python scripts (step*01*\*.py, etc.)   |

### Key libraries used

pandas, numpy, matplotlib, seaborn, scikit-learn, duckdb (for large datasets >1M rows), statsmodels

### Critical rules

- Always check shape, dtypes, missing, duplicates
- Report per-column statistics for both numeric and categorical features
- Identify and flag data leakage risks
- Recommend target column and problem type in the report
- Use DuckDB for aggregation queries on large datasets

---

## Agent 2: Prep (Data Preparation)

**Purpose**: Clean, transform, and split the data into train/val/test sets ready for model training.

**Entry state**: `eda_done` → transitions to `prep_running`
**Exit state**: `prep_done`

### What it does

1. Reads the EDA report from the previous stage for context
2. Loads the raw dataset
3. Identifies target column and problem type
4. **Splits into train/val/test FIRST** (70/15/15, stratified for classification, random_state=42)
5. Handles missing values (fit imputer on train only, transform all splits)
6. Encodes categoricals:
   - One-hot for low cardinality (<10 unique values)
   - Target/ordinal encoding for high cardinality
   - Always fit on train set only
7. Engineers features if beneficial (interactions, polynomial, binning)
8. Removes duplicates from train only (never from val/test)
9. Scales/normalizes numeric features (fit on train only)
10. Validates: no nulls in output, consistent dtypes, same columns across splits
11. Saves processed data, metadata, and fitted pipeline

### Output artifacts

| Path                                              | Description                                 |
| ------------------------------------------------- | ------------------------------------------- |
| `/data/sessions/{id}/prep/data/train.parquet`     | Training set                                |
| `/data/sessions/{id}/prep/data/val.parquet`       | Validation set                              |
| `/data/sessions/{id}/prep/data/test.parquet`      | Test set                                    |
| `/data/sessions/{id}/prep/data/metadata.json`     | Target column, features, splits, transforms |
| `/data/sessions/{id}/prep/data/prep_pipeline.pkl` | Fitted sklearn Pipeline/ColumnTransformer   |
| `/data/sessions/{id}/prep/report.md`              | Decisions and statistics report             |
| `/data/sessions/{id}/prep/figures/`               | Distribution/transform visualizations       |
| `/data/sessions/{id}/prep/scripts/`               | Auto-saved Python scripts                   |

### metadata.json structure

```json
{
  "target_column": "...",
  "problem_type": "classification|regression",
  "features": ["..."],
  "categorical_features": ["..."],
  "numeric_features": ["..."],
  "n_classes": 3,
  "class_distribution": { "A": 100, "B": 50, "C": 30 },
  "splits": {
    "train": { "rows": 700 },
    "val": { "rows": 150 },
    "test": { "rows": 150 }
  },
  "transforms": {},
  "random_seed": 42,
  "original_shape": [1000, 15],
  "duplicates_removed": 5,
  "outliers_removed": 0
}
```

### Key libraries used

pandas, numpy, scikit-learn, pyarrow, duckdb, imbalanced-learn, category_encoders, pandera, statsmodels

### Critical rules — Data Leakage Prevention

This agent has the strictest rules of all three:

- **Split BEFORE transforms**: train/val/test split happens before any learned transformations
- **Fit on train only**: All transformers (scalers, encoders, imputers) are fitted on the training set, then applied to val/test
- **Never use target statistics from the full dataset**
- **Save the fitted pipeline** for reproducibility downstream
- **Verify schema consistency** across all three splits after transforms

### Post-stage hooks

After the prep agent completes:

1. **Validator** (`services/validator.py`): Checks that train/val/test parquet files exist, feature columns are consistent, metadata.json is valid
2. **S3 sync** (`services/s3_sync.py`): Uploads all prep artifacts to S3
3. **Metadata extractor** (`services/metadata_extractor.py`): Reads the processed data and stores column metadata in the `ProcessedDatasetMeta` DB table

---

## Agent 3: Train (Model Training)

**Purpose**: Train, tune, and evaluate ML models on the prepared data, producing a final model with explainability analysis.

**Entry state**: `prep_done` → transitions to `train_running`
**Exit state**: `train_done`

### What it does

1. Reads the prep report AND `metadata.json` for structured context (target column, problem type, class distribution)
2. Loads prepared data (train.parquet, val.parquet, test.parquet)
3. Trains **at least 2 different models** (e.g., LogisticRegression + RandomForest, or XGBoost + LightGBM)
4. Handles class imbalance if needed:
   - Tries `class_weight='balanced'` first
   - Then SMOTE (on train set only via imblearn)
   - Compares balanced vs imbalanced training
5. Tunes the most promising model with **Optuna** (30-50 trials) or sklearn cross-validation
6. Evaluates all models on **validation set** for comparison
7. Runs test set evaluation **exactly once** on the final selected model
8. Computes **SHAP feature importance** for the best model
9. Generates confusion matrix (classification) or residual plot (regression)
10. Saves model, metadata, and report

### Live metrics dashboard

The train agent is the only agent that uses the `trainable` SDK for real-time metrics streaming:

```python
from trainable import log, configure_dashboard

# Step 1: Define chart layout (once, before training)
configure_dashboard([
    {"title": "Loss", "metrics": ["train_loss", "val_loss"], "type": "line"},
    {"title": "Accuracy", "metrics": ["val_accuracy", "val_f1"], "type": "line"},
])

# Step 2: Log metrics every iteration
log(step=epoch, metrics={"train_loss": 0.5, "val_loss": 0.6}, run="xgboost")
```

How it works under the hood:

1. `log()` and `configure_dashboard()` print JSON to stdout
2. The sandbox streams stdout chunks in real-time
3. `services/metrics.py` parses JSON lines, persists to the `Metric` DB table, and publishes SSE events
4. The frontend's `MetricsTab` component renders live Recharts line charts

### Output artifacts

| Path                                           | Description                                   |
| ---------------------------------------------- | --------------------------------------------- |
| `/data/sessions/{id}/train/models/model.pkl`   | Best model (joblib serialized)                |
| `/data/sessions/{id}/train/data/metadata.json` | Model info, test metrics, feature importance  |
| `/data/sessions/{id}/train/report.md`          | Full training report                          |
| `/data/sessions/{id}/train/figures/`           | SHAP plots, confusion matrix, learning curves |
| `/data/sessions/{id}/train/scripts/`           | Auto-saved Python scripts                     |

### train metadata.json structure

```json
{
  "best_model": "XGBoost",
  "best_model_params": { "max_depth": 6, "learning_rate": 0.1 },
  "models_evaluated": ["LogisticRegression", "RandomForest", "XGBoost"],
  "test_metrics": { "accuracy": 0.92, "f1": 0.89, "roc_auc": 0.95 },
  "feature_importance": { "feature_1": 0.25, "feature_2": 0.18 },
  "class_imbalance_strategy": "class_weight=balanced",
  "tuning_method": "optuna",
  "tuning_trials": 50,
  "random_seed": 42
}
```

### Key libraries used

scikit-learn, xgboost, lightgbm, optuna, imbalanced-learn, shap, matplotlib, pandas, numpy, statsmodels, torch (optional), tensorflow (optional)

### Critical rules — Evaluation Integrity

- **Never train on val/test data**
- **Never use test metrics to choose between models** or tune hyperparameters
- Test set evaluation happens **exactly once** on the final selected model
- Cross-validation happens **only on the training set**
- SMOTE is applied **only to the training set**, never val/test

### Post-stage hooks

After the train agent completes:

1. **Validator** (`services/validator.py`): Checks that model.pkl exists, metrics were logged, metadata.json is valid
2. **S3 sync** (`services/s3_sync.py`): Uploads all train artifacts to S3

---

## Agent Lifecycle & Concurrency

### State machine

```
created
  │
  ├─► eda_running ──► eda_done
  │                      │
  │                      ├─► prep_running ──► prep_done
  │                      │                       │
  │                      │                       ├─► train_running ──► train_done
  │                      │                       │
  │                      │                       └─► failed / cancelled
  │                      │
  │                      └─► failed / cancelled
  │
  └─► failed / cancelled
```

Each stage requires the previous stage to be complete. The backend validates this before launching an agent.

### Concurrency model

- One agent runs per session at a time (tracked in `_running_tasks` dict).
- If a user sends a follow-up message while an agent is running, the current agent is **silently aborted** and a new one launches with conversation history.
- Abort is implemented via `asyncio.Task.cancel()` with a 5-second grace period.
- Each `run_agent()` call creates its own MCP server and tool handler — no shared mutable state between concurrent sessions.

### Follow-up messages

When a user sends a message with `run_agent: true`:

1. Any running agent for that session is silently cancelled (no abort SSE events).
2. Conversation history is loaded from the DB.
3. A new agent launches with the user's message as the prompt and prior messages appended to the system prompt.
4. The agent continues working in the context of the current stage.

---

## Pre-installed Sandbox Libraries

All three agents have access to the same sandbox environment:

| Category           | Libraries                                      |
| ------------------ | ---------------------------------------------- |
| Data               | pandas, numpy, pyarrow, openpyxl, duckdb       |
| Visualization      | matplotlib, seaborn                            |
| ML (classical)     | scikit-learn, xgboost, lightgbm                |
| ML (deep learning) | torch, torchvision, torchaudio, tensorflow-cpu |
| Tuning             | optuna                                         |
| Imbalance          | imbalanced-learn                               |
| Encoding           | category_encoders                              |
| Validation         | pandera                                        |
| Explainability     | shap                                           |
| Statistics         | statsmodels                                    |

### Sandbox configuration

- **Python version**: 3.11
- **Base image**: Debian Slim
- **Timeout**: 10 minutes per execution (600 seconds)
- **GPU**: Optional, passed via `gpu` parameter (e.g., `"T4"`, `"A10G"`)
- **Volume**: Modal Volume `trainable-data` mounted at `/data`
- **Stdout**: Unbuffered (`python -u`) for real-time streaming
