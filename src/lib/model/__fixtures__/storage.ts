import type { StorageLike } from '../local-repository';

export interface MemoryStorage extends StorageLike {
  data: Map<string, string>;
  failWrites: boolean;
}

export function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const data = new Map(Object.entries(initial));
  const s: MemoryStorage = {
    data,
    failWrites: false,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (s.failWrites) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
  };
  return s;
}
