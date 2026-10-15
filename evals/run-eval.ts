import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadBriefs, selectBriefs, type GoldenBrief } from './lib/briefs';
import { parseTarget, planCalls, type Target } from './lib/budget';
import { CHAIN_STEPS, runChain, type StepRecord } from '../src/lib/autorun/chain';
import { priceFor, type Price } from './lib/pricing';
import { renderDryRun, renderRunSummary, type BriefRun } from './lib/report';

// `pnpm eval --model provider:model [--dry-run] [--briefs 01,03] [--out evals/results] [--price in,out]`
// Runs the brief → … → split chain for the golden briefs (evals/briefs) against one model per
// --model and saves every output with its run metadata. --dry-run makes no API call: it prints
// the planned calls and a token / cost budget. See evals/README.md.

const USAGE = `usage: pnpm eval --model <provider:model> [--model …] [--dry-run] [--briefs 01,03] [--out <dir>] [--price <in>,<out>]`;
const STEP_TIMEOUT_MS = 290_000;

function args(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: 'string', multiple: true },
      'dry-run': { type: 'boolean', default: false },
      briefs: { type: 'string' },
      out: { type: 'string', default: join('evals', 'results') },
      price: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.model?.length) throw new Error(USAGE);
  return { ...values, targets: values.model.map(parseTarget) };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function saveStep(dir: string, record: StepRecord): void {
  const index = String(CHAIN_STEPS.indexOf(record.step) + 1).padStart(2, '0');
  writeJson(join(dir, `${index}-${record.step}.json`), record);
}

async function runBrief(t: Target, brief: GoldenBrief, dir: string): Promise<BriefRun> {
  const briefDir = join(dir, brief.id);
  mkdirSync(briefDir, { recursive: true });
  console.log(`> ${brief.id} · ${brief.title}`);
  const records = await runChain(brief.rawText, () => ({ model: t.spec, timeoutMs: STEP_TIMEOUT_MS }), (r) => {
    saveStep(briefDir, r);
    const secs = r.run ? `${(r.run.latencyMs / 1000).toFixed(1)}s` : '';
    console.log(`  ${r.step.padEnd(13)} ${r.status.padEnd(8)} ${secs}${r.error ? ` · ${r.error.slice(0, 160)}` : ''}`);
    if (r.run?.retry) console.log(`  ${''.padEnd(13)} retry: ${r.run.retry.issues.join(' | ').slice(0, 160)}`);
  });
  return { brief: brief.id, records };
}

async function online(t: Target, briefs: GoldenBrief[], outRoot: string, price: Price | null): Promise<void> {
  const dir = join(outRoot, stamp(), t.spec.replace(/[^\w.-]+/g, '_'));
  mkdirSync(dir, { recursive: true });
  const startedAt = new Date().toISOString();
  const runs: BriefRun[] = [];
  for (const brief of briefs) runs.push(await runBrief(t, brief, dir));
  const summary = renderRunSummary(t, runs, price, dir);
  writeFileSync(join(dir, 'summary.txt'), `${summary}\n`, 'utf8');
  writeJson(join(dir, 'run.json'), {
    target: t.spec, startedAt, finishedAt: new Date().toISOString(),
    runs: runs.map((r) => ({ brief: r.brief, records: r.records.map(({ data: _data, ...meta }) => meta) })),
  });
  console.log(`\n${summary}`);
}

async function main(): Promise<void> {
  const a = args(process.argv.slice(2));
  const briefs = selectBriefs(loadBriefs(), a.briefs);
  if (!a['dry-run'] && existsSync('.env')) process.loadEnvFile('.env');
  for (const t of a.targets) {
    const price = priceFor(t.spec, a.price);
    if (a['dry-run']) console.log(`${renderDryRun(t, briefs, await planCalls(t, briefs), price)}\n`);
    else await online(t, briefs, a.out, price);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
