import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { adaptSchema, CLAUDE_DIALECT, GEMINI_DIALECT, schemaInstruction, taskJsonSchema } from './json-schema';
import type { JsonSchema } from './types';

const Sample = z.object({
  title: z.string().min(1),
  note: z.string().optional(),
  group: z.string().optional().default(''),
  maybe: z.string().nullable(),
  tags: z.array(z.string()).min(3).max(6),
  score: z.number().int().min(0).max(100),
  kind: z.discriminatedUnion('k', [z.object({ k: z.literal('a') }), z.object({ k: z.literal('b'), n: z.number() })]),
});

/** Every node of a JSON Schema document. */
function nodes(schema: unknown): Record<string, unknown>[] {
  if (typeof schema !== 'object' || schema === null) return [];
  if (Array.isArray(schema)) return schema.flatMap(nodes);
  return [schema as Record<string, unknown>, ...Object.values(schema).flatMap(nodes)];
}

describe('taskJsonSchema', () => {
  it('describes the parsed output: defaulted fields are required, objects closed, no $schema', () => {
    const s = taskJsonSchema(Sample);
    expect(s).not.toHaveProperty('$schema');
    expect(s.required).toEqual(['title', 'group', 'maybe', 'tags', 'score', 'kind']);
    expect(s.additionalProperties).toBe(false);
  });
});

describe('adaptSchema · Claude', () => {
  const s = adaptSchema(taskJsonSchema(Sample), CLAUDE_DIALECT) as JsonSchema;
  const props = s.properties as Record<string, Record<string, unknown>>;

  it('moves unsupported constraints into the description', () => {
    expect(props.tags).toEqual({ type: 'array', items: { type: 'string' }, description: '(minItems: 3, maxItems: 6)' });
    expect(props.score).toEqual({ type: 'integer', description: '(minimum: 0, maximum: 100)' });
    expect(props.title).toEqual({ type: 'string', description: '(minLength: 1)' });
  });

  it('drops defaults, rewrites oneOf and nullable type arrays to anyOf, keeps const', () => {
    expect(props.group).toEqual({ type: 'string' });
    expect(props.maybe).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(props.kind).toHaveProperty('anyOf');
    expect(props.kind).not.toHaveProperty('oneOf');
    expect(JSON.stringify(props.kind)).toContain('"const":"a"');
  });

  it('closes every object and leaves no unsupported keyword anywhere', () => {
    const all = nodes(s);
    for (const n of all.filter((x) => x.type === 'object')) expect(n.additionalProperties).toBe(false);
    for (const key of ['minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'default', 'oneOf', '$schema']) {
      expect(all.some((n) => key in n)).toBe(false);
    }
  });

  it('returns null for what it cannot express: a union root or a map-shaped object', () => {
    expect(adaptSchema(taskJsonSchema(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })])), CLAUDE_DIALECT)).toBeNull();
    expect(adaptSchema(taskJsonSchema(z.object({ m: z.record(z.string(), z.string()) })), CLAUDE_DIALECT)).toBeNull();
  });
});

describe('adaptSchema · Gemini', () => {
  const s = adaptSchema(taskJsonSchema(Sample), GEMINI_DIALECT) as JsonSchema;
  const props = s.properties as Record<string, Record<string, unknown>>;

  it('keeps the bounds Gemini supports and moves the rest', () => {
    expect(props.tags).toMatchObject({ minItems: 3, maxItems: 6 });
    expect(props.score).toMatchObject({ minimum: 0, maximum: 100 });
    expect(props.title).toEqual({ type: 'string', description: '(minLength: 1)' });
  });

  it('rewrites const as a one-value enum', () => {
    expect(JSON.stringify(props.kind)).toContain('"enum":["a"]');
    expect(nodes(s).some((n) => 'const' in n)).toBe(false);
  });

  it('does not change the input schema', () => {
    const canonical = taskJsonSchema(Sample);
    const before = JSON.stringify(canonical);
    adaptSchema(canonical, GEMINI_DIALECT);
    expect(JSON.stringify(canonical)).toBe(before);
  });
});

describe('schemaInstruction', () => {
  it('embeds the schema for providers without native structured output', () => {
    expect(schemaInstruction({ type: 'object' })).toContain('{"type":"object"}');
  });
});
