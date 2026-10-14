// Questionnaire options that ask for a note: "其他（请补充）" and any other "…（请补充）" option.
const NEEDS_NOTE = /其他|请补充/;
const NOTE_PROMPT = /\s*[（(]\s*请补充\s*[)）]\s*$/;

export function needsNote(option: string): boolean {
  return NEEDS_NOTE.test(option);
}

/** The answer sent to the AI: the option without its "（请补充）" prompt, plus the note if one was written. */
export function answerText(option: string, note: string): string {
  const base = option.replace(NOTE_PROMPT, '').trim();
  const text = note.trim();
  return text ? `${base}：${text}` : base;
}
