import { describe, expect, it } from 'vitest';
import { byteStream, chatDelta, sseEvents } from '../__fixtures__/streams';
import { readChatStream } from './chat-stream';
import { sseData } from './sse';

async function collect(body: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of sseData(body)) out.push(data);
  return out;
}

describe('sseData', () => {
  it('yields each event once it ends, across arbitrary chunk boundaries', async () => {
    const raw = 'data: {"a":1}\n\n: keep-alive\n\nevent: x\ndata: two\ndata: lines\n\ndata:[DONE]\n\n';
    const chunked = raw.match(/.{1,3}/gs) ?? [];
    expect(await collect(byteStream(chunked))).toEqual(['{"a":1}', 'two\nlines', '[DONE]']);
  });

  it('handles CRLF line endings split between chunks and a last event without a blank line', async () => {
    expect(await collect(byteStream(['data: a\r', '\ndata: b\r\n\r', '\ndata: c']))).toEqual(['a\nb', 'c']);
  });

  it('decodes multi-byte characters split between chunks', async () => {
    const bytes = new TextEncoder().encode('data: 情景\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 8));
        c.enqueue(bytes.slice(8));
        c.close();
      },
    });
    expect(await collect(body)).toEqual(['情景']);
  });
});

describe('readChatStream', () => {
  it('reports content deltas and returns text, finish reason and usage', async () => {
    const deltas: string[] = [];
    const body = byteStream(sseEvents(
      { choices: [{ delta: { role: 'assistant' } }] },
      chatDelta('{"a":'), chatDelta('1}'), chatDelta('', 'stop'),
      { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } },
      '[DONE]',
    ));
    const out = await readChatStream(body, (d) => deltas.push(d));
    expect(deltas).toEqual(['{"a":', '1}']);
    expect(out).toEqual({ text: '{"a":1}', finishReason: 'stop', usage: { inputTokens: 7, outputTokens: 3 } });
  });

  it('throws when the stream breaks off before a finish reason or [DONE]', async () => {
    await expect(readChatStream(byteStream(sseEvents(chatDelta('{"a"'))), () => undefined))
      .rejects.toThrow('stream ended before the answer was complete');
  });

  it('throws on an error event and on a network error mid-stream, after the deltas so far', async () => {
    const deltas: string[] = [];
    await expect(readChatStream(byteStream(sseEvents(chatDelta('x'), { error: { message: 'overloaded' } })), (d) => deltas.push(d)))
      .rejects.toThrow('stream error: overloaded');
    await expect(readChatStream(byteStream([...sseEvents(chatDelta('y')), new TypeError('terminated')]), (d) => deltas.push(d)))
      .rejects.toThrow('terminated');
    expect(deltas).toEqual(['x', 'y']);
  });
});
