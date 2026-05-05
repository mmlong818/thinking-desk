/**
 * Provider base URL 校验（H2）。
 *
 * 防止 env 配错（或未来管理 UI 误注入）把 API key 发到任意主机。
 * - 强制 https
 * - 主机名必须在该 provider 的 allowlist 里，**或** 显式设置 `ALLOW_CUSTOM_AI_BASE_URL=true`
 * - localhost / 私有 IP 不允许（除非 NODE_ENV=development 且 ALLOW_LOCAL=true）
 */

const ALLOWLIST: Record<string, string[]> = {
  claude: ['api.anthropic.com'],
  openai: ['api.openai.com'],
  gemini: ['generativelanguage.googleapis.com'],
  zhipu: ['open.bigmodel.cn'],
};

const ALLOW_CUSTOM = process.env.ALLOW_CUSTOM_AI_BASE_URL === 'true';
const IS_DEV = process.env.NODE_ENV !== 'production';

export function validateBaseUrl(provider: keyof typeof ALLOWLIST, raw: string | undefined): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`[${provider}] BASE_URL is not a valid URL: ${raw}`);
  }
  // 协议
  if (parsed.protocol !== 'https:' && !(IS_DEV && parsed.protocol === 'http:')) {
    throw new Error(`[${provider}] BASE_URL must use https:// (got ${parsed.protocol})`);
  }
  // localhost / 私有网段（除非显式允许）
  const host = parsed.hostname;
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isLocal && !IS_DEV) {
    throw new Error(`[${provider}] BASE_URL points to a local/private host (${host}); refusing in production`);
  }
  // 主机名 allowlist
  const allowed = ALLOWLIST[provider] ?? [];
  if (!allowed.includes(host) && !ALLOW_CUSTOM) {
    throw new Error(
      `[${provider}] BASE_URL hostname "${host}" is not in the default allowlist (${allowed.join(', ')}). ` +
        `If you intentionally use a proxy, set ALLOW_CUSTOM_AI_BASE_URL=true.`,
    );
  }
  return raw;
}
