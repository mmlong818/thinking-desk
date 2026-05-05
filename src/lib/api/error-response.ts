/**
 * 统一错误响应：生产环境不向客户端泄漏 raw provider / DB 错误细节。
 *
 * 用法：
 *   } catch (e) {
 *     return aiErrorResponse('extract-brief', e);
 *   }
 *
 * - 服务端：完整 message + stack 进 console.error
 * - 客户端：production 只见 generic 字符串；development 见 message（不含 stack）
 */
import { NextResponse } from 'next/server';

const IS_DEV = process.env.NODE_ENV !== 'production';

export function aiErrorResponse(tag: string, e: unknown, status = 502) {
  const message = e instanceof Error ? e.message : String(e);
  const stack = e instanceof Error ? e.stack : undefined;
  console.error(`[${tag}] failed:`, message, stack);
  return NextResponse.json(
    {
      error: 'ai_failed',
      ...(IS_DEV ? { detail: message || 'unknown' } : {}),
    },
    { status },
  );
}

export function dbErrorResponse(tag: string, e: unknown, status = 502) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[${tag}] failed:`, message);
  return NextResponse.json(
    {
      error: 'db_error',
      ...(IS_DEV ? { detail: message || 'unknown' } : {}),
    },
    { status },
  );
}
