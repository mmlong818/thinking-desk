import { altEvidence } from '../model/adapters/alternatives';
import { itemSummary } from '../model/feedback';
import type { Item } from '../model/item-types';
import type { Evidence, EvidenceSource } from '../model/types';
import {
  MAX_SOURCES_PER_REQUEST, SourceCheckResponseSchema, type SourceCheckRequest, type SourceCheckResult,
} from '../sources/protocol';

// Checking a node's cited sources from the browser: collect the URLs of its items' evidence, ask
// /api/sources/verify (in batches of 20), and write the results back onto each item's evidence
// (Repository.updateItem with `evidence`: no version bump, one evidence_updated event).

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SourceRequest = SourceCheckRequest['sources'][number];

/**
 * The evidence a check works on: the item's own, or — for an alternative saved before ALT_SCAN
 * sources moved into evidence — one built from its body's URL list (title-less, unchecked).
 */
export function checkableEvidence(item: Item): Evidence | null {
  if (item.evidence?.sources.some((s) => s.url)) return item.evidence;
  if (item.type === 'alternative' && item.body.sources.length > 0) return altEvidence(item.body.sources) ?? null;
  return null;
}

/** What a source is cited for: compared with the page title when the source has no title. */
export function subjectOf(item: Item): string {
  const body = item.body as { name?: unknown; title?: unknown };
  if (typeof body.name === 'string' && body.name) return body.name;
  if (typeof body.title === 'string' && body.title) return body.title;
  return itemSummary(item);
}

export interface SourceJob {
  item: Item;
  evidence: Evidence;
  requests: SourceRequest[];
}

export function sourceJobs(items: readonly Item[]): SourceJob[] {
  return items.flatMap((item) => {
    const evidence = checkableEvidence(item);
    if (!evidence) return [];
    const subject = subjectOf(item).slice(0, 200);
    const requests = evidence.sources
      .filter((s): s is EvidenceSource & { url: string } => !!s.url)
      .map((s) => ({ url: s.url.slice(0, 2048), ...(s.title ? { title: s.title.slice(0, 300) } : {}), subject }));
    return [{ item, evidence, requests }];
  });
}

/** POSTs the requests in batches; results come back in request order. */
export async function checkSourceUrls(fetch: FetchLike, requests: readonly SourceRequest[]): Promise<SourceCheckResult[]> {
  const out: SourceCheckResult[] = [];
  for (let i = 0; i < requests.length; i += MAX_SOURCES_PER_REQUEST) {
    const res = await fetch('/api/sources/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: requests.slice(i, i + MAX_SOURCES_PER_REQUEST) }),
    });
    const json: unknown = await res.json().catch(() => ({}));
    const parsed = SourceCheckResponseSchema.safeParse(json);
    if (!res.ok || !parsed.success) {
      const detail = (json as { detail?: string; error?: string }).detail ?? (json as { error?: string }).error;
      throw new Error(res.status === 429 ? `核实太频繁，请稍后再试（${detail ?? 'rate limited'}）` : `核实失败：${detail ?? `HTTP ${res.status}`}`);
    }
    out.push(...parsed.data.results);
  }
  return out;
}

function checkedSource(source: EvidenceSource, r: SourceCheckResult, now: string): EvidenceSource {
  return {
    title: source.title,
    ...(source.url ? { url: source.url } : {}),
    verified: r.verified,
    status: r.status,
    checkedAt: now,
    ...(r.pageTitle ? { pageTitle: r.pageTitle } : {}),
    ...(r.detail ? { detail: r.detail } : {}),
  };
}

/** The evidence with each URL source's check result applied (results follow the URL sources in order). */
export function withResults(evidence: Evidence, results: readonly SourceCheckResult[], now: string): Evidence {
  let next = 0;
  const sources = evidence.sources.map((s) => {
    if (!s.url) return s;
    const r = results[next++];
    return r ? checkedSource(s, r, now) : s;
  });
  return { ...evidence, sources };
}
