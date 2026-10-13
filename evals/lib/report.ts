import type { GoldenBrief } from './briefs';
import { callBudget, REASONING_FILL, VISIBLE_FILL, type Plan, type Target } from './budget';
import { CHAIN_STEPS, type StepRecord } from './chain';
import { cost, formatUsd, type Price } from './pricing';

// Plain-text tables for the eval CLI (ASCII columns so they line up in any terminal).

const n = (v: number) => Math.round(v).toLocaleString('en-US');

/** Text columns (the first `textCols`) align left, the rest right. */
export function table(headers: string[], rows: Array<Array<string | number>>, textCols = 1): string {
  const cells = rows.map((r) => r.map((c) => (typeof c === 'number' ? n(c) : c)));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => (i < textCols ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n');
}

function priceLine(price: Price | null): string {
  if (!price) return 'price: none on file (pass --price in,out to estimate cost)';
  return `price: $${price.input} / $${price.output} per 1M tokens (in / out)${price.note ? ` · ${price.note}` : ''}`;
}

export function renderDryRun(t: Target, briefs: readonly GoldenBrief[], plan: Plan, price: Price | null): string {
  const budgets = plan.calls.map((c) => ({ c, b: callBudget(c, plan.calls.filter((x) => x.brief === c.brief)) }));
  const rows = CHAIN_STEPS.map((step) => {
    const mine = budgets.filter((x) => x.c.step === step);
    const avg = (f: (x: (typeof mine)[number]) => number) => (mine.length ? mine.reduce((s, x) => s + f(x), 0) / mine.length : 0);
    return [step, mine[0]?.c.task ?? '-', mine.length, avg((x) => x.c.promptTokens), avg((x) => x.b.contextTokens), avg((x) => x.c.visible), avg((x) => x.c.outputCap)];
  });
  const sum = (f: (x: (typeof budgets)[number]) => number) => budgets.reduce((s, x) => s + f(x), 0);
  const exp = { in: sum((x) => x.b.expectedIn), out: sum((x) => x.b.expectedOut) };
  const worst = { in: sum((x) => x.b.worstIn), out: sum((x) => x.b.worstOut) };
  return [
    `Prompt eval · DRY RUN (no API call made) · ${t.spec}`,
    priceLine(price),
    `briefs: ${briefs.length} (${briefs.map((b) => b.id).join(', ')}) · steps per brief: ${CHAIN_STEPS.length}`,
    `planned calls: ${plan.calls.length} (at most ${plan.calls.length * 2} with one validation retry each)`,
    ...plan.failures.map((f) => `!! ${f.step}: ${f.status}${f.error ? ` · ${f.error}` : ''}`),
    '',
    table(['step', 'task', 'calls', 'prompt~tok', '+context~tok', 'visible', 'out cap'], rows, 2),
    '',
    table(['budget (tokens)', 'input', 'output', 'cost'], [
      ['expected', exp.in, exp.out, formatUsd(cost(price, exp.in, exp.out))],
      ['worst case', worst.in, worst.out, formatUsd(cost(price, worst.in, worst.out))],
    ]),
    '',
    'assumptions:',
    '- prompt~tok: request body rendered by the adapter for this model, ~1 token per CJK char, ~3.5 chars/token otherwise',
    `- +context~tok: upstream answers quoted in the prompt, at ${VISIBLE_FILL * 100}% of their visible budget`,
    `- expected output: ${VISIBLE_FILL * 100}% of the visible budget + ${REASONING_FILL * 100}% of the reasoning headroom (out cap - visible)`,
    '- worst case: every call answers at its out cap, fails validation and is retried once (prompt + failed answer resent)',
  ].join('\n');
}

export interface BriefRun {
  brief: string;
  records: StepRecord[];
}

function stepRows(runs: readonly BriefRun[]) {
  return CHAIN_STEPS.map((step) => {
    const recs = runs.flatMap((r) => r.records.filter((x) => x.step === step));
    const count = (s: StepRecord['status']) => recs.filter((x) => x.status === s).length;
    const timed = recs.filter((x) => x.run);
    const latency = timed.length ? timed.reduce((s, x) => s + (x.run?.latencyMs ?? 0), 0) / timed.length / 1000 : 0;
    const tokens = (k: 'inputTokens' | 'outputTokens') => recs.reduce((s, x) => s + (x.run?.usage?.[k] ?? 0), 0);
    return [step, count('ok'), count('retried'), count('failed'), count('skipped'), latency.toFixed(1), tokens('inputTokens'), tokens('outputTokens')];
  });
}

export function renderRunSummary(t: Target, runs: readonly BriefRun[], price: Price | null, dir: string): string {
  const all = runs.flatMap((r) => r.records);
  const input = all.reduce((s, x) => s + (x.run?.usage?.inputTokens ?? 0), 0);
  const output = all.reduce((s, x) => s + (x.run?.usage?.outputTokens ?? 0), 0);
  const briefRows = runs.map((r) => {
    const failed = r.records.find((x) => x.status === 'failed');
    const done = r.records.filter((x) => x.status === 'ok' || x.status === 'retried').length;
    return [r.brief, failed ? `${failed.step}: ${(failed.error ?? 'failed').slice(0, 100)}` : 'complete', done];
  });
  return [
    `Prompt eval · ${t.spec} · ${runs.length} briefs · results in ${dir}`,
    priceLine(price),
    '',
    table(['step', 'ok', 'retried', 'failed', 'skipped', 'avg s', 'input tok', 'output tok'], stepRows(runs)),
    '',
    table(['brief', 'result', 'steps done'], briefRows, 2),
    '',
    `usage: ${n(input)} input + ${n(output)} output tokens · rough cost ${formatUsd(cost(price, input, output))}`,
  ].join('\n');
}
