import { NDJSON_TYPE, StreamEventSchema, type StreamEvent, type TaskProgress } from '../ai/stream-protocol';

// Browser side of a streamed /api/ai/* answer (wire format: src/lib/ai/stream-protocol.ts):
// progress events go to the caller as they arrive; the final `done` / `error` event becomes the
// same { status, body } a non-streamed call answers, so everything after it is shared.

export interface RouteReply {
  status: number;
  body: Record<string, unknown>;
}

export function isNdjson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes(NDJSON_TYPE);
}

function parseLine(line: string): StreamEvent | null {
  if (!line.trim()) return null;
  try {
    const parsed = StreamEventSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The events of an NDJSON body as they arrive; lines that are not events are skipped. */
export async function* streamEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop() ?? '';
      for (const line of lines) {
        const event = parseLine(line);
        if (event) yield event;
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

const INCOMPLETE: RouteReply = {
  status: 502,
  body: { error: 'stream_incomplete', detail: 'AI 结果流中断，没有收到完整结果，请重试' },
};

/** Reads a streamed answer to its final event; throws an AbortError when the request is aborted. */
export async function readStreamedReply(res: Response, onProgress: (event: TaskProgress) => void): Promise<RouteReply> {
  if (!res.body) return INCOMPLETE;
  for await (const event of streamEvents(res.body)) {
    if (event.type === 'done') {
      const { type: _type, ...body } = event;
      return { status: 200, body };
    }
    if (event.type === 'error') {
      const { type: _type, status, ...body } = event;
      return { status, body };
    }
    onProgress(event);
  }
  return INCOMPLETE;
}
