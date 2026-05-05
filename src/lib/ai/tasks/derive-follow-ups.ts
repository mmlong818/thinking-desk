import { z } from 'zod';
import { runAi } from '../router';
import {
  FollowUpItemSchema,
  FOLLOW_UPS_SCHEMA_FRAGMENT,
  FOLLOW_UPS_PROMPT_FRAGMENT,
  type FollowUpItem,
} from '../follow-ups';

/**
 * 通用"派生追问"任务：给定某节点已经产出的 content（任意 JSON），
 * 让 AI 找出 3-5 个最值得用户进一步澄清的关键缺失，
 * 用副驾驶逐题追问 runner 推进。
 *
 * 不修改各节点本身的 schema —— 而是事后单独调用一次。
 * 同一节点的同一份 content + 同一个 nodeKind 调用结果应可缓存（前端 cache 了）。
 */

const ResultSchema = z.object({
  follow_ups: z.array(FollowUpItemSchema).max(5).default([]),
});
export type DeriveFollowUpsResult = z.infer<typeof ResultSchema>;

const JSON_SCHEMA = {
  type: 'object',
  required: ['follow_ups'],
  properties: {
    follow_ups: FOLLOW_UPS_SCHEMA_FRAGMENT,
  },
};

const NODE_LABELS: Record<string, string> = {
  brief: '01 Brief（问题陈述）',
  users: '02 用户与任务 (JTBD)',
  stake: '03 干系人 (Mendelow)',
  alt: '04 替代方案（直接/间接/非消费）',
  scen: '05 情景（六维 × 故事板）',
  feat: '06 功能列表（市场常规方案）',
  leap: '07 创造性跃迁（差异化）',
  final: '08 设计案（完整设计文档）',
  split: '09 子功能拆分',
};

const SYSTEM_PROMPT = `你是「思考工作台」的 AI 副驾驶。用户已完成某个节点的初步产出，现在你要识别"还没说清楚但下游会卡住"的关键缺失，逐条问用户。

# 规则
1. 只问 3-5 条 —— 优先问"决定下游节点能否落地"的关键缺失，不要问对结果影响很小的细节
2. 每条 follow_up：
${FOLLOW_UPS_PROMPT_FRAGMENT.split('\n').map((l) => '   ' + l).join('\n')}
3. 不要重复用户已经在 content 里说清楚的事
4. 如果当前 content 已经相当完整，可以返回空数组 []

# 输出
严格 JSON：{ follow_ups: [...] }
没有其他内容、没有 Markdown。`;

export async function deriveFollowUps(args: {
  nodeKind: string;
  content: unknown;
  override?: string;
}): Promise<FollowUpItem[]> {
  const label = NODE_LABELS[args.nodeKind] ?? args.nodeKind;
  const contentJson = JSON.stringify(args.content, null, 2);

  const res = await runAi({
    task: 'FOLLOW_UPS',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `当前节点：${label}\n\n` +
          `## 节点已产出的 content（JSON）\n\`\`\`json\n${contentJson}\n\`\`\`\n\n` +
          `请返回 follow_ups。`,
      },
    ],
    schema: JSON_SCHEMA,
    maxTokens: 4000,
    temperature: 0.4,
    override: args.override,
  });
  const parsed = ResultSchema.parse(res.data);
  return parsed.follow_ups;
}
