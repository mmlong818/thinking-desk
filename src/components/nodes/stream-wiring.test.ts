import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard for the pairing the type system cannot see: a route declared with `stream: true` only
// streams for a client that asks (`useAiAction().run(…, { stream: true })`), and a node that asks
// a route that does not stream just gets JSON and no progress. Compared per route, by source text.

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(path, 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

const routes = readdirSync(join(ROOT, 'app/api/ai')).map((name) => ({
  route: `/api/ai/${name}`,
  streams: /\n\s*stream: true,/.test(read(join(ROOT, 'app/api/ai', name, 'route.ts'))),
}));

/** `text` up to the brace that closes the object literal it starts inside. */
function untilClosingBrace(text: string): string {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth < 0) return text.slice(0, i);
  }
  return text;
}

/** The text of each `run(…)` spec naming `route`: from its `route:` to the end of the spec object. */
function callsOf(route: string): string[] {
  return sourceFiles(join(ROOT, 'components')).flatMap((file) =>
    read(file).split(/(?=route: ')/)
      .filter((part) => part.startsWith(`route: '${route}'`))
      .map(untilClosingBrace));
}

describe('streaming routes and their callers', () => {
  it.each(routes.filter((r) => r.streams))('every call of $route asks for the stream', ({ route }) => {
    const calls = callsOf(route);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/stream: true/);
  });

  it.each(routes.filter((r) => !r.streams))('no call of $route asks for a stream it does not offer', ({ route }) => {
    for (const call of callsOf(route)) expect(call).not.toMatch(/stream: true/);
  });
});
