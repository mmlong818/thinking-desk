import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALWAYS_THINKS_MIN_TOKENS } from '../src/lib/ai/providers/zhipu';
import { loadBriefs } from './lib/briefs';
import { callBudget, parseTarget, planCalls } from './lib/budget';
import { CHAIN_STEPS, type StepRecord } from '../src/lib/autorun/chain';
import { priceFor } from './lib/pricing';
import { renderDryRun, renderRunSummary } from './lib/report';

// The `pnpm eval` side that runs without an API: dry-run planning and budgets, and the summary
// of an online run (rendered from synthetic records).

const briefs = loadBriefs();

afterEach(() => vi.unstubAllGlobals());

describe('dry run planning', () => {
  it('plans every call per brief without touching the network', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('network used in a dry run'); });
    for (const spec of ['openai:gpt-5.5-2026-04-23', 'zhipu:glm-5.2', 'claude:claude-sonnet-5-5', 'gemini:gemini-3.8-flash']) {
      const plan = await planCalls(parseTarget(spec), briefs);
      expect(plan.failures, spec).toEqual([]);
      expect(plan.calls).toHaveLength(briefs.length * CHAIN_STEPS.length);
      const text = renderDryRun(parseTarget(spec), briefs, plan, priceFor(spec));
      expect(text).toContain(`planned calls: ${briefs.length * CHAIN_STEPS.length}`);
    }
  });

  it('budgets GLM-5.3 with its always-on thinking allowance', async () => {
    const plan = await planCalls(parseTarget('zhipu:glm-5.3'), briefs.slice(0, 1));
    expect(plan.failures).toEqual([]);
    expect(plan.calls.every((c) => c.outputCap >= ALWAYS_THINKS_MIN_TOKENS)).toBe(true);
  });

  it('budgets prompt + quoted upstream context, with a retry-everything worst case', async () => {
    const plan = await planCalls(parseTarget('openai:gpt-5.5-2026-04-23'), briefs.slice(0, 1));
    const features = plan.calls.find((c) => c.step === 'features');
    expect(features).toBeDefined();
    if (!features) return;
    const b = callBudget(features, plan.calls);
    expect(features.outputCap).toBeGreaterThan(features.visible);
    expect(b.contextTokens).toBeGreaterThan(0);
    expect(b.worstIn).toBe(2 * b.expectedIn + features.outputCap);
    expect(b.worstOut).toBe(2 * features.outputCap);
  });

  it('rejects malformed targets and prices', () => {
    expect(() => parseTarget('gpt-5.5')).toThrow(/provider:model/);
    expect(() => priceFor('x:y', 'abc')).toThrow(/--price/);
    expect(priceFor('x:y')).toBeNull();
  });
});

describe('run summary', () => {
  it('tabulates statuses, latency and usage and estimates cost from the usage', () => {
    const run = { task: 'BRIEF_EXTRACT' as const, provider: 'zhipu', model: 'glm-5.2', promptVersion: 'sha256:x', status: 'ok' as const, attempts: 1, latencyMs: 2000, usage: { inputTokens: 1_000_000, outputTokens: 100_000 } };
    const records: StepRecord[] = [
      { step: 'brief', task: 'BRIEF_EXTRACT', status: 'ok', run },
      { step: 'users', task: 'USERS_JTBD', status: 'failed', error: 'timeout: AI call timed out', run: { ...run, status: 'failed' } },
      ...CHAIN_STEPS.slice(2).map((step) => ({ step, task: 'SCEN_FEED' as const, status: 'skipped' as const })),
    ];
    const text = renderRunSummary(parseTarget('zhipu:glm-5.2'), [{ brief: '01-consumer-app', records }], priceFor('zhipu:glm-5.2'), 'evals/results/x');
    expect(text).toContain('users: timeout: AI call timed out');
    expect(text).toContain('2,000,000 input + 200,000 output tokens · rough cost $3.68');
  });
});
