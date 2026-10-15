import { describe, expect, it } from 'vitest';
import { DATA_GUARD } from '../src/lib/ai/prompt';
import { AI_TASKS } from '../src/lib/ai/types';
import { loadBriefs, selectBriefs } from './lib/briefs';
import { CHAIN_STEPS, runChain, type Outputs, type StepName, type StepRecord } from '../src/lib/autorun/chain';
import { SCHEMA_FIXTURES, STEP_FIXTURES } from './lib/fixtures';
import { EXTRA_PROMPTS, fixtureDeps, type Captured } from './lib/offline';

// Offline half of the prompt eval baseline (runs in `pnpm test`, no API): the golden briefs,
// every task schema against its fixtures, every prompt builder rendered for every golden brief,
// and the promptVersion of each prompt as a snapshot — a prompt change shows up in review as a
// snapshot diff (update with `pnpm vitest run evals -u` when the change is intended).

const briefs = loadBriefs();

async function renderChain(rawText: string) {
  const captured = new Map<StepName, Captured>();
  const records = await runChain(rawText, (step) => ({
    deps: fixtureDeps(STEP_FIXTURES[step], { onRequest: (c) => captured.set(step, c) }),
  }));
  return { records, captured };
}

describe('golden briefs', () => {
  it('are five distinct Chinese briefs across domains', () => {
    expect(briefs.map((b) => b.id)).toEqual(['01-consumer-app', '02-b2b-saas', '03-hardware-adjacent', '04-internal-tool', '05-non-profit']);
    for (const b of briefs) {
      expect(b.title.length).toBeGreaterThan(3);
      expect(b.rawText.length).toBeGreaterThan(300);
      expect(b.rawText.match(/[\u4e00-\u9fff]/g)?.length ?? 0).toBeGreaterThan(200);
    }
    expect(selectBriefs(briefs, '02,05').map((b) => b.id)).toEqual(['02-b2b-saas', '05-non-profit']);
    expect(() => selectBriefs(briefs, '99')).toThrow(/no golden brief/);
  });
});

describe('task schemas accept their fixtures', () => {
  it.each(SCHEMA_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    for (const fixture of f.fixtures) {
      const r = f.schema.safeParse(fixture);
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))).toBe(true);
    }
  });

  it('covers every structured task (FREE_ASK answers plain text)', () => {
    const covered = new Set(SCHEMA_FIXTURES.map((f) => f.task));
    expect(AI_TASKS.filter((t) => !covered.has(t))).toEqual(['FREE_ASK']);
  });
});

describe.each(briefs.map((b) => [b.id, b] as const))('prompts render for %s', (_id, brief) => {
  it('runs the whole chain offline; every prompt has the data guard and quotes request data in <data> blocks', async () => {
    const { records, captured } = await renderChain(brief.rawText);
    expect(records.map((r) => [r.step, r.status])).toEqual(CHAIN_STEPS.map((s) => [s, 'ok']));
    for (const { req } of captured.values()) {
      expect(req.messages[0].content).toContain(DATA_GUARD);
      expect(req.messages.at(-1)?.content).toContain('<data name="');
    }
    expect(captured.get('brief')?.req.messages.at(-1)?.content).toContain(brief.rawText.slice(0, 40));
  });

  it('renders the prompt builders outside the chain', async () => {
    const out = Object.fromEntries(CHAIN_STEPS.map((s) => [s, STEP_FIXTURES[s]])) as unknown as Outputs;
    for (const [name, extra] of Object.entries(EXTRA_PROMPTS)) {
      await expect(extra.render(brief.rawText, out, { deps: fixtureDeps(extra.output) }), name).resolves.toBeDefined();
    }
  });
});

describe('promptVersion', () => {
  async function versions(rawText: string): Promise<Record<string, string>> {
    const { records } = await renderChain(rawText);
    const out = Object.fromEntries(CHAIN_STEPS.map((s) => [s, STEP_FIXTURES[s]])) as unknown as Outputs;
    const extras = await Promise.all(Object.entries(EXTRA_PROMPTS).map(async ([name, extra]) => {
      const res = (await extra.render(rawText, out, { deps: fixtureDeps(extra.output) })) as { run: { task: string; promptVersion: string } };
      return [`extra:${name}`, `${res.run.task} ${res.run.promptVersion}`] as const;
    }));
    const chain = records.map((r: StepRecord) => [`chain:${r.step}`, `${r.task} ${r.run?.promptVersion}`] as const);
    return Object.fromEntries([...chain, ...extras]);
  }

  it('is the same for every brief (it hashes the template, not the data) and matches the snapshot', async () => {
    const all = await Promise.all(briefs.map((b) => versions(b.rawText)));
    for (const v of all.slice(1)) expect(v).toEqual(all[0]);
    expect(all[0]).toMatchSnapshot();
  });
});
