import type { Run, SDKMessage } from "@cursor/sdk";

/**
 * OpenAI chat-completion chunk shape, narrowed to what the streaming
 * branch emits. LibreChat's langchain-openai client tolerates other
 * provider extensions; we only emit the spec-required fields.
 */
export interface OpenAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: "stop" | "length" | null;
  }>;
}

export interface OpenAICompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: "stop";
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Iterate run.stream() and yield assistant text deltas only. Filters
 * out thinking/tool_call/status — those are useful for debugging but
 * shouldn't reach the chat UI as visible deltas.
 *
 * Per the cookbook quickstart, each "assistant" event carries
 * `message.content` blocks; the text inside each block is the new
 * delta for this turn (not a snapshot — the SDK emits incremental
 * blocks as the model produces them).
 */
export async function* textDeltas(run: Run): AsyncGenerator<string> {
  for await (const event of run.stream() as AsyncGenerator<SDKMessage>) {
    if (event.type !== "assistant") continue;
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) yield block.text;
    }
  }
}

export function buildChunk(args: {
  id: string;
  created: number;
  model: string;
  content?: string;
  finish?: "stop" | "length" | null;
  role?: "assistant";
}): OpenAIChunk {
  return {
    id: args.id,
    object: "chat.completion.chunk",
    created: args.created,
    model: args.model,
    choices: [
      {
        index: 0,
        delta: {
          ...(args.role ? { role: args.role } : {}),
          ...(args.content != null ? { content: args.content } : {}),
        },
        finish_reason: args.finish ?? null,
      },
    ],
  };
}

export function buildCompletion(args: {
  id: string;
  created: number;
  model: string;
  content: string;
}): OpenAICompletion {
  return {
    id: args.id,
    object: "chat.completion",
    created: args.created,
    model: args.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: args.content },
        finish_reason: "stop",
      },
    ],
    // Heuristic counts. Production replaces these with real Cursor usage
    // once the API exposes it. Phase 0 also returned heuristics.
    usage: {
      prompt_tokens: 0,
      completion_tokens: Math.ceil(args.content.length / 4),
      total_tokens: Math.ceil(args.content.length / 4),
    },
  };
}
