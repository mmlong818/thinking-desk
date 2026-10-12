import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProviderName, ModelInfo } from './types';

const KEY_ENV: Record<AiProviderName, string> = {
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
};

const models = (...ids: string[]): ModelInfo[] => ids.map((id) => ({ id }));

/** Fresh router per test (it caches listModels results at module level), with provider.listModels stubbed. */
async function loadRouter(listed: Partial<Record<AiProviderName, ModelInfo[]>> = {}) {
  vi.resetModules();
  const router = await import('./router');
  const mods = {
    claude: (await import('./providers/claude')).claudeProvider,
    openai: (await import('./providers/openai')).openaiProvider,
    gemini: (await import('./providers/gemini')).geminiProvider,
    zhipu: (await import('./providers/zhipu')).zhipuProvider,
  };
  const spies = {} as Record<AiProviderName, ReturnType<typeof vi.spyOn>>;
  for (const name of Object.keys(mods) as AiProviderName[]) {
    spies[name] = vi.spyOn(mods[name], 'listModels').mockResolvedValue(listed[name] ?? []);
  }
  return { router, spies };
}

beforeEach(() => {
  for (const k of Object.values(KEY_ENV)) vi.stubEnv(k, '');
  vi.stubEnv('AI_MODEL_DEFAULT', '');
  vi.stubEnv('AI_MODEL_BRIEF_EXTRACT', '');
  vi.stubEnv('AI_MODEL_FREE_ASK', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('configuredProviders', () => {
  it('lists only providers whose API key is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubEnv('ZHIPU_API_KEY', 'k');
    const { router } = await loadRouter();
    expect(router.configuredProviders().sort()).toEqual(['openai', 'zhipu']);
  });
});

describe('providerFor resolution order', () => {
  it('pins provider and model from AI_MODEL_<TASK>=provider:model', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'k');
    vi.stubEnv('AI_MODEL_BRIEF_EXTRACT', 'claude:claude-x-1');
    const { router, spies } = await loadRouter();
    await expect(router.providerFor('BRIEF_EXTRACT')).resolves.toEqual({ provider: 'claude', model: 'claude-x-1' });
    expect(spies.claude).not.toHaveBeenCalled();
  });

  it('task-specific env beats AI_MODEL_DEFAULT', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'k');
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubEnv('AI_MODEL_DEFAULT', 'openai:gpt-d');
    vi.stubEnv('AI_MODEL_BRIEF_EXTRACT', 'claude:claude-t');
    const { router } = await loadRouter();
    await expect(router.providerFor('BRIEF_EXTRACT')).resolves.toEqual({ provider: 'claude', model: 'claude-t' });
  });

  it('falls back to AI_MODEL_DEFAULT when the task key is missing', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubEnv('AI_MODEL_DEFAULT', 'openai:gpt-d');
    const { router } = await loadRouter();
    await expect(router.providerFor('FREE_ASK')).resolves.toEqual({ provider: 'openai', model: 'gpt-d' });
  });

  it('per-call override beats task and default env', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubEnv('AI_MODEL_BRIEF_EXTRACT', 'openai:gpt-t');
    const { router } = await loadRouter({ gemini: models('gemini-a', 'gemini-b') });
    await expect(router.providerFor('BRIEF_EXTRACT', 'gemini:gemini-b')).resolves.toEqual({
      provider: 'gemini',
      model: 'gemini-b',
    });
  });

  it('override model not in listModels is replaced by an auto-picked one (no arbitrary ids)', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const { router } = await loadRouter({ gemini: models('gemini-a') });
    const r = await router.providerFor('FREE_ASK', 'gemini:evil-model');
    expect(r).toEqual({ provider: 'gemini', model: 'gemini-a' });
  });

  it('bare "provider" auto-picks a model via listModels', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'k');
    vi.stubEnv('AI_MODEL_FREE_ASK', 'zhipu');
    const { router, spies } = await loadRouter({ zhipu: models('zhipu-only') });
    await expect(router.providerFor('FREE_ASK')).resolves.toEqual({ provider: 'zhipu', model: 'zhipu-only' });
    expect(spies.zhipu).toHaveBeenCalledTimes(1);
  });

  it('auto-pick prefers the curated model over a newer one the adapter cannot drive', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'k');
    vi.stubEnv('AI_MODEL_FREE_ASK', 'claude');
    const { router } = await loadRouter({ claude: models('claude-fable-5-1', 'claude-sonnet-4-6', 'claude-opus-4-6') });
    await expect(router.providerFor('FREE_ASK')).resolves.toEqual({ provider: 'claude', model: 'claude-sonnet-4-6' });
  });

  it('auto-pick falls back to the latest-sorted model when no curated id is listed', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubEnv('AI_MODEL_FREE_ASK', 'gemini');
    const { router } = await loadRouter({ gemini: models('gemini-9-flash', 'gemini-4-pro') });
    await expect(router.providerFor('FREE_ASK')).resolves.toEqual({ provider: 'gemini', model: 'gemini-9-flash' });
  });

  it('keeps colons inside the model id (provider:model:tag)', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubEnv('AI_MODEL_FREE_ASK', 'openai:ft:gpt-x:org');
    const { router } = await loadRouter();
    await expect(router.providerFor('FREE_ASK')).resolves.toEqual({ provider: 'openai', model: 'ft:gpt-x:org' });
  });

  it('with no env at all, uses the first configured provider in registry order', async () => {
    vi.stubEnv('ZHIPU_API_KEY', 'k');
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const { router } = await loadRouter({ gemini: models('gemini-a'), zhipu: models('zhipu-a') });
    // registry order: claude, openai, gemini, zhipu
    await expect(router.providerFor('FREE_ASK')).resolves.toEqual({ provider: 'gemini', model: 'gemini-a' });
  });

  it('ignores an unknown provider prefix and falls back to the first configured one', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    vi.stubEnv('AI_MODEL_DEFAULT', 'nope:whatever');
    const { router } = await loadRouter({ openai: models('gpt-a') });
    await expect(router.providerFor('FREE_ASK')).resolves.toEqual({ provider: 'openai', model: 'gpt-a' });
  });
});

describe('providerFor errors', () => {
  it('throws when nothing is configured', async () => {
    const { router } = await loadRouter();
    await expect(router.providerFor('FREE_ASK')).rejects.toThrow(/No AI provider configured/);
  });

  it('throws when the named provider has no API key', async () => {
    vi.stubEnv('AI_MODEL_FREE_ASK', 'claude:claude-x');
    const { router } = await loadRouter();
    await expect(router.providerFor('FREE_ASK')).rejects.toThrow(/not configured/);
  });

  it('throws when auto-pick finds no models', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    const { router } = await loadRouter({ openai: [] });
    await expect(router.providerFor('FREE_ASK')).rejects.toThrow(/returned no models/);
  });
});

describe('listModels', () => {
  it('sorts latest-first and caches within the TTL', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'k');
    const { router, spies } = await loadRouter({ openai: models('gpt-4o', 'gpt-5', 'text-embedding-3-large') });
    const first = await router.listModels('openai');
    expect(first.map((m) => m.id)).toEqual(['gpt-5', 'gpt-4o', 'text-embedding-3-large']);
    await router.listModels('openai');
    expect(spies.openai).toHaveBeenCalledTimes(1);
  });
});
