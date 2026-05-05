// Client-side preferred model — persisted in localStorage, included in every
// AI request so users can switch providers/models without restarting the server.

const KEY = 'td:ai-model';

export function readPreferredModel(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writePreferredModel(value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // ignore quota
  }
  // Broadcast so other components can react.
  window.dispatchEvent(new CustomEvent('td:model-change', { detail: value }));
}
