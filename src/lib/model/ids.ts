// Permanent ids: `<type prefix>_<8 random base36 chars>`, unique per project.
// The random source is injectable so tests can be deterministic.

export type IdSource = (length: number) => string;

export const ID_RANDOM_LENGTH = 8;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
// Largest multiple of 36 below 256: bytes >= this are rejected to avoid modulo bias.
const UNBIASED_LIMIT = 252;
const MAX_ATTEMPTS = 16;

export const cryptoIdSource: IdSource = (length) => {
  let out = '';
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < UNBIASED_LIMIT && out.length < length) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
};

export function newId(prefix: string, taken: ReadonlySet<string>, source: IdSource = cryptoIdSource): string {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const id = `${prefix}_${source(ID_RANDOM_LENGTH)}`;
    if (!taken.has(id)) return id;
  }
  throw new Error(`could not allocate a unique id with prefix "${prefix}"`);
}

export function idPrefix(id: string): string | null {
  const i = id.indexOf('_');
  return i > 0 ? id.slice(0, i) : null;
}

/** Allocates ids that are unique against `taken` and against each other. */
export function createIdAllocator(taken: Iterable<string>, source: IdSource = cryptoIdSource) {
  const used = new Set(taken);
  return (prefix: string): string => {
    const id = newId(prefix, used, source);
    used.add(id);
    return id;
  };
}
export type IdAllocator = ReturnType<typeof createIdAllocator>;
