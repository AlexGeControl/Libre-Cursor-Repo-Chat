import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { UnknownAgentError } from "@cursor/sdk";
import type { Run, SDKAgent } from "@cursor/sdk";
import type { Skill } from "../skills/manifest.ts";
import type { ConvStore } from "../state/conv-store.ts";
import type { CursorAdapter } from "../cursor/cursor-adapter.ts";
import { buildRehydrationPrompt } from "../cursor/rehydration.ts";
import {
  buildChunk,
  buildCompletion,
  textDeltas,
} from "../cursor/openai-translate.ts";

interface Options {
  skills: Skill[];
  convStore: ConvStore;
  cursorAdapter: CursorAdapter;
}

interface ChatMessage {
  role: string;
  content: string | unknown;
  [key: string]: unknown;
}

interface ChatCompletionsBody {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  user?: string;
  [key: string]: unknown;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export const chatCompletions: FastifyPluginAsync<Options> = async (app, opts) => {
  app.post(
    "/v1/chat/completions",
    async (req: FastifyRequest<{ Body: ChatCompletionsBody }>, reply: FastifyReply) => {
      const body = req.body;
      const skill = opts.skills.find((s) => s.id === body?.model);
      if (!skill) {
        return reply.code(404).send({
          error: {
            message: `unknown model: ${body?.model}`,
            type: "invalid_request_error",
            code: "model_not_found",
          },
        });
      }

      const convKey = deriveConvKey(req);
      const promptText = lastUserContent(body.messages);
      if (!promptText) {
        return reply.code(400).send({
          error: {
            message: "messages must contain at least one user message with string content",
            type: "invalid_request_error",
          },
        });
      }

      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);

      req.log.info(
        {
          convKey,
          skill: skill.id,
          messageCount: body.messages.length,
          stream: body.stream === true,
          latestPromptLen: promptText.length,
        },
        "chat completion: dispatching to Cursor",
      );

      // Two prompts the dispatcher chooses between based on whether
      // it ends up resuming (Cursor already has prior context) or
      // creating fresh (we have to bootstrap from LibreChat's
      // messages[] via the rehydration prompt).
      const resumedPromptText = promptText;
      const createdPromptText =
        body.messages.length > 1
          ? buildRehydrationPrompt(body.messages as Parameters<typeof buildRehydrationPrompt>[0])
          : promptText;

      const { agent, run, mode } = await dispatch({
        skill,
        convKey,
        convStore: opts.convStore,
        cursorAdapter: opts.cursorAdapter,
        resumedPromptText,
        createdPromptText,
        log: req.log,
      });

      // Persist the agentId on first-create; touch on resume. Done
      // BEFORE the stream completes so a client disconnect mid-stream
      // doesn't lose the mapping.
      if (mode === "created") opts.convStore.put(convKey, agent.agentId, skill.id);
      else opts.convStore.touch(convKey);

      if (body.stream === true) {
        return streamSSE({ reply, run, agent, id, created, model: skill.id, log: req.log });
      }
      return nonStreaming({ reply, run, agent, id, created, model: skill.id, log: req.log });
    },
  );
};

type AgentDispatch = { agent: SDKAgent; run: Run; mode: "created" | "resumed" };

/**
 * The dispatcher decides between resume-and-send and create-and-send,
 * with a UnknownAgentError fallback that handles BOTH resume-time AND
 * send-time failures.
 *
 * Send-time failure matters because the real `@cursor/sdk@1.0.7`
 * Agent.resume returns a stub synchronously and only validates on
 * the first send. So an "agent gone" error surfaces *during* send,
 * not during resume. Smoke-tested by injecting a bogus agentId into
 * SQLite; integration-tested via FakeCursor.sendThrowsUnknown.
 */
async function dispatch(args: {
  skill: Skill;
  convKey: string;
  convStore: ConvStore;
  cursorAdapter: CursorAdapter;
  resumedPromptText: string;
  createdPromptText: string;
  log: FastifyRequest["log"];
}): Promise<AgentDispatch> {
  const { skill, convKey, convStore, cursorAdapter, log } = args;
  const existing = convStore.get(convKey);

  if (existing && existing.skillId !== skill.id) {
    log.info(
      { convKey, fromSkill: existing.skillId, toSkill: skill.id },
      "skill changed for this convKey; creating fresh agent",
    );
    convStore.delete(convKey);
  }

  if (existing && existing.skillId === skill.id) {
    const resumed = await tryResumeAndSend({
      cursorAdapter,
      agentId: existing.cursorAgentId,
      skill,
      promptText: args.resumedPromptText,
      log,
      convKey,
    });
    if (resumed.kind === "ok") {
      return { agent: resumed.agent, run: resumed.run, mode: "resumed" };
    }
    if (resumed.kind === "stale") {
      convStore.delete(convKey);
      // fall through to create
    } else {
      throw resumed.error;
    }
  }

  const agent = await cursorAdapter.create({ skill, convKey });
  log.info({ convKey, cursorAgentId: agent.agentId, skill: skill.id }, "cursor agent created");
  const run = await agent.send(args.createdPromptText);
  return { agent, run, mode: "created" };
}

type ResumeAttempt =
  | { kind: "ok"; agent: SDKAgent; run: Run }
  | { kind: "stale"; staleAgentId: string }
  | { kind: "fail"; error: unknown };

