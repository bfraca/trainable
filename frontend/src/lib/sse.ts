import { SSEEvent } from './types';

export const SSE_BASE =
  typeof window !== 'undefined'
    ? `http://${window.location.hostname}:8000`
    : 'http://localhost:8000';

const DEBUG_SSE = process.env.NODE_ENV === 'development';

export interface ConnectSSEOptions {
  onEvent: (event: SSEEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

/**
 * Open an SSE connection for a session and return a cleanup function.
 *
 * Usage:
 *   const disconnect = connectSSE('session-123', {
 *     onEvent: (e) => handleEvent(e),
 *     onOpen:  () => setConnected(true),
 *     onError: () => setConnected(false),
 *   });
 *   // later …
 *   disconnect();
 */
export function connectSSE(sessionId: string, opts: ConnectSSEOptions): () => void {
  const url = `${SSE_BASE}/api/sessions/${sessionId}/stream`;
  if (DEBUG_SSE) console.debug('[SSE] Connecting to', url);
  const source = new EventSource(url);

  source.onopen = () => {
    if (DEBUG_SSE) console.debug('[SSE] Connected');
    opts.onOpen?.();
  };

  source.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data) as SSEEvent;
      if (DEBUG_SSE) console.debug('[SSE] Event:', parsed.type);
      opts.onEvent(parsed);
    } catch {
      if (DEBUG_SSE) console.debug('[SSE] Failed to parse:', e.data);
    }
  };

  source.onerror = (e) => {
    console.error('[SSE] Connection error:', e);
    opts.onError?.(e);
  };

  return () => {
    if (DEBUG_SSE) console.debug('[SSE] Disconnecting');
    source.close();
  };
}
