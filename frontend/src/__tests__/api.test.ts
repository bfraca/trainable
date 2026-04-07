import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to import the module after mocking fetch
let api: typeof import('@/lib/api').api;

describe('api client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    // Reset fetch mock before each test
    globalThis.fetch = vi.fn();
    // Re-import to get fresh module
    const mod = await import('@/lib/api');
    api = mod.api;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('listExperiments sends GET to /api/experiments', async () => {
    const mockExperiments = [{ id: '1', name: 'Test' }];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockExperiments),
    });

    const result = await api.listExperiments();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/experiments',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toEqual(mockExperiments);
  });

  it('throws on non-ok responses with status text', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    });

    await expect(api.listExperiments()).rejects.toThrow('API error 404: Not found');
  });

  it('deleteExperiment sends DELETE request', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await api.deleteExperiment('exp-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/experiments/exp-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('sendMessage posts JSON body with content and run_agent', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'm1', content: 'hello' }),
    });

    await api.sendMessage('sess-1', 'hello', true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/sessions/sess-1/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'hello', run_agent: true }),
      }),
    );
  });

  it('startStage posts to correct stage URL', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ session_id: 's1', stage: 'eda' }),
    });

    await api.startStage('sess-1', 'eda', 'T4');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/sessions/sess-1/stages/eda/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ gpu: 'T4', instructions: null }),
      }),
    );
  });

  it('getFileTree encodes root path', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'root', children: [] }),
    });

    await api.getFileTree('sess-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/files/tree?root=/sessions/sess-1',
      expect.any(Object),
    );
  });

  it('readFile encodes file path', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ path: '/a/b.py', content: 'print(1)' }),
    });

    await api.readFile('/sessions/s1/code/main.py');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/read?path='),
      expect.any(Object),
    );
  });

  it('createExperiment sends FormData without Content-Type header', async () => {
    const formData = new FormData();
    formData.append('name', 'test');

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'e1', session_id: 's1' }),
    });

    await api.createExperiment(formData);

    // Should NOT set Content-Type (browser sets it with boundary for FormData)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/experiments',
      expect.objectContaining({
        method: 'POST',
        body: formData,
      }),
    );
  });

  it('abortSession posts to abort endpoint', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    await api.abortSession('sess-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/sessions/sess-1/abort',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
