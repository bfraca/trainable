import type {
  Experiment,
  ExperimentDetail,
  CreateExperimentResponse,
  Session,
  SessionDetail,
  Message,
  Artifact,
  MetricPoint,
  FileTreeNode,
  StageStartResponse,
  DeleteResponse,
  AbortResponse,
} from './types';

const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  // Experiments
  listExperiments: () => fetchJSON<Experiment[]>('/experiments'),

  createExperiment: async (data: FormData): Promise<CreateExperimentResponse> => {
    const res = await fetch(`${API_BASE}/experiments`, {
      method: 'POST',
      body: data,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },

  createExperimentFromS3: async (data: FormData): Promise<CreateExperimentResponse> => {
    const res = await fetch(`${API_BASE}/experiments/from-s3`, {
      method: 'POST',
      body: data,
    });
    if (!res.ok) throw new Error(`Create failed: ${res.status}`);
    return res.json();
  },

  getExperiment: (id: string) => fetchJSON<ExperimentDetail>(`/experiments/${id}`),

  deleteExperiment: (id: string) =>
    fetchJSON<DeleteResponse>(`/experiments/${id}`, { method: 'DELETE' }),

  // Sessions
  createSession: (experimentId: string) =>
    fetchJSON<Session>(`/experiments/${experimentId}/sessions`, { method: 'POST' }),

  getSession: (id: string) => fetchJSON<SessionDetail>(`/sessions/${id}`),

  sendMessage: (sessionId: string, content: string, runAgent: boolean = false) =>
    fetchJSON<Message>(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, run_agent: runAgent }),
    }),

  getMessages: (sessionId: string) => fetchJSON<Message[]>(`/sessions/${sessionId}/messages`),

  startStage: (sessionId: string, stage: string, gpu?: string, instructions?: string) =>
    fetchJSON<StageStartResponse>(`/sessions/${sessionId}/stages/${stage}/start`, {
      method: 'POST',
      body: JSON.stringify({ gpu: gpu || null, instructions: instructions || null }),
    }),

  getArtifacts: (sessionId: string) => fetchJSON<Artifact[]>(`/sessions/${sessionId}/artifacts`),

  getMetrics: (sessionId: string) => fetchJSON<MetricPoint[]>(`/sessions/${sessionId}/metrics`),

  abortSession: (sessionId: string) =>
    fetchJSON<AbortResponse>(`/sessions/${sessionId}/abort`, { method: 'POST' }),

  // Files
  getFileTree: (sessionId: string) =>
    fetchJSON<FileTreeNode>(`/files/tree?root=/sessions/${sessionId}`),

  readFile: (path: string) =>
    fetchJSON<{ path: string; content: string }>(`/files/read?path=${encodeURIComponent(path)}`),
};
