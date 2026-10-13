// Field-level difference between two item bodies, for the "what changed upstream" view. Bodies are
// flattened to leaf paths (`fields.problem_statement`, `steps.0.action`); arrays of plain values
// read as one " · "-joined line. Only changed paths are returned, in a stable order.

export interface FieldChange {
  path: string;
  before: string;
  after: string;
}

const MAX_CHANGES = 20;
const MAX_TEXT = 300;

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function isPlain(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function flatten(value: unknown, path: string, out: Map<string, string>): void {
  if (value === undefined) return;
  if (isPlain(value)) {
    out.set(path, value === null ? '' : String(value));
  } else if (Array.isArray(value)) {
    if (value.every(isPlain)) out.set(path, value.map((v) => String(v ?? '')).join(' · '));
    else value.forEach((v, i) => flatten(v, path ? `${path}.${i}` : String(i), out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, path ? `${path}.${k}` : k, out);
  }
}

export function bodyDiff(before: unknown, after: unknown): FieldChange[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(before, '', a);
  flatten(after, '', b);
  const paths = [...new Set([...a.keys(), ...b.keys()])];
  return paths
    .filter((p) => (a.get(p) ?? '') !== (b.get(p) ?? ''))
    .slice(0, MAX_CHANGES)
    .map((p) => ({ path: p, before: clip(a.get(p) ?? ''), after: clip(b.get(p) ?? '') }));
}
