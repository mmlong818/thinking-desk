import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Client bundles must never pull the AI router, providers or provider SDKs.
// Walks the static (value) import graph from every client-reachable module.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

const FORBIDDEN_FILES = [/^lib\/ai\/(router|run-task|route)\.ts$/, /^lib\/ai\/(providers|tasks)\//, /^lib\/db\//];
const FORBIDDEN_PACKAGES = ['@anthropic-ai/sdk', 'pg', 'undici', 'node:crypto'];

function files(dir: string, test: (f: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p, test) : test(p) ? [p] : [];
  });
}

/** Value imports only: `import type …` / `export type …` are erased at build time. */
function valueImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  // `[^'";]` keeps a match inside one statement (multi-line specifier lists have no ';').
  const re = /^(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  return [...src.matchAll(re)].filter((m) => !m[1]).map((m) => m[2]);
}

function resolveImport(spec: string, from: string): string {
  const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2))
    : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return `pkg:${spec}`;
  const hit = ['.ts', '.tsx', '/index.ts', ''].map((ext) => base + ext).find((p) => existsSync(p) && statSync(p).isFile());
  return hit ?? `missing:${spec}`;
}

function reach(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.startsWith('pkg:') || file.startsWith('missing:')) continue;
    queue.push(...valueImports(file).map((s) => resolveImport(s, file)));
  }
  return seen;
}

const notTest = (f: string) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes('__fixtures__');

describe('client-safe modules', () => {
  const entries = [
    ...files(path.join(SRC, 'components'), notTest),
    ...files(path.join(SRC, 'lib/ai/schemas'), notTest),
    ...files(path.join(SRC, 'lib/model'), notTest),
    ...files(path.join(SRC, 'lib/store'), notTest),
    path.join(SRC, 'data/nodes.ts'),
    path.join(SRC, 'lib/ai/follow-ups.ts'),
    ...files(path.join(SRC, 'lib'), (f) => /[\\/]lib[\\/]client-[\w-]+\.ts$/.test(f) && notTest(f)),
  ];
  const reached = [...reach(entries)];

  it('resolves every local import', () => {
    expect(reached.filter((f) => f.startsWith('missing:'))).toEqual([]);
  });

  it('never reaches the AI router, providers, tasks or the database layer', () => {
    const local = reached.filter((f) => !f.startsWith('pkg:') && !f.startsWith('missing:'));
    const bad = local.filter((f) => FORBIDDEN_FILES.some((re) => re.test(rel(f))));
    expect(bad.map(rel)).toEqual([]);
  });

  it('never imports a provider SDK or server-only package', () => {
    const pkgs = reached.filter((f) => f.startsWith('pkg:')).map((f) => f.slice(4));
    expect(pkgs.filter((p) => FORBIDDEN_PACKAGES.includes(p))).toEqual([]);
  });

  it('covers the modules that used to leak the SDK (sanity check of the walker)', () => {
    const covered = reached.map(rel);
    expect(covered).toContain('components/nodes/FeaturesNode.tsx');
    expect(covered).toContain('lib/model/item-types.ts');
    expect(covered).toContain('lib/ai/schemas/draft-features.ts');
  });
});
