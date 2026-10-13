import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { consistencyCheck } from '../src/lib/ai/tasks/consistency-check';
import { parseTarget, type Target } from './lib/budget';
import { chainBriefDirs, checkItems, loadChainOutputs, scoreCheck, type CheckScore } from './lib/consistency-eval';
import { cost, formatUsd, priceFor } from './lib/pricing';
import { table } from './lib/report';

// `pnpm eval:consistency --model provider:model --from evals/results/<stamp>/<provider_model> [--briefs 01,03] [--price in,out]`
// Runs CONSISTENCY_CHECK (paid, 2 calls per brief) on the outputs of a finished `pnpm eval` run:
// once as the chain left them, once with a planted contradiction. See evals/README.md.

const USAGE = 'usage: pnpm eval:consistency --model <provider:model> --from <results dir of one model> [--briefs 01,03] [--price <in>,<out>]';
const TIMEOUT_MS = 290_000;

interface CheckRecord extends Partial<CheckScore> {
  brief: string;
  variant: 'clean' | 'planted';
  status: 'ok' | 'failed';
  error?: string;
  run?: { latencyMs: number; attempts: number; usage?: { inputTokens: number; outputTokens: number } };
  data?: unknown;
}

function args(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: 'string' },
      from: { type: 'string' },
      briefs: { type: 'string' },
      price: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.model || !values.from) throw new Error(USAGE);
  return { ...values, model: values.model, from: values.from, target: parseTarget(values.model) };
}

async function check(t: Target, brief: string, dir: string, variant: CheckRecord['variant']): Promise<CheckRecord> {
  const out = loadChainOutputs(dir);
  if (!out) return { brief, variant, status: 'failed', error: 'chain outputs incomplete (needs brief, revise, split)' };
  try {
    const r = await consistencyCheck({ items: checkItems(out, brief, variant === 'planted') }, { model: t.spec, timeoutMs: TIMEOUT_MS });
    return { brief, variant, status: 'ok', ...scoreCheck(r.data.findings, variant === 'planted'), run: r.run, data: r.data };
  } catch (e) {
    return { brief, variant, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

function summary(t: Target, records: readonly CheckRecord[], priceOverride: string | undefined, dir: string): string {
  const rows = records.map((r) => [
    `${r.brief} ${r.variant}`, r.status, r.findings ?? '-', r.coverage ?? '-',
    r.variant === 'planted' ? (r.caught ? `yes (${r.plantedSeverity})` : r.status === 'ok' ? 'NO' : '-') : '',
    r.run ? `${(r.run.latencyMs / 1000).toFixed(1)}` : '-',
  ]);
  const planted = records.filter((r) => r.variant === 'planted' && r.status === 'ok');
  const input = records.reduce((n, r) => n + (r.run?.usage?.inputTokens ?? 0), 0);
  const output = records.reduce((n, r) => n + (r.run?.usage?.outputTokens ?? 0), 0);
  return [
    `Consistency eval · ${t.spec} · results in ${dir}`,
    '',
    table(['brief / variant', 'status', 'findings', 'coverage?', 'planted caught', 's'], rows, 2),
    '',
    `planted caught: ${planted.filter((r) => r.caught).length} / ${planted.length}`,
    `coverage? = findings that look like "missing subtasks" (heuristic; the prompt asks the model to leave them to the rule layer)`,
    `usage: ${input.toLocaleString('en-US')} input + ${output.toLocaleString('en-US')} output tokens · rough cost ${formatUsd(cost(priceFor(t.spec, priceOverride), input, output))}`,
  ].join('\n');
}

async function main(): Promise<void> {
  const a = args(process.argv.slice(2));
  if (existsSync('.env')) process.loadEnvFile('.env');
  const wanted = (a.briefs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const briefs = chainBriefDirs(a.from).filter((b) => wanted.length === 0 || wanted.some((w) => b.startsWith(w)));
  if (briefs.length === 0) throw new Error(`no golden brief results under ${a.from}`);
  const dir = join(a.from, 'consistency', `${new Date().toISOString().replace(/[:.]/g, '-')}_${a.target.spec.replace(/[^\w.-]+/g, '_')}`);
  mkdirSync(dir, { recursive: true });
  const records: CheckRecord[] = [];
  for (const brief of briefs) {
    for (const variant of ['clean', 'planted'] as const) {
      const r = await check(a.target, brief, join(a.from, brief), variant);
      writeFileSync(join(dir, `${brief}-${variant}.json`), `${JSON.stringify(r, null, 2)}\n`, 'utf8');
      console.log(`  ${brief} ${variant.padEnd(7)} ${r.status}${r.error ? ` · ${r.error.slice(0, 160)}` : ` · ${r.findings} findings`}`);
      records.push(r);
    }
  }
  const text = summary(a.target, records, a.price, dir);
  writeFileSync(join(dir, 'summary.txt'), `${text}\n`, 'utf8');
  console.log(`\n${text}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
