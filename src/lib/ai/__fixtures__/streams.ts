// Byte streams for streaming tests: provider SSE bodies and route NDJSON bodies, no network.

export interface ByteStreamOptions {
  /** After the last chunk, stay open until this signal aborts (then error with an AbortError). */
  hangUntil?: AbortSignal;
}

/** Yields each chunk in turn; an Error chunk errors the stream at that point. */
export function byteStream(chunks: ReadonlyArray<string | Error>, opts: ByteStreamOptions = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        const chunk = chunks[i++];
        if (chunk instanceof Error) controller.error(chunk);
        else controller.enqueue(encoder.encode(chunk));
        return;
      }
      const signal = opts.hangUntil;
      if (!signal) return controller.close();
      return new Promise<void>((resolve) => {
        const fail = () => {
          controller.error(new DOMException('This operation was aborted', 'AbortError'));
          resolve();
        };
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
    },
  });
}

/** `data: …` SSE events (objects are JSON-encoded), each ended by a blank line. */
export function sseEvents(...events: unknown[]): string[] {
  return events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`);
}

/** An OpenAI-compatible content chunk. */
export const chatDelta = (content: string, finish: string | null = null) => ({
  choices: [{ index: 0, delta: { content }, finish_reason: finish }],
});

/** Every line of an NDJSON body, parsed. */
export async function readNdjson(body: ReadableStream<Uint8Array> | null): Promise<unknown[]> {
  const text = await new Response(body).text();
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown);
}
