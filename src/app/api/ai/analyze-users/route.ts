import { z } from 'zod';
import { aiRoute, BriefContextFields, requireBrief } from '@/lib/ai/route';
import { analyzeUsers } from '@/lib/ai/tasks/analyze-users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object(BriefContextFields);

export const POST = aiRoute({
  name: 'analyze-users',
  body: Body,
  handle: (body, opts) =>
    analyzeUsers(
      {
        brief: requireBrief(body.brief, '需要先完成 Brief 节点或在请求体里传入 brief 快照'),
        rawText: body.rawText,
        answers: body.answers,
        feedback: body.feedback,
      },
      opts,
    ),
});
