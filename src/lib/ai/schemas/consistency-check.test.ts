import { describe, expect, it } from 'vitest';
import { adaptSchema, CLAUDE_DIALECT, GEMINI_DIALECT, taskJsonSchema } from '../json-schema';
import { ConsistencyCheckSchema } from './consistency-check';
import { NO_STANCE } from './stance';
import { emptyConsistencyCheck, invalidConsistencyCheck, validConsistencyCheck } from './__fixtures__/consistency-check';

type Node = { properties?: Record<string, Node>; items?: Node; required?: string[] };

describe('ConsistencyCheckSchema', () => {
  it('accepts findings, accepts an empty answer, rejects a missing findings array', () => {
    expect(ConsistencyCheckSchema.safeParse(validConsistencyCheck).success).toBe(true);
    expect(ConsistencyCheckSchema.safeParse(emptyConsistencyCheck).success).toBe(true);
    expect(ConsistencyCheckSchema.safeParse(invalidConsistencyCheck).success).toBe(false);
  });

  it('requires at least one involved item and caps the list at 12 findings', () => {
    const [first] = validConsistencyCheck.findings;
    expect(ConsistencyCheckSchema.safeParse({ findings: [{ ...first, item_ids: [] }] }).success).toBe(false);
    expect(ConsistencyCheckSchema.safeParse({ findings: Array(13).fill(first) }).success).toBe(false);
  });

  it('parses a missing stance to the empty neutral, and shows the provider a required stance', () => {
    const { stance: _stance, ...bare } = validConsistencyCheck.findings[0];
    expect(ConsistencyCheckSchema.parse({ findings: [bare] }).findings[0].stance).toEqual(NO_STANCE);
    const schema = taskJsonSchema(ConsistencyCheckSchema) as Node;
    expect(schema.properties?.findings?.items?.required).toContain('stance');
    expect(adaptSchema(schema, CLAUDE_DIALECT)).not.toBeNull();
    expect(adaptSchema(schema, GEMINI_DIALECT)).not.toBeNull();
  });
});
