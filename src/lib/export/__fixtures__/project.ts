import { validFeature } from '../../ai/schemas/__fixtures__/draft-features';
import type { NodeKind } from '../../../data/nodes';
import type { AiTask } from '../../ai/types';
import type { Graph } from '../../model/graph';
import { LocalRepository } from '../../model/local-repository';
import type { ItemDraft, ReplaceScope } from '../../model/repository';
import { seqIdSource, T1 } from '../../model/__fixtures__/model';
import { memoryStorage } from '../../model/__fixtures__/storage';

// A small but complete project for the export snapshots: every PRD section has accepted content,
// plus pending / rejected items that must stay out, human and AI-edited items for provenance,
// and subtasks with dependencies (one on a subtask that is not accepted).

export const EXPORT_PROJECT = '学习陪练';

const run = (task: AiTask, node: NodeKind) => ({
  task, node, provider: 'claude', model: 'fixture', promptVersion: 'sha256:x', inputs: [], status: 'ok' as const, latencyMs: 1,
});
type Stance = NonNullable<ItemDraft['aiStance']>;
const rec = (reason: string): Stance => ({ verdict: 'recommend', reason });
const caution = (reason: string): Stance => ({ verdict: 'caution', reason });
const { id: _id, traces: _traces, ...featureBase } = validFeature(1);

const feature = (ref: string, name: string, rice: number, jobRefs: string[], extra: Record<string, unknown> = {}): ItemDraft => ({
  ref, type: 'feature', aiStance: rice > 50 ? rec('高 RICE') : caution('收益不明'),
  body: { ...featureBase, id: ref, name, description: `${name}：卡住时给出分步提示`, pillar: '即时反馈', rice_score: rice, core_hypothesis: `${name}能减少放弃`, traces: { job_ids: jobRefs }, ...extra },
});

const subtask = (ref: string, title: string, estimate: string, deps: string[], stance = rec('可直接开工')) => ({
  id: ref, title, description: `${title}，覆盖主流程`, layer: 'backend', estimate, acceptance_criteria: [`${title}通过验收`],
  dependencies: deps, stance,
});

