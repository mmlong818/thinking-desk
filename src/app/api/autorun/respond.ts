import { NextResponse } from 'next/server';
import type { AutorunRow } from '@/lib/autorun/types';

/** 503 without a database (autorun needs Postgres), 502 when it is unreachable. */
export function dbFailure(e: unknown): NextResponse {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'autorun 需要 Postgres（未配置 DATABASE_URL）' }, { status: 503 });
  const message = e instanceof Error ? e.message : String(e);
  console.warn('[autorun] database call failed:', message);
  return NextResponse.json(
    { error: 'db_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message } : {}) },
    { status: 502 },
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRunId = (id: string): boolean => UUID.test(id);

export const notFound = (): NextResponse => NextResponse.json({ error: 'autorun not found' }, { status: 404 });

/** The GET body: the row in the documented shape (result only once done). */
export function view(row: AutorunRow) {
  return {
    runId: row.id, projectId: row.projectId, slug: row.slug, status: row.status, currentStep: row.currentStep,
    steps: row.steps, ...(row.error ? { error: row.error } : {}), projectUrl: row.projectUrl,
    createdAt: row.createdAt, updatedAt: row.updatedAt, ...(row.result ? { result: row.result } : {}),
  };
}
