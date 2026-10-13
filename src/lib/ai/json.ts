// The one lenient JSON parser for model output (previously copied into each provider).

export class JsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonParseError';
  }
}

/**
 * Parses model output that should be JSON: strips a Markdown code fence and, failing that,
 * falls back to the outermost `{…}` / `[…]` span (models sometimes wrap JSON in prose).
 */
export function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through to the error below
      }
    }
    throw new JsonParseError(`response is not valid JSON. First 200 chars: ${trimmed.slice(0, 200)}`);
  }
}
