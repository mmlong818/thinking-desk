import type { ItemType } from '@/lib/model/types';

/** Chinese names of item types for completion status, notices and exports. */
export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  brief: 'Brief',
  assumption: '假设',
  red_line: '道德红线',
  persona: '用户画像',
  job: 'Job',
  stakeholder: '干系人',
  engagement_plan: '沟通节奏',
  alternative: '替代方案',
  alt_profile: '战略画像',
  alt_breakdown: '功能拆解',
  diff_hypothesis: '差异化假设',
  scenario_element: '情景要素',
  scenario: '情景',
  matrix_cell: '矩阵格',
  extreme: '极值情景',
  hostile: '敌意情景',
  pain_point: '痛点',
  delight_point: '快点',
  insight: '设计启发',
  pillar: '支柱',
  feature: '功能',
  not_doing: '不做清单',
  first_principle: '第一性原理',
  analogy: '类比迁移',
  constraint_flip: '约束反转',
  revision: '修订记录',
  design_section: '设计章节',
  module: '模块',
  subtask: '子任务',
  summary: '总结',
  critique: '挑战',
  finding: '一致性发现',
};

export interface FieldSpec {
  key: string;
  label: string;
  /** Multi-line editor. */
  long?: boolean;
}

/** The free-text fields a person can edit in place ("✎ 编辑") per item type. */
export const ITEM_EDIT_FIELDS: Partial<Record<ItemType, FieldSpec[]>> = {
  persona: [
    { key: 'name', label: '名字' }, { key: 'one_liner', label: '一句话' }, { key: 'meta', label: '标签' },
    { key: 'story', label: '故事', long: true }, { key: 'pain', label: '最烦的一刻', long: true },
  ],
  job: [{ key: 'title', label: 'Job' }, { key: 'source', label: '来源' }],
  stakeholder: [
    { key: 'name', label: '名称' }, { key: 'role', label: '角色' }, { key: 'note', label: '备注', long: true },
    { key: 'engagement_hint', label: '如何对待', long: true },
  ],
  alternative: [
    { key: 'name', label: '名称' }, { key: 'description', label: '描述', long: true },
    { key: 'why_users_use', label: '用户为什么用它', long: true },
  ],
  scenario_element: [{ key: 'text', label: '要素' }],
  scenario: [
    { key: 'title', label: '标题' }, { key: 'meta', label: '元信息' },
    { key: 'narrative', label: '叙事', long: true }, { key: 'pain_hint', label: '隐约的不对劲', long: true },
  ],
  extreme: [
    { key: 'pushed_to_limit', label: '推到' }, { key: 'description', label: '描述', long: true },
    { key: 'robustness_gap', label: '鲁棒性缺口', long: true },
  ],
  hostile: [
    { key: 'attack', label: '攻击' }, { key: 'vulnerable_users', label: '受害者' },
    { key: 'mitigation', label: '缓解', long: true },
  ],
  pain_point: [
    { key: 'moment', label: '时刻' }, { key: 'feeling', label: '感受' }, { key: 'root_cause', label: '底层根因', long: true },
  ],
  delight_point: [
    { key: 'moment', label: '时刻' }, { key: 'root_reason', label: '真正打动的是', long: true },
    { key: 'opportunity', label: '产品机会', long: true },
  ],
  insight: [{ key: 'insight_text', label: '启发', long: true }, { key: 'action', label: '设计动作', long: true }],
  feature: [
    { key: 'name', label: '功能' }, { key: 'description', label: '描述', long: true },
    { key: 'core_hypothesis', label: '核心假设', long: true }, { key: 'validation_metric', label: '验证指标' },
    { key: 'failure_signal', label: '失败信号' },
  ],
  not_doing: [{ key: 'name', label: '不做什么' }, { key: 'why', label: '为什么', long: true }],
  first_principle: [
    { key: 'industry_assumption', label: '行业共识', long: true }, { key: 'physical_floor', label: '真实底层', long: true },
    { key: 'opportunity', label: '设计机会', long: true },
  ],
  analogy: [
    { key: 'core_essence', label: '本质' }, { key: 'source_domain', label: '借鉴领域' },
    { key: 'source_mechanism', label: '源领域机制', long: true },
    { key: 'transferred_mechanism', label: '迁移到本项目', long: true },
    { key: 'adaptation_notes', label: '适配提示', long: true },
  ],
  constraint_flip: [
    { key: 'original', label: '原约束', long: true }, { key: 'flipped', label: '反转后', long: true },
    { key: 'surprise', label: '暴露了什么', long: true }, { key: 'impact_on_features', label: '对功能列表的影响', long: true },
  ],
};
