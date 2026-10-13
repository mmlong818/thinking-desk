import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskJsonSchema } from '../json-schema';
import { UsersAnalysisSchema } from '../schemas/analyze-users';
import type { CompleteRequest } from '../types';
import { byteStream, chatDelta, sseEvents, type ByteStreamOptions } from '../__fixtures__/streams';
import { geminiProvider } from './gemini';
import { openaiProvider } from './openai';
import { zhipuProvider } from './zhipu';

// OpenAI / Zhipu stream() against a stubbed fetch serving SSE bodies: no network.

const req = (over: Partial<CompleteRequest> = {}): CompleteRequest => ({
  task: 'SCEN_FEED', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'hi' }],
  schema: taskJsonSchema(UsersAnalysisSchema), maxTokens: 1000, ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
function serve(chunks: ReadonlyArray<string | Error>, opts: ByteStreamOptions & { status?: number } = {}) {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (opts.status && opts.status >= 400) return new Response('rate limited', { status: opts.status });
    return new Response(byteStream(chunks, { hangUntil: opts.hangUntil ?? init?.signal ?? undefined }), {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}
const sentBody = () => JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
  vi.stubEnv('ZHIPU_API_KEY', 'test-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const complete = [...sseEvents(chatDelta('{"a":'), chatDelta('1}'), chatDelta('', 'stop'), { choices: [], usage: { prompt_tokens: 9, completion_tokens: 4 } }, '[DONE]')];

describe('openaiProvider.stream', () => {
  it('sends the complete() body with stream + include_usage and returns the same result shape', async () => {
    serve(complete);
    const deltas: string[] = [];
    const res = await openaiProvider.stream!('gpt-6.1-sol', req(), (d) => deltas.push(d));
    expect(deltas).toEqual(['{"a":', '1}']);
    expect(res).toMatchObject({ text: '{"a":1}', provider: 'openai', model: 'gpt-6.1-sol', usage: { inputTokens: 9, outputTokens: 4 }, finishReason: 'stop' });
    expect(sentBody()).toMatchObject({ stream: true, stream_options: { include_usage: true }, response_format: { type: 'json_object' } });
  });

  it('maps a length stop and surfaces HTTP errors before any delta', async () => {
    serve(sseEvents(chatDelta('{"a"'), chatDelta('', 'length'), '[DONE]'));
    expect((await openaiProvider.stream!('gpt-6.1-sol', req(), () => undefined)).finishReason).toBe('length');
    serve([], { status: 429 });
    await expect(openaiProvider.stream!('gpt-6.1-sol', req(), () => undefined)).rejects.toThrow('OpenAI 429: rate limited');
  });

  it('rejects when the caller aborts mid-stream, after the deltas received so far', async () => {
    const ctrl = new AbortController();
    serve(sseEvents(chatDelta('{"a":')), { hangUntil: ctrl.signal });
    const deltas: string[] = [];
    const p = openaiProvider.stream!('gpt-6.1-sol', req({ signal: ctrl.signal }), (d) => {
      deltas.push(d);
      ctrl.abort();
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(deltas).toEqual(['{"a":']);
  });
});

describe('zhipuProvider.stream', () => {
  it('streams with thinking disabled for JSON tasks and takes usage from the last chunk', async () => {
    serve([...sseEvents(chatDelta('{"a":'), { ...chatDelta('1}', 'stop'), usage: { prompt_tokens: 5, completion_tokens: 2 } }), 'data: [DONE]\n\n']);
    const res = await zhipuProvider.stream!('glm-5.2', req(), () => undefined);
    expect(res).toMatchObject({ text: '{"a":1}', provider: 'zhipu', usage: { inputTokens: 5, outputTokens: 2 }, finishReason: 'stop' });
    expect(sentBody()).toMatchObject({ stream: true, thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    expect(sentBody()).not.toHaveProperty('stream_options');
  });

  it('treats an empty streamed answer as an error, like complete()', async () => {
    serve(sseEvents(chatDelta('', 'length'), '[DONE]'));
    await expect(zhipuProvider.stream!('glm-5.2', req(), () => undefined)).rejects.toThrow(/empty content \(finish_reason=length\)/);
  });

  it('surfaces a network error mid-stream', async () => {
    serve([...sseEvents(chatDelta('{')), new TypeError('terminated')]);
    await expect(zhipuProvider.stream!('glm-5.2', req(), () => undefined)).rejects.toThrow('terminated');
  });
});

it('Gemini has no stream(): runTask falls back to complete()', () => {
  expect(geminiProvider.stream).toBeUndefined();
});
