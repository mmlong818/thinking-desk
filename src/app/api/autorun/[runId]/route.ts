import { NextResponse } from 'next/server';
import { getAutorun } from '@/lib/autorun/service';
import { dbFailure, isRunId, notFound, view } from '../respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!isRunId(runId)) return notFound();
  try {
    const row = await getAutorun(runId);
    return row ? NextResponse.json(view(row)) : notFound();
  } catch (e) {
    return dbFailure(e);
  }
}
