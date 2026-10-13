import { createSourceCheckRoute } from '@/lib/sources/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 20 URLs, 4 at a time, at most 8 s each.
export const maxDuration = 60;

/** Checks cited source URLs (reachable? title matches?). Rate-limited per IP in middleware.ts. */
export const POST = createSourceCheckRoute();
