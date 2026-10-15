import type { AiProvider, AiProviderName, AiTask, ModelInfo } from './types';
import { claudeProvider } from './providers/claude';
import { openaiProvider } from './providers/openai';
import { geminiProvider } from './providers/gemini';
import { zhipuProvider } from './providers/zhipu';

const PROVIDERS: Record<AiProviderName, AiProvider> = {
  claude: claudeProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  zhipu: zhipuProvider,
};

interface Resolved {
  provider: AiProviderName;
  model: string;
}

// ---- model discovery cache ----
const modelsCache: Partial<Record<AiProviderName, { at: number; models: ModelInfo[] }>> = {};
const MODELS_TTL_MS = 5 * 60 * 1000;

export async function listModels(name: AiProviderName): Promise<ModelInfo[]> {
  const cached = modelsCache[name];
  if (cached && Date.now() - cached.at < MODELS_TTL_MS) return cached.models;
  const raw = await PROVIDERS[name].listModels();
  const models = sortLatestFirst(raw);
  modelsCache[name] = { at: Date.now(), models };
  return models;
}

/**
 * 排序：尽量把"最新最强"放前面。
 * 1. 解析 id 中的版本号（4.7 > 4.6 > 4.5；2.5 > 2.0；5 > 4.1 > 4 > 3.5）
 * 2. 同版本里 flagship > pro > opus > sonnet > mini/haiku/flash/lite
 * 3. 解析失败的退到尾部
 */
function sortLatestFirst(models: ModelInfo[]): ModelInfo[] {
  const TIER: Record<string, number> = {
    flagship: 100, pro: 90, opus: 85, ultra: 85, max: 80,
    sonnet: 70, plus: 65, turbo: 60,
    base: 50, standard: 50,
    air: 40, mini: 30, haiku: 30, flash: 30, lite: 20, nano: 10,
  };
  const score = (id: string): number => {
    const lower = id.toLowerCase();
    // Skip non-chat / legacy / deprecated patterns to the back.
    if (/(embedding|whisper|tts|dall|image|moderation|audio|realtime|transcribe|search|preview-deprecated)/.test(lower)) return -1;
    const verMatch = lower.match(/(\d+(?:\.\d+)?)/);
    const ver = verMatch ? parseFloat(verMatch[1]) : 0;
    let tier = 50;
    for (const k of Object.keys(TIER)) {
      if (lower.includes(k)) { tier = TIER[k]; break; }
    }
    // Newer model families: prefer non-dated ids over dated snapshots only when versions tie.
    const dated = /\d{4}-\d{2}-\d{2}|-\d{8}|-\d{4}$/.test(lower) ? -1 : 0;
    return ver * 1000 + tier + dated;
  };
  return [...models].sort((a, b) => score(b.id) - score(a.id));
}

/** False when the adapter cannot drive this model on structured (schema) tasks. */
export function supportsStructured(name: AiProviderName, modelId: string): boolean {
  return PROVIDERS[name].canDrive?.(modelId) !== false;
}

export function configuredProviders(): AiProviderName[] {
  return (Object.keys(PROVIDERS) as AiProviderName[]).filter((n) => PROVIDERS[n].isConfigured());
}

// ---- task routing ----
// Env can specify:
//   AI_MODEL_<TASK> = provider:model        → pin both
//   AI_MODEL_<TASK> = provider              → auto-pick a model from that provider
//   AI_MODEL_DEFAULT applies when task-specific key missing.
// If nothing is configured at all, fall back to the first configured provider.

/**
 * An explicit `provider:model` from the client is kept unless the provider's real model list
 * proves it does not exist. An unavailable list (empty, offline fallback, or a listing error)
 * proves nothing, so the request goes out with the requested id instead of a silent substitute.
 */
async function checkOverride(name: AiProviderName, modelId: string): Promise<string> {
  let models: ModelInfo[];
  try {
    models = await listModels(name);
  } catch {
    return modelId;
  }
  const listed = models.filter((m) => !m.fallback);
  if (listed.length === 0 || listed.some((m) => m.id === modelId)) return modelId;
  throw new Error(`Model "${modelId}" is not offered by provider "${name}". Pick another model.`);
}

async function pickModel(name: AiProviderName): Promise<string> {
  const models = await listModels(name);
  if (models.length === 0) {
    throw new Error(`Provider "${name}" returned no models. Check API key and network.`);
  }
  // Prefer known flagship ids when present (descending capability).
  const preferred = [
    // Zhipu (glm-5.3 only when named: its thinking is always on, so every task is far slower)
    'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo',
    // Claude (request params are chosen per model family in providers/claude-params.ts)
    'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-sonnet-4-6',
    // OpenAI
    'gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-terra', 'gpt-5.4',
    // Gemini
    'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash',
  ];
  for (const p of preferred) {
    if (models.some((m) => m.id === p)) return p;
  }
  // listModels() already sorted latest-first; never auto-pick a model the adapter cannot drive.
  const drivable = models.find((m) => PROVIDERS[name].canDrive?.(m.id) !== false);
  if (!drivable) throw new Error(`Provider "${name}" lists no model this adapter can drive.`);
  return drivable.id;
}

export async function providerFor(task: AiTask, override?: string): Promise<Resolved> {
  const envKey = `AI_MODEL_${task}`;
  // Precedence: explicit per-call override > per-task env > global env default.
  const raw = (override && override.trim()) || process.env[envKey] || process.env.AI_MODEL_DEFAULT || '';

  let providerName: AiProviderName | null = null;
  let modelId: string | null = null;

  if (raw) {
    const [p, ...rest] = raw.split(':');
    if (PROVIDERS[p as AiProviderName]) {
      providerName = p as AiProviderName;
      modelId = rest.join(':') || null;
    }
  }

  if (!providerName) {
    const configured = configuredProviders();
    if (configured.length === 0) {
      throw new Error('No AI provider configured. Set ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / ZHIPU_API_KEY.');
    }
    providerName = configured[0];
  }

  if (!PROVIDERS[providerName].isConfigured()) {
    throw new Error(`Provider "${providerName}" is not configured (missing API key).`);
  }

  if (!modelId) {
    modelId = await pickModel(providerName);
  } else if (override) {
    // 当 modelId 来自客户端 override 时，只在真实模型列表证明它不存在时拒绝（离线 / 空列表不算证据）
    modelId = await checkOverride(providerName, modelId);
  }

  return { provider: providerName, model: modelId };
}

/** providerFor() resolved to the adapter object (runTask's default resolver). */
export async function resolveProvider(task: AiTask, override?: string): Promise<{ provider: AiProvider; model: string }> {
  const { provider, model } = await providerFor(task, override);
  return { provider: PROVIDERS[provider], model };
}
