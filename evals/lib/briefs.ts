import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Golden briefs: evals/briefs/<id>.md, first line "# <title>", the rest is the raw brief text a
// person would paste into the brief node. Paths are relative to the repository root (the working
// directory of `pnpm test` and `pnpm eval`).

export interface GoldenBrief {
  id: string;
  title: string;
  rawText: string;
}

export const BRIEFS_DIR = join(process.cwd(), 'evals', 'briefs');

export function parseBrief(id: string, text: string): GoldenBrief {
  const [first = '', ...rest] = text.replace(/\r\n/g, '\n').split('\n');
  return { id, title: first.replace(/^#\s*/, '').trim(), rawText: rest.join('\n').trim() };
}

export function loadBriefs(dir: string = BRIEFS_DIR): GoldenBrief[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseBrief(f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf8')));
}

/** `--briefs 01,03` → the briefs whose id starts with one of the prefixes (all when empty). */
export function selectBriefs(all: GoldenBrief[], filter: string | undefined): GoldenBrief[] {
  const wanted = (filter ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (wanted.length === 0) return all;
  const picked = all.filter((b) => wanted.some((w) => b.id.startsWith(w)));
  if (picked.length === 0) throw new Error(`no golden brief matches --briefs ${filter} (have ${all.map((b) => b.id).join(', ')})`);
  return picked;
}
