import type { RunTaskResult, TaskOptions } from './run-task';
import { NDJSON_TYPE, type StreamEvent } from './stream-protocol';

// The NDJSON side of aiRoute() (wire format: stream-protocol.ts). The task runs with a signal
// that aborts when the request is aborted or the client cancels the response body, so closing
// the tab or pressing "取消" aborts the provider call; events after that are dropped.

export interface ErrorAnswer {
  status: number;
  body: { error: string; code?: string; run?: unknown; detail?: string };
}

type StreamedTask = (opts: Pick<TaskOptions, 'signal' | 'onProgress'>) => Promise<RunTaskResult<unknown>>;

const HEADERS = {
  'content-type': `${NDJSON_TYPE}; charset=utf-8`,
  // no-transform: keeps compression from buffering the stream; no-cache: never replay it.
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
};

export function wantsNdjson(req: Request): boolean {
  return (req.headers.get('accept') ?? '').includes(NDJSON_TYPE);
}

function sink(controller: ReadableStreamDefaultController<Uint8Array>) {
  const encoder = new TextEncoder();
  let open = true;
  return {
    send(event: StreamEvent) {
      if (!open) return;
      try {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      } catch {
        open = false;
      }
    },
    /** End of the task: close the body. */
    close() {
      if (!open) return;
      open = false;
      try {
        controller.close();
      } catch {
        // already cancelled
      }
    },
    /** The client went away: stop writing. */
    drop() {
      open = false;
    },
  };
}

async function runInto(task: StreamedTask, signal: AbortSignal, out: ReturnType<typeof sink>, onError: (e: unknown) => ErrorAnswer) {
  try {
    const { data, run } = await task({ signal, onProgress: (event) => out.send(event) });
    out.send({ type: 'done', ok: true, data, run });
  } catch (e) {
    const { status, body } = onError(e);
    out.send({ type: 'error', status, ...body });
  } finally {
    out.close();
  }
}

/** Runs `task` and answers with its progress, then exactly one `done` or `error` event. */
export function ndjsonTaskResponse(req: Request, task: StreamedTask, onError: (e: unknown) => ErrorAnswer): Response {
  const abort = new AbortController();
  const onRequestAbort = () => abort.abort();
  if (req.signal.aborted) abort.abort();
  else req.signal.addEventListener('abort', onRequestAbort, { once: true });
  let out: ReturnType<typeof sink> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const s = sink(controller);
      out = s;
      void runInto(task, abort.signal, s, onError).finally(() => req.signal.removeEventListener('abort', onRequestAbort));
    },
    cancel() {
      out?.drop();
      abort.abort();
    },
  });
  return new Response(body, { headers: HEADERS });
}
