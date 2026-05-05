import type { NextConfig } from 'next';

const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * 生产环境的安全 headers（M3）。
 *
 * - CSP：默认仅允许 self + Google Fonts；dev 阶段允许 'unsafe-eval'/'unsafe-inline' 以便 Next 热更
 * - X-Frame-Options DENY：阻止 clickjacking
 * - X-Content-Type-Options nosniff：阻止 MIME 嗅探
 * - Referrer-Policy：跨站只发 origin，不带路径
 * - Permissions-Policy：默认拒绝 camera/mic/geo
 * - Strict-Transport-Security：仅 https 时由 Next 自动遵循反代设置；这里加 includeSubDomains
 */
const securityHeaders: { key: string; value: string }[] = [
  {
    key: 'Content-Security-Policy',
    value: (
      "default-src 'self'; " +
      `script-src 'self' ${IS_DEV ? "'unsafe-eval' 'unsafe-inline'" : "'unsafe-inline'"}; ` +
      // Tailwind / 内联 style 仍是 Next 默认；fonts.googleapis 提供 stylesheet
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com data:; " +
      "img-src 'self' data: blob: https:; " +
      // 客户端只调本机 / api：放开 self；如果以后接 Sentry / Vercel Analytics 在这里加 origin
      "connect-src 'self'; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "object-src 'none';"
    ),
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
];

if (!IS_DEV) {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  });
}

const config: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default config;
