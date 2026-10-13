import type { TextDeltaHandler } from '../types';
import { sseData } from './sse';

// OpenAI-compatible Chat Completions streaming (`stream: true`), shared by the OpenAI and Zhipu
// adapters: `data: {chunk}` events with choices[0].delta.content, the finish_reason on the last
// choice chunk, usage on a final chunk (OpenAI only with stream_options.include_usage), then
// `data: [DONE]`.

interface ChatChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string } | null;
}

export interface ChatStreamResult {
  text: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

function parseChunk(data: string): ChatChunk {
  try {
    return JSON.parse(data) as ChatChunk;
  } catch {
    throw new Error(`malformed stream chunk: ${data.slice(0, 200)}`);
  }
}

/** Reads the stream to the end, reporting each content delta; throws when it breaks off early. */
export async function readChatStream(body: ReadableStream<Uint8Array>, onDelta: TextDeltaHandler): Promise<ChatStreamResult> {
  let text = '';
  let finishReason: string | undefined;
  let usage: ChatStreamResult['usage'];
  let ended = false;
  for await (const data of sseData(body)) {
    if (data === '[DONE]') {
      ended = true;
      break;
    }
    const chunk = parseChunk(data);
    if (chunk.error) throw new Error(`stream error: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
    const choice = chunk.choices?.[0];
    const delta = choice?.delta?.content;
    if (delta) {
      text += delta;
      onDelta(delta);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
  }
  if (!ended && !finishReason) throw new Error('stream ended before the answer was complete');
  return { text, finishReason, usage };
}
