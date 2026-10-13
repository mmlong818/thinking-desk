import type { BriefQuestion, ClarifyResult } from '@/lib/ai/schemas/clarify-brief';
import type { BriefExtraction } from '@/lib/ai/schemas/extract-brief';
import type { ProbeResult, ProbeTurn } from '@/lib/ai/schemas/probe-brief';

export type ClarifyAsk = Extract<ClarifyResult, { action: 'ask' }>;
export type ProbeQuestion = Extract<ProbeResult, { action: 'question' }>;

/** The clarification flow before a brief exists (or while re-analysing). 'done' = the brief item. */
export type Stage =
  | { kind: 'paste' }
  | { kind: 'clarifying' }
  /** AI 建议好澄清模式，用户做最终选择 */
  | { kind: 'mode_choose'; ask: ClarifyAsk }
  | { kind: 'ask'; questions: BriefQuestion[]; reasoning: string; needType: string }
  /** 对话式追问流程 */
  | { kind: 'interview'; reasoning: string; history: ProbeTurn[]; current: ProbeQuestion | null; probing: boolean }
  | { kind: 'extracting' }
  | { kind: 'done' };

export const EXAMPLE = `老板今天扔过来一个新项目。要给 K12 学生做一个 AI 学习陪练的产品，目标是提升学生的自主学习能力。我们大概有一季度的时间。用户是初中生，主要场景是在家做作业时。老板希望做得"像一个真正的陪练"，不是简单的答疑。`;

export type ScalarFieldKey =
  | 'problem_statement' | 'target_user' | 'scenario' | 'value_prop' | 'success_criteria' | 'time_constraint';

export const SCALAR_FIELDS: ScalarFieldKey[] = [
  'problem_statement', 'target_user', 'scenario', 'value_prop', 'success_criteria', 'time_constraint',
];
export const LONG_FIELDS: ReadonlySet<ScalarFieldKey> = new Set(['problem_statement', 'value_prop', 'scenario', 'success_criteria']);

export const FIELD_META: Record<keyof BriefExtraction['fields'], { label: string; sub: string }> = {
  problem_statement: { label: '问题陈述', sub: '核心要解决的问题' },
  target_user:       { label: '目标用户', sub: 'Who' },
  scenario:          { label: '使用场景', sub: 'When / Where' },
  value_prop:        { label: '核心价值主张', sub: '区别于"简单答疑"' },
  success_criteria:  { label: '成功标准', sub: '怎么算赢' },
  time_constraint:   { label: '时间约束', sub: 'Deadline' },
  boundaries:        { label: '明确边界', sub: '本次不做' },
  red_lines:         { label: '道德红线', sub: '无论诱惑多大都不做' },
};

export function stageChip(stage: Stage): string {
  switch (stage.kind) {
    case 'paste':       return 'v0.3 · 双澄清模式';
    case 'clarifying':  return '判断是否需要澄清…';
    case 'mode_choose': return '选择澄清方式';
    case 'ask':         return '澄清问卷 · 请勾选';
    case 'interview':   return '对话式追问中…';
    case 'extracting':  return '结构化抽取中…';
    case 'done':        return '抽取完成 · 可编辑';
  }
}

export function stageHint(stage: Stage): string {
  switch (stage.kind) {
    case 'paste':       return '等待粘贴';
    case 'clarifying':  return '判断中…';
    case 'mode_choose': return '已锁定 · 请选模式';
    case 'ask':         return '已锁定 · 问卷中';
    case 'interview':   return '已锁定 · 追问中';
    case 'extracting':  return '抽取中…';
    case 'done':        return '已分析';
  }
}

/** The skip marker the follow-up runner sends. */
export const SKIPPED = '〔跳过〕';
