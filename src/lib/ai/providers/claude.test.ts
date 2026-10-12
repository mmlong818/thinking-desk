import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// claude.complete() against a mocked SDK client: no network.
const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create };
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
