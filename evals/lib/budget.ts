import { buildClaudeRequest, claudeProvider } from '../../src/lib/ai/providers/claude';
import { buildGeminiRequest, geminiProvider } from '../../src/lib/ai/providers/gemini';
import { buildOpenAIRequest, openaiProvider } from '../../src/lib/ai/providers/openai';
import { buildZhipuRequest, zhipuProvider } from '../../src/lib/ai/providers/zhipu';
import type { AiProvider, AiProviderName, AiTask, CompleteRequest } from '../../src/lib/ai/types';
import type { GoldenBrief } from './briefs';
import { runChain, STEPS, type StepName, type StepRecord } from '../../src/lib/autorun/chain';
import { STEP_FIXTURES } from './fixtures';
import { fixtureDeps } from './offline';

// Dry-run planning: run the chain offline (canned outputs) for each golden brief, render every
// request exactly as the chosen provider adapter would send it, and turn that into a token
// budget. Nothing here touches the network.

export const ADAPTERS: Record<AiProviderName, AiProvider> = {
  claude: claudeProvider, openai: openaiProvider, gemini: geminiProvider, zhipu: zhipuProvider,
};

export interface Target {
  provider: AiProviderName;
  model: string;
  /** "provider:model" */
  spec: string;
}

export function parseTarget(spec: string): Target {
  const [provider, ...rest] = spec.split(':');
  const model = rest.join(':');
  if (!(provider in ADAPTERS) || !model) {
    throw new Error(`--model expects provider:model with provider one of ${Object.keys(ADAPTERS).join(', ')}, got "${spec}"`);
  }
  return { provider: provider as AiProviderName, model, spec };
}

/** Rough: a CJK character ≈ 1 token, anything else ≈ 3.5 characters per token (errs high for Chinese). */
export function estimateTokens(text: string): number {
  const cjk = text.match(/[\u3000-\u9fff\uff00-\uffef]/g)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 3.5);
}

/** The body the adapter would send: its size in tokens and the output cap it sets (reasoning included). */
export function requestFootprint(t: Target, req: CompleteRequest): { inputTokens: number; outputCap: number } {
  const size = (body: unknown) => estimateTokens(JSON.stringify(body));
  if (t.provider === 'claude') {
    const body = buildClaudeRequest(t.model, req);
    return { inputTokens: size(body), outputCap: body.max_tokens };
  }
  if (t.provider === 'gemini') {
    const body = buildGeminiRequest(req);
    return { inputTokens: size(body), outputCap: Number((body.generationConfig as { maxOutputTokens?: number }).maxOutputTokens ?? 0) };
  }
  const body = t.provider === 'openai' ? buildOpenAIRequest(t.model, req) : buildZhipuRequest(t.model, req);
  return { inputTokens: size(body), outputCap: Number(body.max_completion_tokens ?? body.max_tokens ?? 0) };
}

export interface PlannedCall {
  brief: string;
  step: StepName;
  task: AiTask;
  /** Rendered request with canned upstream data. */
  promptTokens: number;
  /** The task's visible answer budget (maxTokens). */
  visible: number;
  /** The provider's output cap for the request (visible + reasoning headroom where the adapter adds it). */
  outputCap: number;
}

export interface Plan {
  calls: PlannedCall[];
  /** Steps that could not even be planned (e.g. a model the adapter cannot drive). */
  failures: StepRecord[];
}

export async function planCalls(t: Target, briefs: readonly GoldenBrief[]): Promise<Plan> {
  const calls: PlannedCall[] = [];
  const failures: StepRecord[] = [];
  for (const b of briefs) {
    const seen = new Map<StepName, CompleteRequest>();
    const records = await runChain(b.rawText, (step) => ({
      deps: fixtureDeps(STEP_FIXTURES[step], { model: t.model, like: ADAPTERS[t.provider], onRequest: (c) => seen.set(step, c.req) }),
    }));
    failures.push(...records.filter((r) => r.status === 'failed' || r.status === 'skipped'));
    for (const [step, req] of seen) {
      const { inputTokens, outputCap } = requestFootprint(t, req);
      calls.push({ brief: b.id, step, task: STEPS[step].task, promptTokens: inputTokens, visible: req.maxTokens ?? 0, outputCap });
    }
  }
  return { calls, failures };
}

/** Share of the visible budget a real answer is assumed to fill, and of the reasoning headroom spent. */
export const VISIBLE_FILL = 0.5;
export const REASONING_FILL = 0.25;

export interface CallBudget {
  /** Upstream answers quoted in the prompt, at VISIBLE_FILL of their budget (the canned ones are tiny). */
  contextTokens: number;
  expectedIn: number;
  expectedOut: number;
  /** Every call retried once after a full-length invalid answer. */
  worstIn: number;
  worstOut: number;
}

export function callBudget(call: PlannedCall, sameBrief: readonly PlannedCall[]): CallBudget {
  const contextTokens = STEPS[call.step].reads
    .map((s) => sameBrief.find((c) => c.step === s)?.visible ?? 0)
    .reduce((sum, v) => sum + Math.round(v * VISIBLE_FILL), 0);
  const expectedIn = call.promptTokens + contextTokens;
  const expectedOut = Math.round(call.visible * VISIBLE_FILL + Math.max(0, call.outputCap - call.visible) * REASONING_FILL);
  return { contextTokens, expectedIn, expectedOut, worstIn: 2 * expectedIn + call.outputCap, worstOut: 2 * call.outputCap };
}