async function tryResumeAndSend(args: {
  cursorAdapter: CursorAdapter;
  agentId: string;
  skill: Skill;
  promptText: string;
  convKey: string;
  log: FastifyRequest["log"];
}): Promise<ResumeAttempt> {
  let agent: SDKAgent | undefined;
  try {
    agent = await args.cursorAdapter.resume(args.agentId, { skill: args.skill });
    args.log.info(
      { convKey: args.convKey, cursorAgentId: agent.agentId, skill: args.skill.id },
      "cursor agent resumed",
    );
    const run = await agent.send(args.promptText);
    return { kind: "ok", agent, run };
  } catch (err) {
    if (isAgentMissingError(err)) {
      args.log.warn(
        { convKey: args.convKey, staleAgentId: args.agentId, err: errorMessage(err) },
        "cursor agent missing upstream; will fall back to create + rehydration",
      );
      if (agent) {
        // Local SDKAgent object is fine to release; the server-side
        // agent it pointed at doesn't exist anyway.
        await disposeQuiet(agent);
      }
      return { kind: "stale", staleAgentId: args.agentId };
    }
    return { kind: "fail", error: err };
  }
}

function isAgentMissingError(err: unknown): boolean {
  if (err instanceof UnknownAgentError) return true;
  // Defensive: SDK 1.0.7 surfaces "agent not found" on the first
  // send after a resume against a GC'd agentId, and the thrown
  // error is not always an `UnknownAgentError` instance (it can be
  // a generic CursorAgentError wrapping a 404). Pattern-match the
  // message as a fallback until the SDK exposes a tighter class.
  if (err instanceof Error) {
    const m = err.message ?? "";
    if (/agent\b.*\bnot\s*found/i.test(m)) return true;
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function disposeQuiet(agent: SDKAgent): Promise<void> {
  await agent[Symbol.asyncDispose]?.().catch(() => undefined);
}

async function streamSSE(args: {
  reply: FastifyReply;
  run: Run;
  agent: SDKAgent;
  id: string;
  created: number;
  model: string;
  log: FastifyRequest["log"];
}) {
  const { reply, run, agent, id, created, model, log } = args;

  reply.raw.writeHead(200, SSE_HEADERS);

  // First chunk announces the assistant role (langchainjs's OpenAI
  // client expects to see a role at the start of the stream).
  reply.raw.write(`data: ${JSON.stringify(buildChunk({ id, created, model, role: "assistant", content: "" }))}\n\n`);

  let totalChars = 0;
  let aborted = false;
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) aborted = true;
  });

  try {
    for await (const delta of textDeltas(run)) {
      if (aborted) break;
      totalChars += delta.length;
      reply.raw.write(`data: ${JSON.stringify(buildChunk({ id, created, model, content: delta }))}\n\n`);
    }
    if (!aborted) {
      reply.raw.write(`data: ${JSON.stringify(buildChunk({ id, created, model, finish: "stop" }))}\n\n`);
      reply.raw.write(`data: [DONE]\n\n`);
    }
  } catch (err) {
    log.error({ err }, "stream loop failed");
    if (!reply.raw.writableEnded) {
      reply.raw.write(
        `data: ${JSON.stringify({ error: { message: (err as Error).message, type: "server_error" } })}\n\n`,
      );
    }
  } finally {
    try {
      const result = await run.wait();
      log.info({ status: result.status, durationMs: result.durationMs, totalChars }, "run finished");
    } catch (waitErr) {
      log.warn({ err: waitErr }, "run.wait() failed");
    }
    await agent[Symbol.asyncDispose]?.().catch(() => undefined);
    if (!reply.raw.writableEnded) reply.raw.end();
  }
  return reply;
}

async function nonStreaming(args: {
  reply: FastifyReply;
  run: Run;
  agent: SDKAgent;
  id: string;
  created: number;
  model: string;
  log: FastifyRequest["log"];
}) {
  const { reply, run, agent, id, created, model, log } = args;
  let content = "";
  try {
    for await (const delta of textDeltas(run)) content += delta;
    const result = await run.wait();
    log.info({ status: result.status, durationMs: result.durationMs, len: content.length }, "run finished");
  } finally {
    await agent[Symbol.asyncDispose]?.().catch(() => undefined);
  }
  return reply.send(buildCompletion({ id, created, model, content }));
}

function deriveConvKey(req: FastifyRequest<{ Body: ChatCompletionsBody }>): string {
  const h = req.headers as Record<string, string | undefined>;
  const convId = h["x-librechat-conversation-id"];
  const userId = req.body?.user;

  if (convId && userId) return `${userId}:${convId}`;
  if (convId) return `anon:${convId}`;
  // Fall-through for non-LibreChat callers (CLI smoke tests, curl) —
  // each request is its own one-shot conversation.
  return `oneshot:${randomUUID()}`;
}

function lastUserContent(messages: ChatMessage[] | undefined): string | null {
  if (!messages?.length) return null;
  const last = messages[messages.length - 1];
  if (typeof last.content === "string") return last.content;
  // OpenAI's "content can be an array of parts" shape — concatenate text parts.
  if (Array.isArray(last.content)) {
    const text = (last.content as Array<{ type?: string; text?: string }>)
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
    return text || null;
  }
  return null;
}
