// AI prose sometimes cites item ids ("豆包（alt_04）", "job_x（…）") although the prompt asks for
// names (READER_RULE). Before a run is saved, known ids in body text become the item's name.
// Bodies reaching the planner carry no id / ref fields, so every string in them is prose.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rewrite(text: string, names: ReadonlyMap<string, string>, id: string): string {
  return text
    // a parenthetical listing only ids: the name is already written before it
    .replace(new RegExp(`\\s*[（(]\\s*${id}(?:\\s*[+、,，/]\\s*${id})*\\s*[)）]`, 'g'), '')
    // an id followed by its name in brackets
    .replace(new RegExp(`\\s*${id}\\s*(?=[（(])`, 'g'), '')
    // any other id: the name, without the spaces that only separated it from Chinese text
    .replace(new RegExp(`(?:(?<=[^\\x00-\\x7F])\\s)?${id}(?:\\s(?=[^\\x00-\\x7F]))?`, 'g'), (m) => {
      const key = m.trim();
      return `「${names.get(key) ?? key}」`;
    });
}

/** Rewrites the known ids in every string of `body`; returns `body` itself when nothing applies. */
export function humanizeIds<T>(body: T, names: ReadonlyMap<string, string>): T {
  if (names.size === 0) return body;
  const keys = [...names.keys()].sort((a, b) => b.length - a.length).map(escape);
  const id = `(?<![A-Za-z0-9_])(?:${keys.join('|')})(?![A-Za-z0-9_])`;
  const probe = new RegExp(id);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return probe.test(v) ? rewrite(v, names, id) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(body) as T;
}
