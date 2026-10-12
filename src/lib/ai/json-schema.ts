import { z } from 'zod';
import type { JsonSchema } from './types';

// Zod output schema -> JSON Schema for providers.
//
// taskJsonSchema() is the canonical form (Zod 4 z.toJSONSchema, output side: fields with a
// .default() are required, objects are closed). adaptSchema() rewrites it into the subset a
// provider's native structured output accepts, or returns null when it cannot express it,
// in which case the provider embeds the canonical schema in the prompt instead. Constraints a
// dialect drops are moved into `description` so the model still sees them; runTask() enforces
// the full Zod schema on the result either way.

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Canonical JSON Schema of what a task must return. */
export function taskJsonSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io: 'output' });
  return rest;
}

export interface SchemaDialect {
  /** Constraint keywords the provider enforces; the others move into `description`. */
  readonly constraints: ReadonlySet<string>;
  /** The provider has no `const`: rewrite it as a one-value `enum`. */
  readonly constAsEnum: boolean;
  /** Every object must be closed (additionalProperties: false); maps (records) are inexpressible. */
  readonly closedObjects: boolean;
}

const CONSTRAINT_KEYS = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
]);
const DROPPED_KEYS = new Set(['$schema', 'default', 'examples', 'propertyNames']);

/**
 * Claude `output_config.format` (claude-api skill, shared/tool-use-concepts.md § JSON Schema
 * Limitations): no numeric / string / complex array constraints, additionalProperties: false on
 * every object, anyOf / const / enum supported, no recursion.
 */
export const CLAUDE_DIALECT: SchemaDialect = { constraints: new Set(), constAsEnum: false, closedObjects: true };

/**
 * Gemini `generationConfig.responseJsonSchema` (ai.google.dev/gemini-api/docs/structured-output):
 * properties, required, additionalProperties, enum, format, minimum, maximum, items, prefixItems,
 * minItems, maxItems, title, description, $ref, anyOf; no `const`.
 */
export const GEMINI_DIALECT: SchemaDialect = {
  constraints: new Set(['minimum', 'maximum', 'minItems', 'maxItems']),
  constAsEnum: true,
  closedObjects: false,
};

class Unrepresentable extends Error {}

function walkChildren(node: Node, visit: (n: Node) => Node): Node {
  const out: Node = {};
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'properties' || key === '$defs') && isNode(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isNode(v) ? walk(v, visit) : v]));
    } else if ((key === 'items' || key === 'additionalProperties') && isNode(value)) {
      out[key] = walk(value, visit);
    } else if (['anyOf', 'oneOf', 'allOf', 'prefixItems'].includes(key) && Array.isArray(value)) {
      out[key] = value.map((v) => (isNode(v) ? walk(v, visit) : v));
    } else {
      out[key] = value;
    }
  }
  return out;
}

function walk(node: Node, visit: (n: Node) => Node): Node {
  return visit(walkChildren(node, visit));
}

/** `type: ['string', 'null']` -> `anyOf: [{ type: 'string', … }, { type: 'null' }]`. */
function splitTypeArray(node: Node): Node {
  if (!Array.isArray(node.type)) return node;
  const { type: types, description, ...rest } = node;
  if (types.length === 1) return { ...node, type: types[0] };
  const anyOf = types.map((t) => (t === 'null' ? { type: 'null' } : { ...rest, type: t }));
  return { ...(description !== undefined ? { description } : {}), anyOf };
}

function adaptNode(node: Node, d: SchemaDialect): Node {
  const out: Node = {};
  const moved: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYS.has(key)) continue;
    if (CONSTRAINT_KEYS.has(key) && !d.constraints.has(key)) moved.push(`${key}: ${JSON.stringify(value)}`);
    else if (key === 'oneOf') out.anyOf = value;
    else if (key === 'const' && d.constAsEnum) out.enum = [value];
    else out[key] = value;
  }
  if (moved.length > 0) {
    out.description = [out.description, `(${moved.join(', ')})`].filter(Boolean).join(' ');
  }
  if (d.closedObjects && out.type === 'object') {
    if (isNode(out.additionalProperties)) throw new Unrepresentable('map-shaped object');
    out.additionalProperties = false;
  }
  return splitTypeArray(out);
}

/** The schema in a provider's native dialect, or null when it cannot be expressed there. */
export function adaptSchema(schema: JsonSchema, dialect: SchemaDialect): JsonSchema | null {
  // A bare anyOf root (z.union output) is not reliably accepted as a top-level response format.
  if (schema.type !== 'object') return null;
  try {
    return walk(schema, (n) => adaptNode(n, dialect));
  } catch (e) {
    if (e instanceof Unrepresentable) return null;
    throw e;
  }
}

/** Prompt fallback when a provider has no native structured output for this schema. */
export function schemaInstruction(schema: JsonSchema): string {
  return `你必须只输出 JSON，且严格符合以下 schema（不要包含 Markdown 代码块包裹）：\n${JSON.stringify(schema)}`;
}
