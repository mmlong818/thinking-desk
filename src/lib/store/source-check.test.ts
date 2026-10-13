import { describe, expect, it } from 'vitest';
import { validAlternatives } from '../ai/schemas/__fixtures__/alternatives';
import type { Item } from '../model/item-types';
import { makeItem, T1 } from '../model/__fixtures__/model';
import { checkableEvidence, checkSourceUrls, sourceJobs, subjectOf, withResults } from './source-check';

const { id: _id, ...altBody } = validAlternatives.alternatives[0];
const alt = (id: string, extra: Partial<Item> = {}, sources: string[] = []) =>
  makeItem({ id, node: 'alt', type: 'alternative', body: { ...altBody, name: `Alt ${id}`, sources }, ...extra });

const withEvidence = alt('alt_e', {
  evidence: { basis: 'web', sources: [{ title: '', url: 'https://a.example/', verified: false }, { title: '只有标题', verified: false }] },
});
const legacy = alt('alt_l', {}, ['https://b.example/x', 'https://b.example/y']);
const none = alt('alt_n');

describe('which sources a check covers', () => {
  it('uses the evidence, or builds it from a legacy alternative body, and skips items without URLs', () => {
    expect(checkableEvidence(withEvidence)).toBe(withEvidence.evidence);
    expect(checkableEvidence(legacy)?.sources.map((s) => s.url)).toEqual(['https://b.example/x', 'https://b.example/y']);
    expect(checkableEvidence(none)).toBeNull();
    const jobs = sourceJobs([withEvidence, legacy, none]);
    expect(jobs.map((j) => [j.item.id, j.requests])).toEqual([
      ['alt_e', [{ url: 'https://a.example/', subject: 'Alt alt_e' }]],
      ['alt_l', [{ url: 'https://b.example/x', subject: 'Alt alt_l' }, { url: 'https://b.example/y', subject: 'Alt alt_l' }]],
    ]);
    expect(subjectOf(makeItem({ id: 'p' }))).toBe('P');
  });
});

describe('applying results', () => {
  it('writes status, verified, checkedAt, page title and detail onto the URL sources only, in order', () => {
    const next = withResults(withEvidence.evidence!, [
      { url: 'https://a.example/', status: 'unreachable', verified: false, httpStatus: 404, detail: 'HTTP 404' },
    ], T1);
    expect(next.sources).toEqual([
      { title: '', url: 'https://a.example/', verified: false, status: 'unreachable', checkedAt: T1, detail: 'HTTP 404' },
      { title: '只有标题', verified: false },
    ]);
    const again = withResults(next, [{ url: 'https://a.example/', status: 'title_match', verified: true, pageTitle: 'A' }], T1);
    expect(again.sources[0]).toEqual({ title: '', url: 'https://a.example/', verified: true, status: 'title_match', checkedAt: T1, pageTitle: 'A' });
  });
});

describe('checkSourceUrls', () => {
  it('batches by 20 and keeps the order', async () => {
    const calls: number[] = [];
    const fetch = async (_url: string, init?: RequestInit) => {
      const { sources } = JSON.parse(String(init?.body)) as { sources: { url: string }[] };
      calls.push(sources.length);
      return Response.json({ ok: true, results: sources.map((s) => ({ url: s.url, status: 'reachable', verified: false })) });
    };
    const requests = Array.from({ length: 45 }, (_, i) => ({ url: `https://e.example/${i}` }));
    const results = await checkSourceUrls(fetch, requests);
    expect(calls).toEqual([20, 20, 5]);
    expect(results.map((r) => r.url)).toEqual(requests.map((r) => r.url));
  });

  it('turns a rate limit or a malformed answer into a readable error', async () => {
    const limited = async () => Response.json({ error: 'rate_limited', detail: 'try again in 30s' }, { status: 429 });
    await expect(checkSourceUrls(limited, [{ url: 'https://e.example/' }])).rejects.toThrow('核实太频繁');
    const broken = async () => Response.json({ ok: true, results: [{ nope: 1 }] });
    await expect(checkSourceUrls(broken, [{ url: 'https://e.example/' }])).rejects.toThrow('核实失败');
  });
});
