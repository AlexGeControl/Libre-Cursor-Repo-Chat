import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

import { chatCompletions } from "../../src/routes/chat-completions.ts";
import { ConvStore } from "../../src/state/conv-store.ts";
import { FakeCursor } from "../support/fake-cursor.ts";
import {
  makeWorkspace,
  userMsg,
  assistantMsg,
  type FakeChatMessage,
} from "../support/fixtures.ts";

/**
 * Integration tests for POST /v1/chat/completions.
 *
 * What's real here: the Fastify route, our handler logic, the SQLite
 * conv-store (in :memory: mode), the rehydration prompt builder.
 *
 * What's faked: the Cursor SDK boundary via FakeCursor. No network,
 * no Cursor account, no GC timing dependencies — we drive the
 * UnknownAgentError fallback by configuring the fake to throw.
 *
 * Each test gets a fresh adapter + fake + store via beforeEach.
 */

function makeStreamlessBody(opts: {
  model?: string;
  messages: FakeChatMessage[];
  user?: string;
}) {
  return {
    model: opts.model ?? "test-workspace-v1",
    messages: opts.messages,
    stream: false,
    user: opts.user ?? "user-1",
  };
}

async function buildApp(args: {
  cursor: FakeCursor;
  store: ConvStore;
  workspaces?: ReturnType<typeof makeWorkspace>[];
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(chatCompletions, {
    workspaces: args.workspaces ?? [makeWorkspace()],
    convStore: args.store,
    cursorAdapter: args.cursor,
  });
  return app;
}

describe("POST /v1/chat/completions — acquireAgent scenarios", () => {
  let tempDir: string;
  let store: ConvStore;
  let cursor: FakeCursor;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "adapter-test-"));
    store = new ConvStore(join(tempDir, "conv.sqlite"));
    cursor = new FakeCursor();
  });

  function cleanup() {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  // ---------- A ----------
  it("A: empty store + single user message → create + send(latest), persists mapping", async () => {
    const app = await buildApp({ cursor, store });
    try {
      const resp = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "x-librechat-conversation-id": "conv-A" },
        payload: makeStreamlessBody({ messages: [userMsg("hello")], user: "u1" }),
      });

      assert.equal(resp.statusCode, 200);
      assert.deepEqual(cursor.callTypes(), ["create", "send", "dispose"]);
      assert.equal(cursor.lastSendText(), "hello", "send should receive the bare last message");

      const row = store.get("u1:conv-A");
      assert.ok(row, "convKey mapping must be persisted");
      assert.equal(row.workspaceId, "test-workspace-v1");
      assert.match(row.cursorAgentId, /^fake-agent-/);
    } finally {
      await app.close();
      cleanup();
    }
  });

  // ---------- B ----------
  it("B: empty store + multi-turn history → create + send(rehydration prompt), persists mapping", async () => {
    const app = await buildApp({ cursor, store });
    try {
      const messages = [
        userMsg("Remember PINEAPPLE."),
        assistantMsg("Got it, remembering PINEAPPLE."),
        userMsg("What did I ask you to remember?"),
      ];
      const resp = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "x-librechat-conversation-id": "conv-B" },
        payload: makeStreamlessBody({ messages, user: "u1" }),
      });

      assert.equal(resp.statusCode, 200);
      assert.deepEqual(cursor.callTypes(), ["create", "send", "dispose"]);

      const sent = cursor.lastSendText() ?? "";
      // Rehydration prompt fingerprint:
      assert.match(sent, /=== Prior conversation ===/);
      assert.match(sent, /USER: Remember PINEAPPLE\./);
      assert.match(sent, /ASSISTANT: Got it, remembering PINEAPPLE\./);
      assert.match(sent, /What did I ask you to remember\?/);
      // Latest must be outside the prior block:
      const priorBlock = sent.match(
        /=== Prior conversation ===([\s\S]*?)=== End prior conversation ===/,
      );
      assert.ok(priorBlock);
      assert.doesNotMatch(priorBlock[1], /What did I ask you to remember/);

      const row = store.get("u1:conv-B");
      assert.ok(row);
    } finally {
      await app.close();
      cleanup();
    }
  });

  // ---------- C ----------
  it("C: existing fresh mapping → resume + send(latest), no rehydration even when history is present", async () => {
    store.put("u1:conv-C", "previously-saved-agent-id", "test-workspace-v1");
    const app = await buildApp({ cursor, store });
    try {
      const messages = [
        userMsg("Remember PINEAPPLE."),
        assistantMsg("Got it."),
        userMsg("What did I ask you to remember?"),
      ];
      const resp = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "x-librechat-conversation-id": "conv-C" },
        payload: makeStreamlessBody({ messages, user: "u1" }),
      });

      assert.equal(resp.statusCode, 200);
      assert.deepEqual(cursor.callTypes(), ["resume", "send", "dispose"]);
      // The agent already has the prior context server-side — only the
      // new question must reach send.
      assert.equal(cursor.lastSendText(), "What did I ask you to remember?");

      const row = store.get("u1:conv-C");
      assert.equal(row?.cursorAgentId, "previously-saved-agent-id");
    } finally {
      await app.close();
      cleanup();
    }
  });

  // ---------- D' ----------
  // SDK 1.0.7 resume returns a stub synchronously; "agent not found"
  // fires on the FIRST send. This test pins that behavior.
  it("D': stale mapping (UnknownAgentError on send, not resume) + history → delete + create + send(rehydration)", async () => {
    store.put("u1:conv-Dp", "stale-on-send-agent", "test-workspace-v1");
    cursor.sendThrowsUnknown.add("stale-on-send-agent");
    const app = await buildApp({ cursor, store });
    try {
      const messages = [
        userMsg("Remember PINEAPPLE."),
        assistantMsg("Got it."),
        userMsg("What was the secret word?"),
      ];
      const resp = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "x-librechat-conversation-id": "conv-Dp" },
        payload: makeStreamlessBody({ messages, user: "u1" }),
      });

      assert.equal(resp.statusCode, 200);
      // resume → send (throws) → dispose stale → create → send(rehydration) → dispose
      assert.deepEqual(
        cursor.callTypes(),
        ["resume", "send", "dispose", "create", "send", "dispose"],
      );

      // The first send (which threw) carried the bare latest text;
      // the second send carried the rehydration prompt.
      const sendCalls = cursor.calls.filter(
        (c): c is Extract<typeof cursor.calls[number], { type: "send" }> => c.type === "send",
      );
      assert.equal(sendCalls.length, 2);
      assert.equal(sendCalls[0].text, "What was the secret word?", "first send on the stale agent uses the bare latest text");
      assert.match(sendCalls[1].text, /=== Prior conversation ===/, "second send on the fresh agent uses rehydration");
      assert.match(sendCalls[1].text, /What was the secret word\?/);

      const row = store.get("u1:conv-Dp");
      assert.ok(row);
      assert.notEqual(row.cursorAgentId, "stale-on-send-agent");
    } finally {
      await app.close();
      cleanup();
    }
  });

  // ---------- D ----------
  it("D: stale mapping (UnknownAgentError on resume) + history → delete + create + send(rehydration)", async () => {
    store.put("u1:conv-D", "stale-agent", "test-workspace-v1");
    cursor.resumeThrowsUnknown.add("stale-agent");
    const app = await buildApp({ cursor, store });
    try {
      const messages = [
        userMsg("Remember PINEAPPLE."),
        assistantMsg("Got it."),
        userMsg("What was the secret word?"),
      ];
      const resp = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "x-librechat-conversation-id": "conv-D" },
        payload: makeStreamlessBody({ messages, user: "u1" }),
      });

      assert.equal(resp.statusCode, 200);
      // First resume fails, then we fall back to create.
      assert.deepEqual(cursor.callTypes(), ["resume", "create", "send", "dispose"]);
      const sent = cursor.lastSendText() ?? "";
      assert.match(sent, /=== Prior conversation ===/, "rehydration prompt expected on fallback");
      assert.match(sent, /What was the secret word\?/);

      // Mapping must be replaced, not duplicated.
      const row = store.get("u1:conv-D");
      assert.ok(row);
      assert.notEqual(row.cursorAgentId, "stale-agent");
      assert.match(row.cursorAgentId, /^fake-agent-/);
    } finally {
      await app.close();
      cleanup();
    }
  });

  // ---------- E ----------
  it("E: non-UnknownAgentError on resume propagates as 5xx; mapping is NOT silently deleted", async () => {
    store.put("u1:conv-E", "flaky-agent", "test-workspace-v1");
    cursor.resumeThrowsOther.set("flaky-agent", new Error("ECONNRESET"));
    const app = await buildApp({ cursor, store });
    try {
      const resp = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "x-librechat-conversation-id": "conv-E" },
        payload: makeStreamlessBody({ messages: [userMsg("hi")], user: "u1" }),
      });

      assert.equal(resp.statusCode, 500, "transient resume error must not masquerade as success");
      assert.deepEqual(cursor.callTypes(), ["resume"], "must not silently fall back to create");

      // Mapping survives — the user can retry without losing continuity.
      const row = store.get("u1:conv-E");
      assert.equal(row?.cursorAgentId, "flaky-agent");
    } finally {
      await app.close();
      cleanup();
    }
  });

  // ---------- F ----------
  it("F: workspace mismatch with non-empty history → delete old + create for new workspace + rehydrate", async () => {
    const workspaceA = makeWorkspace({ id: "workspace-a-v1", display_name: "A" });
    const workspaceB = makeWorkspace({ id: "workspace-b-v1", display_name: "B" });
    store.put("u1:conv-F", "agent-on-workspace-a", workspaceA.id);

    const app = await buildApp({ cursor, store, workspaces: [workspaceA, workspaceB] });
    try {
      const messages = [
        userMsg("Hello on workspace A."),
        assistantMsg("Hi, I'm A."),
        userMsg("Now answer me as if you are B."),
      ];
      const resp = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "x-librechat-conversation-id": "conv-F" },
        payload: makeStreamlessBody({ model: workspaceB.id, messages, user: "u1" }),
      });

      assert.equal(resp.statusCode, 200);
      // No resume attempt — workspace mismatch is detected before we try.
      assert.deepEqual(cursor.callTypes(), ["create", "send", "dispose"]);
      const created = cursor.calls.find((c) => c.type === "create");
      assert.equal(created && "workspaceId" in created && created.workspaceId, workspaceB.id);
      const sent = cursor.lastSendText() ?? "";
      assert.match(sent, /=== Prior conversation ===/);

      const row = store.get("u1:conv-F");
      assert.equal(row?.workspaceId, workspaceB.id);
      assert.notEqual(row?.cursorAgentId, "agent-on-workspace-a");
    } finally {
      await app.close();
      cleanup();
    }
  });
});
