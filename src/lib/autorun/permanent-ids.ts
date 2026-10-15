// After a step is saved, its in-memory output still carries the AI's temp ids ('j3', 'f1').
// Later prompts must quote the permanent item ids instead — exactly what a node sends when the
// person works in the UI — so the refs the AI echoes resolve to the stored items as Links.

/** `${type}:${ref}` → permanent id (SaveRunResult.idMap) as ref → id; a ref two items share is dropped. */
function uniqueRefs(idMap: Readonly<Record<string, string>>): Map<string, string> {
  const ids = new Map<string, Set<string>>();
  for (const [key, id] of Object.entries(idMap)) {
    const ref = key.slice(key.indexOf(':') + 1);
    ids.set(ref, (ids.get(ref) ?? new Set()).add(id));
  }
  const out = new Map<string, string>();
  for (const [ref, set] of ids) if (set.size === 1) out.set(ref, [...set][0]);
  return out;
}

/** Deep copy of `value` with every string equal to a (unique) temp ref replaced by its permanent id. */
export function withPermanentIds<T>(value: T, idMap: Readonly<Record<string, string>>): T {
  const refs = uniqueRefs(idMap);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return refs.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
