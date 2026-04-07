import { SSEEvent } from './types';

export const SSE_BASE =
  typeof window !== 'undefined'
    ? `http://${window.location.hostname}:8000`
    : 'http://localhost:8000';

const DEBUG_SSE = process.env.NODE_ENV === 'development';

/** Backoff configuration for SSE reconnection. */
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

export interface ConnectSSEOptions {
  onEvent: (event: SSEEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  /** Called when the connection is lost and a reconnect attempt is scheduled. */
  onReconnecting?: (attemptIn: number) => void;
  /** Called when a reconnect attempt succeeds after a previous failure. */
  onReconnected?: () => void;
}

/**
 * Open an SSE connection for a session with automatic reconnection and
 * exponential backoff (1 s → 2 s → 4 s → 8 s → … → 30 s max).
 *
 * Returns a cleanup function that tears down the connection *and* cancels
 * any pending reconnection timer.
 *
 * Usage:
 *   const disconnect = connectSSE('session-123', {
 *     onEvent:        (e) => handleEvent(e),
 *     onOpen:         () => setConnected(true),
 *     onError:        () => setConnected(false),
 *     onReconnecting: (ms) => setReconnecting(ms),
 *     onReconnected:  () => setReconnecting(null),
 *   });
 *   // later …
 *   disconnect();
 */
export function connectSSE(sessionId: string, opts: ConnectSSEOptions): () => void {
  const url = `${SSE_BASE}/api/sessions/${sessionId}/stream`;

  let backoff = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let source: EventSource | null = null;
  let disposed = false;
  /** True once a connection has succeeded at least once, so we know a
   *  subsequent failure is a *re*-connection scenario. */
  let hasConnectedOnce = false;

  function connect() {
    if (disposed) return;

    if (DEBUG_SSE) console.debug('[SSE] Connecting to', url);
    source = new EventSource(url);

    source.onopen = () => {
      if (DEBUG_SSE) console.debug('[SSE] Connected');
      // Reset backoff on successful connection
      backoff = INITIAL_BACKOFF_MS;
      if (hasConnectedOnce) {
        opts.onReconnected?.();
      }
      hasConnectedOnce = true;
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

      // Close this broken connection
      source?.close();
      source = null;

      // Only attempt reconnection if not intentionally disposed
      if (!disposed) {
        if (DEBUG_SSE) console.debug(`[SSE] Reconnecting in ${backoff}ms`);
        opts.onReconnecting?.(backoff);

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, backoff);

        // Exponential backoff with cap
        backoff = Math.min(backoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      }
    };
  }

  // Start the initial connection
  connect();

  // Return cleanup function
  return () => {
    disposed = true;
    if (DEBUG_SSE) console.debug('[SSE] Disconnecting');
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    source?.close();
    source = null;
  };
}
