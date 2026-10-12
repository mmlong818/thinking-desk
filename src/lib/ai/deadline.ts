// One deadline per runTask() call: a timeout plus the caller's AbortSignal, merged into a single
// signal for the provider, and race() so a provider that ignores the signal cannot outlive it.

export type DeadlineReason = 'timeout' | 'aborted';

export class DeadlineError extends Error {
  constructor(readonly reason: DeadlineReason) {
    super(reason === 'timeout' ? 'AI call timed out' : 'AI call aborted by the caller');
    this.name = 'DeadlineError';
  }
}

export class Deadline {
  private readonly ctrl = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly expiresAt: number;
  private readonly onParentAbort = () => this.abort('aborted');
  reason: DeadlineReason | null = null;

  constructor(timeoutMs: number, private readonly parent?: AbortSignal) {
    this.expiresAt = Date.now() + timeoutMs;
    this.timer = setTimeout(() => this.abort('timeout'), timeoutMs);
    if (parent?.aborted) this.abort('aborted');
    else parent?.addEventListener('abort', this.onParentAbort, { once: true });
  }

  get signal(): AbortSignal {
    return this.ctrl.signal;
  }

  private abort(reason: DeadlineReason): void {
    if (this.reason) return;
    this.reason = reason;
    this.ctrl.abort(new DeadlineError(reason));
  }

  /** Milliseconds left (at least 1). */
  remaining(): number {
    return Math.max(1, this.expiresAt - Date.now());
  }

  /** Settles with `p`, or rejects with a DeadlineError as soon as the deadline fires. */
  race<T>(p: Promise<T>): Promise<T> {
    if (this.reason) {
      p.catch(() => undefined);
      return Promise.reject(new DeadlineError(this.reason));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new DeadlineError(this.reason ?? 'aborted'));
      this.signal.addEventListener('abort', onAbort, { once: true });
      p.then(resolve, reject).finally(() => this.signal.removeEventListener('abort', onAbort));
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.parent?.removeEventListener('abort', this.onParentAbort);
  }
}
