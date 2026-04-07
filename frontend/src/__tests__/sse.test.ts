import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectSSE } from '@/lib/sse';

// --------------------------------------------------------------------------
// Mock EventSource
// --------------------------------------------------------------------------
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0; // CONNECTING
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  /** Simulate a successful open. */
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.(new Event('open'));
  }

  /** Simulate an incoming message. */
  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** Simulate a connection error. */
  simulateError() {
    this.readyState = 2; // CLOSED
    this.onerror?.(new Event('error'));
  }
}

describe('connectSSE', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens an EventSource to the correct URL', () => {
    const onEvent = vi.fn();
    connectSSE('session-1', { onEvent });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('/api/sessions/session-1/stream');
  });

  it('calls onOpen when connection succeeds', () => {
    const onOpen = vi.fn();
    connectSSE('s1', { onEvent: vi.fn(), onOpen });

    MockEventSource.instances[0].simulateOpen();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('dispatches parsed SSE events to onEvent', () => {
    const onEvent = vi.fn();
    connectSSE('s1', { onEvent });

    MockEventSource.instances[0].simulateOpen();
    MockEventSource.instances[0].simulateMessage(
      JSON.stringify({ type: 'message', data: { id: '1', content: 'hello' } }),
    );

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'message' }));
  });

  it('reconnects with exponential backoff on error', () => {
    const onReconnecting = vi.fn();
    connectSSE('s1', { onEvent: vi.fn(), onReconnecting });

    const first = MockEventSource.instances[0];
    first.simulateOpen();

    // First error → 1s backoff
    first.simulateError();
    expect(onReconnecting).toHaveBeenCalledWith(1000);
    expect(first.close).toHaveBeenCalled();

    // Advance 1s → second EventSource created
    vi.advanceTimersByTime(1000);
    expect(MockEventSource.instances).toHaveLength(2);

    // Second error → 2s backoff
    MockEventSource.instances[1].simulateError();
    expect(onReconnecting).toHaveBeenCalledWith(2000);

    // Advance 2s → third EventSource
    vi.advanceTimersByTime(2000);
    expect(MockEventSource.instances).toHaveLength(3);

    // Third error → 4s backoff
    MockEventSource.instances[2].simulateError();
    expect(onReconnecting).toHaveBeenCalledWith(4000);
  });

  it('caps backoff at 30 seconds', () => {
    const onReconnecting = vi.fn();
    connectSSE('s1', { onEvent: vi.fn(), onReconnecting });

    MockEventSource.instances[0].simulateOpen();

    // Simulate many errors to reach the cap
    for (let i = 0; i < 10; i++) {
      const latest = MockEventSource.instances[MockEventSource.instances.length - 1];
      latest.simulateError();
      const lastCall = onReconnecting.mock.calls[onReconnecting.mock.calls.length - 1][0];
      expect(lastCall).toBeLessThanOrEqual(30_000);
      vi.advanceTimersByTime(lastCall);
    }
  });

  it('calls onReconnected when reconnection succeeds', () => {
    const onReconnected = vi.fn();
    connectSSE('s1', { onEvent: vi.fn(), onReconnected });

    // First successful connection — onReconnected should NOT fire
    MockEventSource.instances[0].simulateOpen();
    expect(onReconnected).not.toHaveBeenCalled();

    // Error + reconnect
    MockEventSource.instances[0].simulateError();
    vi.advanceTimersByTime(1000);

    // Second successful connection — onReconnected SHOULD fire
    MockEventSource.instances[1].simulateOpen();
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it('resets backoff after a successful reconnection', () => {
    const onReconnecting = vi.fn();
    connectSSE('s1', { onEvent: vi.fn(), onReconnecting });

    MockEventSource.instances[0].simulateOpen();

    // First error → 1s
    MockEventSource.instances[0].simulateError();
    expect(onReconnecting).toHaveBeenLastCalledWith(1000);
    vi.advanceTimersByTime(1000);

    // Reconnect succeeds → backoff should reset
    MockEventSource.instances[1].simulateOpen();

    // Next error → should be 1s again (reset), not 2s
    MockEventSource.instances[1].simulateError();
    expect(onReconnecting).toHaveBeenLastCalledWith(1000);
  });

  it('stops reconnecting when disposed', () => {
    const disconnect = connectSSE('s1', { onEvent: vi.fn() });

    MockEventSource.instances[0].simulateOpen();
    MockEventSource.instances[0].simulateError();

    // Dispose before timer fires
    disconnect();

    vi.advanceTimersByTime(10000);

    // No new EventSource should have been created
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it('closes the EventSource on dispose', () => {
    const disconnect = connectSSE('s1', { onEvent: vi.fn() });
    const source = MockEventSource.instances[0];
    source.simulateOpen();

    disconnect();
    expect(source.close).toHaveBeenCalled();
  });

  it('ignores malformed JSON in messages', () => {
    const onEvent = vi.fn();
    connectSSE('s1', { onEvent });

    MockEventSource.instances[0].simulateOpen();
    MockEventSource.instances[0].simulateMessage('not json');

    expect(onEvent).not.toHaveBeenCalled();
  });
});
