import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// claude.complete() / stream() against a mocked SDK client: no network.
const create = vi.fn();
const stream = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create, stream };
  },
}));

const message = (over: Record<string, unknown> = {}) => ({
  content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 12, output_tokens: 7 },
  ...over,
});

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  create.mockReset();
  stream.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe('claudeProvider.complete', () => {
  it('joins text blocks (skipping thinking), reports usage, and passes signal + timeout', async () => {
    create.mockResolvedValue(message());
    const { claudeProvider } = await import('./claude');
    const ctrl = new AbortController();
    const res = await claudeProvider.complete('claude-sonnet-5-5', {
      task: 'FREE_ASK', messages: [{ role: 'user', content: 'hi' }], signal: ctrl.signal, timeoutMs: 30_000,
    });
    expect(res).toMatchObject({ text: '{"a":1}', provider: 'claude', usage: { inputTokens: 12, outputTokens: 7 }, finishReason: 'stop' });
    const [body, opts] = create.mock.calls[0];
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' } });
    expect(opts).toEqual({ signal: ctrl.signal, timeout: 30_000 });
  });

  it.each([
    ['refusal', 'refusal'],
    ['max_tokens', 'length'],
    ['model_context_window_exceeded', 'length'],
    ['pause_turn', 'other'],
  ])('maps stop_reason %s to finishReason %s', async (stop, expected) => {
    create.mockResolvedValue(message({ stop_reason: stop }));
    const { claudeProvider } = await import('./claude');
    const res = await claudeProvider.complete('claude-opus-5-5', { task: 'FREE_ASK', messages: [] });
    expect(res.finishReason).toBe(expected);
  });
});

/** A MessageStream stand-in: `text` listeners get the deltas, then finalMessage() settles. */
function fakeStream(deltas: string[], final: () => Promise<unknown>) {
  const listeners: Array<(delta: string) => void> = [];
  const s = {
    on: vi.fn((event: string, listener: (delta: string) => void) => {
      if (event === 'text') listeners.push(listener);
      return s;
    }),
    finalMessage: vi.fn(async () => {
      for (const d of deltas) listeners.forEach((l) => l(d));
      return final();
    }),
  };
  return s;
}

describe('claudeProvider.stream', () => {
  it('reports text deltas and maps the final message like complete(), passing signal + timeout', async () => {
    stream.mockImplementation(() => fakeStream(['{"a":', '1}'], async () => message()));
    const { claudeProvider } = await import('./claude');
    const ctrl = new AbortController();
    const deltas: string[] = [];
    const res = await claudeProvider.stream!('claude-sonnet-5-5', {
      task: 'SCEN_FEED', messages: [{ role: 'user', content: 'hi' }], signal: ctrl.signal, timeoutMs: 20_000,
    }, (d) => deltas.push(d));
    expect(deltas).toEqual(['{"a":', '1}']);
    expect(res).toMatchObject({ text: '{"a":1}', provider: 'claude', usage: { inputTokens: 12, outputTokens: 7 }, finishReason: 'stop' });
    const [body, opts] = stream.mock.calls[0];
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' } });
    expect(body).not.toHaveProperty('stream');
    expect(opts).toEqual({ signal: ctrl.signal, timeout: 20_000 });
  });

  it('rejects with the SDK error when the stream fails or is aborted', async () => {
    stream.mockImplementation(() => fakeStream(['{"a"'], async () => { throw new Error('Request was aborted.'); }));
    const { claudeProvider } = await import('./claude');
    await expect(claudeProvider.stream!('claude-opus-5-5', { task: 'SCEN_FEED', messages: [] }, () => undefined))
      .rejects.toThrow('Request was aborted.');
  });
});
