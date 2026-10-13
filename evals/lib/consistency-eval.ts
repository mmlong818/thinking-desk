import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsistencyFinding, ConsistencyItem } from '../../src/lib/ai/schemas/consistency-check';
import { CHAIN_STEPS, type Outputs } from './chain';
import { consistencyItemsOf } from './offline';

// Online check of CONSISTENCY_CHECK on a finished chain run: each golden brief is checked twice,
// as the chain left it and with one planted feature that contradicts what the brief itself states
// (a red line or an explicit boundary). The planted run measures recall; the clean run shows what
// the check reports unprompted, with a rough count of "split coverage" findings the prompt asks it
// to leave out (the feature.no_subtask rule covers them).

export const PLANTED_ID = 'ft_plant';

/** One contradiction per golden brief, each against a constraint written in the brief's raw text. */
export const PLANTED: Readonly<Record<string, string>> = {
  '01-consumer-app': 'name=每日卡路里排行榜；description=首页大字显示今日摄入卡路里是否超标并发出警告，同时与好友按卡路里控制成绩排名',
  '02-b2b-saas': 'name=员工实时定位考勤；description=店长可随时查看员工实时 GPS 位置，迟到自动扣分并生成门店员工排名',
  '03-hardware-adjacent': 'name=智能补服建议；description=检测到漏服后，根据漏服次数自动建议老人下次加量补服',
  '04-internal-tool': 'name=供应商智能比价与合同；description=每次下单前自动抓取 3 家供应商报价做比价，选定后生成采购合同并归档管理',
  '05-non-profit': 'name=阅读之星海报；description=每月自动生成带孩子照片和姓名的阅读打卡排行海报，用于对外筹款宣传',
};

export function plantedItem(briefId: string): ConsistencyItem {
  const text = PLANTED[briefId];
  if (!text) throw new Error(`no planted contradiction for brief ${briefId}`);
  return { id: PLANTED_ID, type: 'feature', node: 'final', decision: 'accepted', text, links: [] };
}

/** The chain outputs saved by `pnpm eval` for one brief, or null when a step the check reads is missing. */
export function loadChainOutputs(briefDir: string): Outputs | null {
  const out: Partial<Record<string, unknown>> = {};
  for (const step of CHAIN_STEPS) {
    const file = readdirSync(briefDir).find((f) => f.endsWith(`-${step}.json`));
    if (!file) continue;
    // ok and retried steps carry data; failed and skipped ones do not.
    const record = JSON.parse(readFileSync(join(briefDir, file), 'utf8')) as { data?: unknown };
    if (record.data !== undefined) out[step] = record.data;
  }
  return out.brief && out.revise && out.split ? (out as unknown as Outputs) : null;
}

export function chainBriefDirs(runDir: string): string[] {
  if (!existsSync(runDir)) throw new Error(`--from: ${runDir} does not exist`);
  return readdirSync(runDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name in PLANTED)
    .map((d) => d.name)
    .sort();
}

/** Heuristic: a finding that is about missing / incomplete subtasks rather than a contradiction. */
const COVERAGE = /(没有|无|缺少|缺|未)[^。，；]{0,12}(子任务|拆分)|子任务[^。，；]{0,8}(缺失|未覆盖|覆盖不足|不完整)/;

export function isCoverageFinding(f: Pick<ConsistencyFinding, 'title' | 'description'>): boolean {
  return COVERAGE.test(f.title) || COVERAGE.test(f.description);
}

export interface CheckScore {
  findings: number;
  coverage: number;
  /** Planted runs only: did any finding name the planted item, and the highest severity it got. */
  caught?: boolean;
  plantedSeverity?: ConsistencyFinding['severity'];
}

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const;

export function scoreCheck(findings: readonly ConsistencyFinding[], planted: boolean): CheckScore {
  const base = { findings: findings.length, coverage: findings.filter(isCoverageFinding).length };
  if (!planted) return base;
  const hits = findings.filter((f) => f.item_ids.includes(PLANTED_ID));
  const top = hits.map((f) => f.severity).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0];
  return { ...base, caught: hits.length > 0, ...(top ? { plantedSeverity: top } : {}) };
}

export const checkItems = (out: Outputs, briefId: string, planted: boolean): ConsistencyItem[] =>
  planted ? [...consistencyItemsOf(out), plantedItem(briefId)] : consistencyItemsOf(out);
