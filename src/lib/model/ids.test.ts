import { describe, expect, it } from 'vitest';
import { createIdAllocator, cryptoIdSource, ID_RANDOM_LENGTH, idPrefix, newId } from './ids';
import { seqIdSource } from './__fixtures__/model';

describe('newId', () => {
  it('formats <prefix>_<random>', () => {
    expect(newId('job', new Set(), () => 'k3f9a2xx')).toBe('job_k3f9a2xx');
  });

  it('retries on collision with taken ids', () => {
    const source = seqIdSource();
    expect(newId('job', new Set(['job_00000001', 'job_00000002']), source)).toBe('job_00000003');
  });

  it('throws when the source keeps colliding', () => {
    expect(() => newId('job', new Set(['job_aaaaaaaa']), () => 'aaaaaaaa')).toThrow(/unique id/);
  });
});

describe('cryptoIdSource', () => {
  it('returns lowercase base36 of the requested length', () => {
    for (let i = 0; i < 50; i++) {
      expect(cryptoIdSource(ID_RANDOM_LENGTH)).toMatch(/^[0-9a-z]{8}$/);
    }
  });
});

describe('createIdAllocator', () => {
  it('never hands out the same id twice, nor a pre-taken one', () => {
    const alloc = createIdAllocator(['lnk_00000001'], seqIdSource());
    const ids = [alloc('lnk'), alloc('lnk'), alloc('evt')];
    expect(ids).toEqual(['lnk_00000002', 'lnk_00000003', 'evt_00000004']);
  });
});

describe('idPrefix', () => {
  it('extracts the type prefix', () => {
    expect(idPrefix('job_k3f9a2xx')).toBe('job');
    expect(idPrefix('nounderscore')).toBeNull();
  });
});
