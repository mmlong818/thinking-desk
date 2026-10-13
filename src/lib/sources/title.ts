const MAX_TITLE_CHARS = 300;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function clean(raw: string): string {
  return decodeEntities(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS).trim();
}

function ogTitle(html: string): string | null {
  const attrRe = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(attrRe)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key === 'og:title' && attrs.content) {
      const t = clean(attrs.content);
      if (t) return t;
    }
  }
  return null;
}

export function extractTitle(html: string): string | null {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (m) {
    const t = clean(m[1]);
    if (t) return t;
  }
  return ogTitle(html);
}

export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cjkCount(s: string): number {
  let n = 0;
  for (const ch of s) if (CJK.test(ch)) n++;
  return n;
}

function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.match(/[a-z0-9]{2,}/g) ?? []) out.add(w);
  for (const run of s.match(CJK_RUN) ?? []) {
    const chars = Array.from(run);
    for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
  }
  return out;
}

export function titlesMatch(cited: string, page: string): boolean {
  const a = normalizeTitle(cited);
  const b = normalizeTitle(page);
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.includes(short) && (short.length >= 4 || cjkCount(short) >= 2)) return true;
  const shortTokens = tokens(short);
  if (shortTokens.size < 2) return false;
  const longTokens = tokens(long);
  let hits = 0;
  for (const t of shortTokens) if (longTokens.has(t)) hits++;
  return hits / shortTokens.size >= 0.6;
}