export async function exportFixtureGraph(): Promise<Graph> {
  const repo = new LocalRepository({ storage: memoryStorage(), now: () => T1, idSource: seqIdSource() });
  const P = 'p-export';
  const save = (task: AiTask, node: NodeKind, drafts: ItemDraft[], replace: ReplaceScope[] = []) =>
    repo.saveRunOutput(P, { run: run(task, node), drafts, replace });
  const accept = async (ids: string[], decision: 'accepted' | 'rejected' = 'accepted') => {
    for (const id of ids) await repo.updateItem(P, id, { decision }, { actor: 'human' });
  };

  const brief = await save('BRIEF_EXTRACT', 'brief', [
    { type: 'brief', aiStance: rec('完整度 80%'), body: {
      raw_text: '给初中生做 AI 学习陪练', completeness: 80, highlights: [],
      fields: { problem_statement: '初中生课后卡题没人问', target_user: '初二学生', scenario: '晚上独自写作业', value_prop: '卡住时即时讲解', success_criteria: '每周练习时长 +30%', time_constraint: null, boundaries: ['不做家长监控'] },
    } },
    { type: 'red_line', body: { text: '不做班级排名羞辱' } },
    { type: 'assumption', body: { statement: '学生愿意晚上主动打开', status: 'untested' } },
  ]);
  await accept(brief.created.map((i) => i.id));

  const users = await save('USERS_JTBD', 'users', [
    { ref: 'p1', type: 'persona', aiStance: rec('主要用户'), body: { id: 'p1', role: 'primary', name: '小米 · 初二', one_liner: '数学薄弱', meta: '14 岁', story: 's', pain: 'p' } },
    { ref: 'p2', type: 'persona', body: { id: 'p2', role: 'candidate', name: '王老师', one_liner: '批改到深夜', meta: 'm', story: 's', pain: 'p' } },
    { ref: 'j1', type: 'job', aiStance: rec('核心'), body: { id: 'j1', title: '卡住时知道下一步', reach: 8, impact: 3, source: '访谈', dimension: 'functional', persona_ids: ['p1'] } },
    { ref: 'j2', type: 'job', body: { id: 'j2', title: '不被同学比下去', reach: 6, impact: 2, source: '访谈', dimension: 'emotional', persona_ids: ['p1'] } },
  ]);
  const [p1, p2, j1, j2] = users.created;
  await accept([p1.id, j1.id, j2.id]);
  await accept([p2.id], 'rejected');
  await repo.updateItem(P, j2.id, { body: { ...j2.body, title: '不被同学比下去（含家长期待）' } }, { actor: 'human' });

  const stake = await save('STAKE_MATRIX', 'stake', [
    { type: 'stakeholder', body: { id: 's1', name: '教研组', role: '内容把关', power: 'high', interest: 'high', note: '决定题库口径', source: 's', required: true, category: 'business' } },
    { type: 'engagement_plan', body: { manage: '每周对齐题库', satisfy: '月报', inform: '上线通知', monitor: '季度回访' } },
  ]);
  await accept(stake.created.map((i) => i.id));

  const alt = await save('ALT_SCAN', 'alt', [
    { type: 'alternative', body: { id: 'a1', name: '作业帮', category: 'direct', description: '拍照搜题', why_users_use: '快', threat_level: 'high', sources: [] } },
    { type: 'alternative', body: { id: 'a2', name: '问同学', category: 'non_consumption', description: '微信群里问', why_users_use: '免费', threat_level: 'medium', sources: [] } },
    { type: 'diff_hypothesis', body: { statement: '只讲思路不给答案，家长才放心', key_threats: ['搜题工具直接给答案'] } },
  ]);
  await accept(alt.created.map((i) => i.id));

  const scen = await save('SCEN_PAIN', 'scen', [
    { ref: 'sc1', type: 'scenario', body: { id: 'sc1', title: '周三晚上的几何题', meta: '21:30 · 卧室', narrative: '小米卡在辅助线上，问同学没人回。', pain_hint: '越拖越慌', element_ids: ['e1', 'e2', 'e3'] } },
    { ref: 'pp1', type: 'pain_point', body: { id: 'pp1', scenario_id: 'sc1', moment: '想不出辅助线', feeling: '慌', why_1: 'a', why_2: 'b', why_3: 'c', root_cause: '缺少可迁移的解题套路' } },
    { ref: 'in1', type: 'insight', body: { id: 'in1', scenario_id: 'sc1', insight_text: '在深夜卡题时，小米需要的是下一步提示而不是答案', action: '提供分步提示' } },
  ]);
  await accept(scen.created.map((i) => i.id));

  const feat = await save('FEAT_DRAFT', 'final', [
    { type: 'pillar', body: { id: 'pl1', name: '即时反馈', description: 'd' } },
    feature('f1', '分步提示', 96, [j1.id]),
    feature('f2', '错题本', 40, []),
    feature('f3', '班级排行榜', 30, [j2.id], { red_line_risk: true, ethics_concern: '公开排名' }),
    { type: 'not_doing', body: { name: '家长监控', reason: 'boundary', why: 'Brief 边界明确不做' } },
  ]);
  const [, f1, f2, f3, nd] = feat.created;
  await accept([f1.id, f2.id, nd.id]);
  await accept([f3.id], 'rejected');

  const section = (body: Record<string, unknown>, stance = rec('与 Brief 一致')): ItemDraft => ({ type: 'design_section', body, aiStance: stance });
  const design = await save('DESIGN_PROPOSAL', 'final', [
    section({ kind: 'overview', title: 'AI 学习陪练', one_liner: '卡住时的下一步', vision: '让学生自己想出来' }),
    section({ kind: 'principles', items: ['只给提示不给答案', '三步内到达'] }),
    section({ kind: 'flow', name: '卡题求助', goal: '30 秒内拿到提示', precondition: 'p', success_criteria: 's', failure_handling: 'f', steps: [{ step: 1, actor: '学生', action: '拍题', system_response: '识别题目' }, { step: 2, actor: '学生', action: '点「下一步」', system_response: '给出提示' }] }),
    section({ kind: 'data_entity', name: 'Hint', description: '一条提示', fields: [{ name: 'id', type: 'uuid' }, { name: 'step', type: 'int' }] }),
    section({ kind: 'metric', name: '提示采纳率', definition: '看完提示后继续作答的比例', target: '≥ 60%' }),
    section({ kind: 'milestone', phase: 'M1', goal: '几何题跑通', deliverables: ['提示引擎'], duration: '4w' }),
    section({ kind: 'risk', risk: '提示太直白变成给答案', mitigation: '人工抽检' }, caution('需要抽检机制')),
    section({ kind: 'open_question', text: '题库从哪来？' }, caution('成本未评估')),
    { ref: 'm1', type: 'module', aiStance: rec('核心'), body: { id: 'm1', name: '提示引擎', responsibility: '生成分步提示', feature_ids: [f1.id], key_screens: ['提示页'] } },
    { ref: 'm2', type: 'module', aiStance: rec('辅助'), body: { id: 'm2', name: '错题管理', responsibility: '收集错题', feature_ids: [f2.id], key_screens: ['错题本'], depends_on: ['m1'] } },
  ]);
  await accept(design.created.map((i) => i.id));

  const split = await save('SPLIT_SUBFEATURES', 'split', [
    { ref: 's1', type: 'subtask', aiStance: rec('r'), body: { ...subtask('s1', '实现提示接口', '2d', []), feature_id: f1.id, module_id: design.idMap['module:m1'], feature_name: '分步提示', critical: true } },
    { ref: 's2', type: 'subtask', aiStance: rec('r'), body: { ...subtask('s2', '画提示页, 含 "下一步" 按钮', '1.5d', ['s1']), feature_id: f1.id, feature_name: '分步提示', critical: true } },
    { ref: 's3', type: 'subtask', aiStance: caution('估时把握低'), body: { ...subtask('s3', '错题导入', '2-3d', ['s4']), feature_id: f2.id, module_id: design.idMap['module:m2'], feature_name: '错题本', critical: false } },
    { ref: 's4', type: 'subtask', body: { ...subtask('s4', '题目识别调研', '1w', []), feature_id: f2.id, feature_name: '错题本', critical: false } },
  ]);
  const [s1, s2, s3] = split.created;
  await accept([s2.id, s1.id, s3.id]);
  await repo.createItem(P, { node: 'split', type: 'subtask', body: { title: '埋点上报', description: '记录提示采纳', layer: 'data', estimate: '4h', acceptance_criteria: [], critical: false }, links: [{ to: f1.id, rel: 'implements' }] });

  const check = await save('CONSISTENCY_CHECK', 'split', [
    { type: 'finding', node: 'final', aiStance: rec('明确冲突'), body: { item_ids: [f2.id, nd.id], title: '错题本会导出给家长', description: '错题本的分享设计接近「家长监控」', severity: 'medium', suggested_fix: '去掉导出给家长' } },
    { type: 'finding', node: 'final', aiStance: caution('不确定'), body: { item_ids: [f1.id], title: '提示可能直接泄露答案', description: 'd', severity: 'low', suggested_fix: 'f' } },
  ]);
  await accept([check.created[0].id]);
  return repo.getGraph(P);
}
