import { describe, expect, it } from 'vitest';
import { adaptSchema, CLAUDE_DIALECT, GEMINI_DIALECT, taskJsonSchema } from '../json-schema';
import { DesignProposalSchema } from './generate-design';
import { NO_STANCE } from './stance';
import { invalidDesign, validDesign } from './__fixtures__/generate-design';

type Node = { properties?: Record<string, Node>; items?: Node; required?: string[] };

describe('DesignProposalSchema', () => {
  it('accepts valid / rejects missing modules', () => {
    expect(DesignProposalSchema.safeParse(validDesign).success).toBe(true);
    expect(DesignProposalSchema.safeParse(invalidDesign).success).toBe(false);
  });

  it('shows the provider a required stance on every part, without a default to copy', () => {
    const schema = taskJsonSchema(DesignProposalSchema) as Node;
    expect(schema.required).toEqual(expect.arrayContaining(['overview_stance', 'principles_stance']));
    for (const part of ['information_architecture', 'modules', 'user_flows', 'data_model', 'metrics', 'risks', 'milestones', 'open_questions']) {
      expect(schema.properties?.[part]?.items?.required, part).toContain('stance');
    }
    expect(JSON.stringify(schema)).not.toContain('"default":{"verdict"');
    expect(adaptSchema(schema, CLAUDE_DIALECT)).not.toBeNull();
    expect(adaptSchema(schema, GEMINI_DIALECT)).not.toBeNull();
  });

  it('parses a missing stance to the empty neutral and keeps bare-string open questions', () => {
    const out = DesignProposalSchema.parse({ ...validDesign, open_questions: ['还没定的事'] });
    expect(out.overview_stance).toEqual(NO_STANCE);
    expect(out.modules[0].stance).toEqual(NO_STANCE);
    expect(out.open_questions).toEqual([{ question: '还没定的事', stance: NO_STANCE }]);
    const bad = { ...validDesign, overview_stance: { verdict: 'maybe', reason: 'r' } };
    expect(DesignProposalSchema.safeParse(bad).success).toBe(false);
  });
});
