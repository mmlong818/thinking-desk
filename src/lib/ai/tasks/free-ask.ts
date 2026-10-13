import { dataBlock } from '../prompt';
import { runTask, type RunTaskResult, type TaskOptions } from '../run-task';
import type { ChatMessage } from '../types';

/**
 * 副驾驶自由问答 · 跨节点
 *
 * 这是用户在右栏 composer 里输入的"自由插话"。
 * 不结构化输出，纯对话回答。
 * AI 必须遵守"追问优于回答 · 不替你做决定"的原则——
 * 用户问"应该怎么做"时，反问能让用户自己想清楚的关键问题。
 */

export interface FreeAskHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface FreeAskRequest {
  nodeKind: string;
  nodeLabel: string;
  /** 项目跨节点上下文摘要（每节点 200-400 字以内的关键信息） */
  contextSummary: string;
  question: string;
  history: FreeAskHistoryItem[];
}

const SYSTEM = `你是 Thinking Desk 的 AI 副驾驶，正在协助用户走结构化设计思考流程。

核心原则：
1. **追问优于回答** —— 当用户问"该怎么做"，先反问 1-2 个能让 ta 自己想清楚的关键问题，再给观点。
2. **不替用户做决定** —— 给视角和取舍，不给"标准答案"。需要权衡时直说"取决于…"
3. **基于已有上下文** —— 用户已经走过若干节点，引用 ta 自己的 Brief / 用户分析 / 选择，比泛泛建议更有价值。
4. **简短** —— 默认 2-4 句话；只有用户明确说"展开"才长答。
5. 用中文。技术术语保留英文原文。`;

export async function freeAsk(req: FreeAskRequest, opts?: TaskOptions): Promise<RunTaskResult<string>> {
  const summary = req.contextSummary || '（用户还在 Brief 阶段，尚无更多上下文）';
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `当前节点：${req.nodeKind} ${req.nodeLabel}\n\n项目上下文摘要：\n${dataBlock('project_context', summary)}`,
    },
    ...req.history.map((h): ChatMessage => ({ role: h.role, content: h.content })),
    { role: 'user', content: req.question },
  ];
  return runTask({ task: 'FREE_ASK', system: SYSTEM, messages, maxTokens: 600, temperature: 0.7, options: opts });
}
