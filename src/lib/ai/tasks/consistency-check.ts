import { NODES } from '../../../data/nodes';
import type { RegenerationFeedback } from '../../model/feedback';
import { feedbackBlock } from '../feedback-prompt';
import { dataBlock } from '../prompt';
import { runTask, type RunTaskResult, type TaskOptions } from '../run-task';
import { ConsistencyCheckSchema, type ConsistencyCheck, type ConsistencyItem } from '../schemas/consistency-check';
import { stancePromptFragment } from '../stance-prompt';

/**
 * 跨节点一致性检查 · 手动触发
 * 输入：各节点已采纳（尚无采纳时为未否决）的条目摘要 + 条目之间的关联
 * 输出：0-12 条矛盾发现（涉及条目 id、说明、严重度、修正建议、AI 自己的把握）
 */

const SYSTEM_PROMPT = `你是「思考工作台」的一致性审查员。项目已经走过若干节点（Brief、用户与 Job、干系人、替代方案、情景、功能列表、创造性跃迁、设计案、子任务拆分），人已经对 AI 的产出做了取舍。你的任务：找出这些已经被采纳的决定之间真实存在的矛盾，让人来裁决怎么处理。

# 什么算矛盾
- 功能、设计、模块或子任务违背了 Brief 的道德红线、明确边界或"不做清单"
- 设计或子任务与它所服务的功能 / Job / 用户画像对不上（服务对象、场景、约束相互冲突）
- 两条已采纳的条目给出互相排斥的结论（目标用户、优先级、成功指标、时间约束、范围）
- 后续决定默默推翻了某条假设，或建立在已被证伪的假设上
- 差异化假设与实际的功能 / 设计相悖

# 不算矛盾（不要报）
- 结构性缺失（某功能没关联 Job、某子任务没关联功能、某模块没有功能、某功能没有任何子任务）：系统有确定性规则在查，不需要你报
- 拆分完整度（某功能的子任务不够、某段逻辑没有对应的子任务、"还应该补一个子任务"）：这是覆盖问题不是矛盾，不要报。子任务挂到了内容明显不符的功能上、或子任务的做法与功能的明确约束相反，才算矛盾
- "还可以更好"的建议、措辞问题、细节不够
- 资料里找不到依据的猜测

# 读资料的方式
- 每条资料形如 [id] 类型（已采纳 / 未裁决）：内容；"关联"列出它指向的其他条目（rel:id）
- "未裁决"表示该类条目还没有被人采纳任何一条，暂按 AI 产出看待；矛盾优先关注"已采纳"之间

# 输出
- findings：0-12 条，按严重程度从高到低；没有真实矛盾就输出空数组，不要硬凑
- item_ids：涉及的条目 id，必须原样取自资料方括号里的 id，至少 1 个，通常是冲突的双方
- title：一句话（≤ 30 字）
- description：具体说明哪几处说法冲突、为什么冲突（引用条目内容）
- severity：high = 照此执行会做错产品或越过红线；medium = 会造成返工或目标偏离；low = 小的不一致
- suggested_fix：建议人怎么处理（改哪条、否决哪条、补什么决定）

${stancePromptFragment(
  '每一条发现',
  '对一致性发现而言：recommend = 你有把握这是真实矛盾、值得处理；neutral = 可能矛盾，取决于团队怎么理解这些条目；caution = 你自己也不太确定，可能是误报，需要人重点判断。',
)}

严格 JSON 输出：{ "findings": [...] }`;

const NODE_TITLE = new Map(NODES.map((n) => [n.kind as string, `${n.num} ${n.label}`]));
const DECISION_LABEL = { accepted: '已采纳', pending: '未裁决' } as const;

function itemLine(i: ConsistencyItem): string {
  const links = i.links.length > 0 ? `\n  关联：${i.links.join('，')}` : '';
  return `- [${i.id}] ${i.type}（${DECISION_LABEL[i.decision]}）：${i.text}${links}`;
}

/** Items grouped under their node heading, in node order. */
export function formatConsistencyItems(items: readonly ConsistencyItem[]): string {
  const groups = new Map<string, ConsistencyItem[]>();
  for (const i of items) groups.set(i.node, [...(groups.get(i.node) ?? []), i]);
  return NODES.filter((n) => groups.has(n.kind))
    .map((n) => `## ${NODE_TITLE.get(n.kind)}\n${(groups.get(n.kind) ?? []).map(itemLine).join('\n')}`)
    .join('\n\n');
}

export async function consistencyCheck(args: {
  items: readonly ConsistencyItem[];
  feedback?: RegenerationFeedback;
}, opts?: TaskOptions): Promise<RunTaskResult<ConsistencyCheck>> {
  return runTask({
    task: 'CONSISTENCY_CHECK',
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content:
        `请检查以下项目条目之间的矛盾：\n\n${dataBlock('project_items', formatConsistencyItems(args.items))}` +
        feedbackBlock(args.feedback),
    }],
    schema: ConsistencyCheckSchema,
    maxTokens: 6000,
    temperature: 0.2,
    options: opts,
  });
}
