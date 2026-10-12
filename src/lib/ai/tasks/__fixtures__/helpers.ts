/** Build an array of `n` items from a factory (index starts at 1). */
export function many<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, k) => make(k + 1));
}

/** Shallow-clone `obj` and delete one top-level key (for "missing required field" fixtures). */
export function without<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}
