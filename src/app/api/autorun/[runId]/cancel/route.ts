import { NextResponse } from 'next/server';
import { cancelAutorun } from '@/lib/autorun/service';
import { dbFailure, isRunId, notFound } from '../../respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 202 once stopped (items already written stay); 409 when the run had already ended. */
export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!isRunId(runId)) return notFound();
  try {
    const status = await cancelAutorun(runId);
    if (!status) return notFound();
    if (status !== 'cancelled') return NextResponse.json({ error: `autorun already ${status}`, status }, { status: 409 });
    return NextResponse.json({ status }, { status: 202 });
  } catch (e) {
    return dbFailure(e);
  }
}
