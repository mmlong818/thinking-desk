// Prompt fragment for tasks whose output carries a per-item `stance` (schemas/stance.ts).

/**
 * The shared rules for `stance`, followed by what the verdicts mean for this task's items
 * (`scope`: where stance goes; `meaning`: task-specific reading of recommend / caution).
 */
export function stancePromptFragment(scope: string, meaning: string): string {
  return `# stance（每一条都必须给）
你主导产出，人来裁决。${scope}都要附上你自己对它的判断 stance = { verdict, reason }：
- verdict = "recommend"：你有把握，建议人直接采纳
- verdict = "neutral"：合理，但取决于团队取舍，或现有信息不足以判断
- verdict = "caution"：你有明确疑虑，需要人重点审查
- reason：一句话（≤ 40 字），具体到这一条，不要套话
${meaning}
按真实把握给，不要为了显得自信全部给 recommend；没有疑虑的地方也不要硬凑 caution。stance 是你的自评，正文仍按上面的风格要求写。`;
}
