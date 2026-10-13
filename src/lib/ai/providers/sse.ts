// Server-Sent Events (text/event-stream) reader for the providers called with plain fetch.
// Only `data:` fields matter here: each event's data lines are joined with "\n" and yielded when
// the event ends (blank line). Comments (": keep-alive") and other fields are ignored.

/** Splits off complete lines; a trailing "\r" is held back in case "\n" starts the next chunk. */
function splitLines(text: string, final: boolean): { lines: string[]; rest: string } {
  const holdCr = !final && text.endsWith('\r');
  const parts = (holdCr ? text.slice(0, -1) : text).split(/\r\n|\r|\n/);
  const last = parts.pop() ?? '';
  return { lines: parts, rest: holdCr ? `${last}\r` : last };
}

function eventBuffer() {
  let data: string[] = [];
  return {
    /** Feeds one line; returns the event's data when the line ends an event. */
    push(line: string): string | null {
      if (line === '') {
        const out = data.length > 0 ? data.join('\n') : null;
        data = [];
        return out;
      }
      if (line.startsWith(':')) return null;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      if (field === 'data') data.push(colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, ''));
      return null;
    },
  };
}

/** Yields the data of each event as it arrives. Stopping early cancels the body (frees the connection). */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events = eventBuffer();
  let rest = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      rest += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const split = splitLines(rest, done);
      rest = split.rest;
      for (const line of done ? [...split.lines, rest, ''] : split.lines) {
        const data = events.push(line);
        if (data !== null) yield data;
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
