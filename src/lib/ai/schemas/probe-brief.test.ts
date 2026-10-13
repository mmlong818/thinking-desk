import { describe, expect, it } from 'vitest';
import { ProbeResultSchema } from './probe-brief';
import { invalidProbe, validProbeDone, validProbeQuestion } from './__fixtures__/probe-brief';

describe('ProbeResultSchema', () => {
  it('accepts both the "question" and "done" branches', () => {
    expect(ProbeResultSchema.parse(validProbeQuestion)).toMatchObject({ action: 'question', hints: [] });
    expect(ProbeResultSchema.safeParse(validProbeDone).success).toBe(true);
  });

  it('rejects a question missing "why"', () => {
    expect(ProbeResultSchema.safeParse(invalidProbe).success).toBe(false);
  });
});
