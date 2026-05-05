// Next.js auto-imports this on server boot.
// Configures undici (Node fetch) to honor HTTP(S)_PROXY env vars.
// Without this, Node fetch ignores the system proxy → "fetch failed" when
// reaching OpenAI / Claude / Gemini behind a Clash/v2ray-style local proxy.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    '';
  if (!proxy) return;
  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
    console.log(`[instrumentation] undici proxy enabled · ${proxy}`);
  } catch (e) {
    console.warn('[instrumentation] failed to set proxy dispatcher:', e instanceof Error ? e.message : e);
  }
}
