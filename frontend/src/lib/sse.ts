import { SSEEvent } from './types';

const SSE_BASE =
  typeof window !== 'undefined'
    ? `http://${window.location.hostname}:8000`
    : 'http://localhost:8000';

const DEBUG_SSE = process.env.NODE_ENV === 'development';

export function connectSSE(
  sessionId: string,
  onEvent: (event: SSEEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const url = `${SSE_BASE}/api/sessions/${sessionId}/stream`;
  if (DEBUG_SSE) console.debug('[SSE] Connecting to', url);
  const source = new EventSource(url);

  source.onopen = () => {
    if (DEBUG_SSE) console.debug('[SSE] Connected');
  };

  source.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data) as SSEEvent;
      if (DEBUG_SSE) console.debug('[SSE] Event:', parsed.type);
      onEvent(parsed);
    } catch {
      if (DEBUG_SSE) console.debug('[SSE] Failed to parse:', e.data);
    }
  };

  source.onerror = (e) => {
    console.error('[SSE] Connection error:', e);
    onError?.(e);
  };

  return () => {
    if (DEBUG_SSE) console.debug('[SSE] Disconnecting');
    source.close();
  };
}
