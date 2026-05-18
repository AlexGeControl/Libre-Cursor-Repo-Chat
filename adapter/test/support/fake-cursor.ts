import { UnknownAgentError } from "@cursor/sdk";
import type { Run, SDKAgent, SDKMessage, RunResult } from "@cursor/sdk";
import type {
  CursorAdapter,
  CreateArgs,
  ResumeArgs,
} from "../../src/cursor/cursor-adapter.ts";

export type FakeCall =
  | { type: "create"; agentId: string; workspaceId: string; convKey: string }
  | { type: "resume"; agentId: string; workspaceId: string }
  | { type: "send"; agentId: string; text: string }
  | { type: "dispose"; agentId: string };

/**
 * In-memory CursorAdapter used by integration tests. Records every
 * inbound call and lets each test script resume failures (so we can
 * exercise the UnknownAgentError fallback without depending on
 * Cursor server-side GC).
 *
 * Used by `test/routes/chat-completions.test.ts` and any future
 * route test that exercises the Cursor boundary.
 */
export class FakeCursor implements CursorAdapter {
  readonly calls: FakeCall[] = [];

  /** Agent IDs that should throw UnknownAgentError on resume itself. */
  readonly resumeThrowsUnknown = new Set<string>();
  /** Map of agentId → arbitrary error to throw on resume. */
  readonly resumeThrowsOther = new Map<string, Error>();
  /**
   * Agent IDs that should throw UnknownAgentError on the first `send`
   * after resume. This models the real SDK behavior where Agent.resume
   * returns a stub synchronously and the "agent not found" error
   * surfaces on the first actual API call.
   */
  readonly sendThrowsUnknown = new Set<string>();
  /** Text the fake agent "produces" as its single assistant text block. */
  responseText = "fake response";

  private nextSerial = 1;

  async create(args: CreateArgs): Promise<SDKAgent> {
    const agentId = `fake-agent-${this.nextSerial++}`;
    this.calls.push({
      type: "create",
      agentId,
      workspaceId: args.workspace.id,
      convKey: args.convKey,
    });
    return this.buildAgent(agentId);
  }

  async resume(agentId: string, args: ResumeArgs): Promise<SDKAgent> {
    this.calls.push({ type: "resume", agentId, workspaceId: args.workspace.id });
    if (this.resumeThrowsUnknown.has(agentId)) {
      throw new UnknownAgentError(`fake: unknown agent ${agentId}`);
    }
    const other = this.resumeThrowsOther.get(agentId);
    if (other) throw other;
    return this.buildAgent(agentId);
  }

  // --- inspection helpers ---

  callTypes(): string[] {
    return this.calls.map((c) => c.type);
  }

  lastSendText(): string | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i];
      if (c.type === "send") return c.text;
    }
    return undefined;
  }

  sendsFor(agentId: string): string[] {
    return this.calls
      .filter((c): c is Extract<FakeCall, { type: "send" }> => c.type === "send" && c.agentId === agentId)
      .map((c) => c.text);
  }

  // --- factory ---

  private buildAgent(agentId: string): SDKAgent {
    const calls = this.calls;
    const responseText = this.responseText;

    const sendThrowsUnknown = this.sendThrowsUnknown;
    const send = async (message: string | { text: string }): Promise<Run> => {
      const text = typeof message === "string" ? message : message.text;
      calls.push({ type: "send", agentId, text });
      if (sendThrowsUnknown.has(agentId)) {
        throw new UnknownAgentError(`fake: agent ${agentId} not found at send`);
      }
      return buildFakeRun(agentId, responseText);
    };

    return {
      agentId,
      send,
      close: () => undefined,
      reload: async () => undefined,
      [Symbol.asyncDispose]: async () => {
        calls.push({ type: "dispose", agentId });
      },
      listArtifacts: async () => [],
      downloadArtifact: async () => {
        throw new Error("FakeCursor: downloadArtifact not implemented");
      },
    } as unknown as SDKAgent;
  }
}

function buildFakeRun(agentId: string, text: string): Run {
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    yield {
      type: "assistant",
      agent_id: agentId,
      run_id: "fake-run",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
      },
    } as unknown as SDKMessage;
  }

  const wait = async (): Promise<RunResult> => ({
    id: "fake-run",
    status: "finished",
    result: text,
    durationMs: 1,
  });

  return {
    id: "fake-run",
    agentId,
    supports: () => true,
    unsupportedReason: () => undefined,
    stream,
    conversation: async () => [],
    wait,
    cancel: async () => undefined,
    status: "finished",
    onDidChangeStatus: () => () => undefined,
    result: text,
    durationMs: 1,
  } as unknown as Run;
}
