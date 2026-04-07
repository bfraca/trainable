export interface Experiment {
  id: string;
  name: string;
  description: string;
  dataset_ref: string;
  instructions: string;
  created_at: string;
  latest_session_id: string | null;
  latest_state: string | null;
}

export interface Session {
  id: string;
  experiment_id: string;
  state: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Artifact {
  id: number;
  stage: string;
  artifact_type: string;
  name: string;
  path: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MetricPoint {
  step: number;
  name: string;
  value: number;
  stage?: string;
  run_tag?: string | null;
  created_at: string;
}

export interface ChartConfigEntry {
  title: string;
  metrics: string[];
  type: 'line' | 'bar' | 'area';
}

export interface ChartConfig {
  charts: ChartConfigEntry[];
}

export type Stage = 'eda' | 'prep' | 'train';

// ---------------------------------------------------------------------------
// SSE event discriminated union — every backend event type gets its own shape.
// The `type` field acts as the discriminant so TypeScript narrows `data`
// automatically inside a switch/case on `event.type`.
// ---------------------------------------------------------------------------

export interface StateChangeEvent {
  type: 'state_change';
  data: { state: string };
}
export interface AgentMessageEvent {
  type: 'agent_message';
  data: { text: string };
}
export interface AgentTokenEvent {
  type: 'agent_token';
  data: { text: string };
}
export interface ToolStartEvent {
  type: 'tool_start';
  data: { tool: string; input?: { code?: string } };
}
export interface ToolEndEvent {
  type: 'tool_end';
  data: { tool: string; output?: string };
}
export interface CodeOutputEvent {
  type: 'code_output';
  data: { text: string; stream: string };
}
export interface AgentErrorEvent {
  type: 'agent_error';
  data: { error: string };
}
export interface ReportReadyEvent {
  type: 'report_ready';
  data: { content: string; stage?: string };
}
export interface FilesReadyEvent {
  type: 'files_ready';
  data: { files: Array<{ path: string; type: string }>; stage?: string; workspace?: string };
}
export interface FileCreatedEvent {
  type: 'file_created';
  data: { path: string; name: string; type: string; stage?: string };
}
export interface AgentAbortedEvent {
  type: 'agent_aborted';
  data: { reason?: string; stage?: string };
}
export interface MetricsBatchEvent {
  type: 'metrics_batch';
  data: {
    items: Array<{
      step: number;
      name: string;
      value: number;
      stage?: string;
      run_tag?: string | null;
    }>;
  };
}
export interface MetricEvent {
  type: 'metric';
  data: {
    step: number;
    name: string;
    value: number;
    stage?: string;
    run_tag?: string | null;
  };
}
export interface ChartConfigEvent {
  type: 'chart_config';
  data: { charts: Array<{ title: string; metrics: string[]; type: string }> };
}
export interface UserMessageEvent {
  type: 'user_message';
  data: { content: string };
}
export interface ValidationResultEvent {
  type: 'validation_result';
  data: Record<string, unknown>;
}
export interface S3SyncCompleteEvent {
  type: 's3_sync_complete';
  data: { stage: string; files_synced: number; s3_prefix?: string };
}
export interface MetadataReadyEvent {
  type: 'metadata_ready';
  data: { session_id: string };
}

/** Union of every SSE event the backend can emit. */
export type SSEEvent =
  | StateChangeEvent
  | AgentMessageEvent
  | AgentTokenEvent
  | ToolStartEvent
  | ToolEndEvent
  | CodeOutputEvent
  | AgentErrorEvent
  | ReportReadyEvent
  | FilesReadyEvent
  | FileCreatedEvent
  | AgentAbortedEvent
  | MetricsBatchEvent
  | MetricEvent
  | ChartConfigEvent
  | UserMessageEvent
  | ValidationResultEvent
  | S3SyncCompleteEvent
  | MetadataReadyEvent;

export interface ExperimentDetail extends Experiment {
  sessions: Session[];
}

export interface SessionDetail extends Session {
  experiment: Experiment | null;
  messages: Message[];
  artifacts: Artifact[];
  processed_meta: Record<string, unknown> | null;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

// API response shapes
export interface CreateExperimentResponse extends Experiment {
  session_id: string;
  uploaded_files?: string[];
}
export interface StageStartResponse {
  status: string;
  state: string;
}
export interface DeleteResponse {
  status: string;
}
export interface AbortResponse {
  status: string;
}

export interface GeneratedFile {
  path: string;
  type: string;
}
