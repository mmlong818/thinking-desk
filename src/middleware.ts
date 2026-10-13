import { NextResponse, type NextRequest } from 'next/server';

/**
 * 单一 middleware 同时承载两件事：
 *
 *  1. **可选 Bearer 鉴权**（H5）— 当 `REQUIRE_AUTH=true` 时，所有
 *     `/api/**` 请求必须带 `Authorization: Bearer <REQUIRE_AUTH_TOKEN>`。
 *     适合自托管把实例放公网的场景；本地默认不开。
 *
 *  2. **per-IP 频控**（H1）— 作用于 `/api/ai/**`（防止开源自托管者把供应商
 *     API key 在几分钟内被刷光）和 `/api/sources/**`（来源核实会让服务端去
 *     访问外部网址），两者各自一个计数桶。窗口式计数（in-memory），单进程
 *     有效；多实例部署需要替换为 Redis 实现，但单机够用。
 *
 *  设计取舍：
 *  - in-memory rate limit 不持久；进程重启计数清零，对 OSS 自托管够用。
 *  - 没用 third-party 依赖，避免 OSS 用户额外装包。
 *  - 把鉴权和频控都关在 middleware，路由侧不用感知。
 */

const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';
const REQUIRE_AUTH_TOKEN = process.env.REQUIRE_AUTH_TOKEN ?? '';

// 频控配置（可通过 env 调整）
const RATE_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);
const RATE_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? '20', 10);

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

function clientKey(req: NextRequest): string {
  // x-forwarded-for 顺位优先（部署在反代后），否则 fallback。
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  // Next.js Edge 没暴露 socket addr；回落到 'anon'，单机够用。
  return 'anon';
}

/** Path prefixes that are rate-limited, each with its own bucket per client. */
const LIMITED_PREFIXES = ['/api/ai/', '/api/sources/'];

function rateLimit(key: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true };
  }
  if (b.count >= RATE_MAX) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  b.count += 1;
  return { ok: true };
}

// 周期清理过期 bucket，避免长时间运行内存增长
let lastSweep = Date.now();
function maybeSweep() {
  const now = Date.now();
  if (now - lastSweep < 5 * 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) buckets.delete(k);
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. 鉴权：仅对 /api/* 生效（页面 SSR 不强制）
  if (REQUIRE_AUTH && pathname.startsWith('/api/')) {
    if (!REQUIRE_AUTH_TOKEN) {
      // 误配：要求鉴权但没设 token，全拒
      return NextResponse.json(
        { error: 'misconfigured', detail: 'REQUIRE_AUTH=true but REQUIRE_AUTH_TOKEN is empty' },
        { status: 500 },
      );
    }
    const auth = req.headers.get('authorization') ?? '';
    const expected = `Bearer ${REQUIRE_AUTH_TOKEN}`;
    if (auth !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  // 2. 频控：/api/ai/* 与 /api/sources/*，各自一个桶
  const limited = LIMITED_PREFIXES.find((prefix) => pathname.startsWith(prefix));
  if (limited) {
    maybeSweep();
    const r = rateLimit(`${limited}${clientKey(req)}`);
    if (!r.ok) {
      return NextResponse.json(
        { error: 'rate_limited', detail: `try again in ${r.retryAfter}s` },
        {
          status: 429,
          headers: {
            'Retry-After': String(r.retryAfter),
            'X-RateLimit-Limit': String(RATE_MAX),
            'X-RateLimit-Window-Ms': String(RATE_WINDOW_MS),
          },
        },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  // 只匹配 /api/*，页面渲染不经过
  matcher: ['/api/:path*'],
};
