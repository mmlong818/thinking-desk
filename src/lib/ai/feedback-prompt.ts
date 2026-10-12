import { isEmptyFeedback, type RegenerationFeedback } from '../model/feedback';
import { dataBlock } from './prompt';

// Renders a RegenerationFeedback (docs/data-model.md § "Regeneration") for the user message of a
// regenerating task: what the person kept stays and must not be duplicated; what they rejected,
// with their reason, is a direction to steer away from. Empty feedback renders nothing.

function lines(entries: RegenerationFeedback['avoid']): string {
  return entries
    .map((e) => `- [${e.id}] (${e.type}) ${e.summary}${e.note ? ` —— 否决理由：${e.note}` : ''}`)
    .join('\n');
}

export function feedbackBlock(fb: RegenerationFeedback | undefined): string {
  if (!fb || isEmptyFeedback(fb)) return '';
  const parts: string[] = [];
  if (fb.keep.length > 0) parts.push(`### 保留（用户已采纳或亲自修改）\n${lines(fb.keep)}`);
  if (fb.avoid.length > 0) parts.push(`### 避开（用户已否决）\n${lines(fb.avoid)}`);
  return (
    `\n\n## 用户已做的裁决（本次生成必须遵守）\n` +
    `- 「保留」的条目会原样保留：不要重复产出相同或近似的条目；需要引用它们时使用方括号里的 id。\n` +
    `- 「避开」的条目已被用户否决：不要再产出相同或类似的方向，参考否决理由调整。\n` +
    dataBlock('regeneration_feedback', parts.join('\n\n'))
  );
}
