import { NextResponse } from 'next/server';
import { configuredProviders, listModels } from '@/lib/ai/router';
import type { AiProviderName } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const names = configuredProviders();
  const providers = await Promise.all(
    names.map(async (name: AiProviderName) => {
      try {
        const models = await listModels(name);
        return { name, configured: true, models };
      } catch (e) {
        return {
          name,
          configured: true,
          models: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
  return NextResponse.json({ providers });
}
