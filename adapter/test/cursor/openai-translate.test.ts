// Spec: ../../src/cursor/openai-translate.spec.md
// Each `it()` below maps 1:1 to a row in the spec's Behavior table,
// in the same order. When you add a test, add the row first.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Run } from "@cursor/sdk";
import {
  buildChunk,
  buildCompletion,
  textDeltas,
} from "../../src/cursor/openai-translate.ts";

/**
 * Build a minimal `Run`-shaped stub: only `stream()` is exercised by
 * `textDeltas`, so we provide just that. The cast keeps us honest
 * about not depending on the rest of the SDK surface.
 */
function fakeRun(events: unknown[]): Run {
  return {
    stream: async function* () {
      for (const e of events) yield e;
    },
  } as unknown as Run;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe("textDeltas", () => {
  it("yields nothing for non-assistant events (thinking/tool_call/status are filtered)", async () => {
    const run = fakeRun([
      { type: "thinking", message: { content: [{ type: "text", text: "hmm" }] } },
      { type: "tool_call", name: "search" },
      { type: "status", state: "running" },
    ]);
    const got = await collect(textDeltas(run));
    assert.deepEqual(got, []);
  });

  it("yields the text of a single-block assistant event", async () => {
    const run = fakeRun([
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
      },
    ]);
    const got = await collect(textDeltas(run));
    assert.deepEqual(got, ["hello"]);
  });

  it("yields each block's text in array order when an assistant event has multiple text blocks", async () => {
    const run = fakeRun([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "part one " },
            { type: "text", text: "part two" },
          ],
        },
      },
    ]);
    const got = await collect(textDeltas(run));
    assert.deepEqual(got, ["part one ", "part two"]);
  });

  it("filters non-text blocks out of an assistant event (only text yielded)", async () => {
    const run = fakeRun([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_call", name: "search", arguments: {} },
            { type: "text", text: "answer" },
            { type: "image", url: "https://example.invalid/x.png" },
          ],
        },
      },
    ]);
    const got = await collect(textDeltas(run));
    assert.deepEqual(got, ["answer"]);
  });

  it("skips text blocks whose text is the empty string", async () => {
    const run = fakeRun([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "" },
            { type: "text", text: "kept" },
            { type: "text", text: "" },
          ],
        },
      },
    ]);
    const got = await collect(textDeltas(run));
    assert.deepEqual(got, ["kept"]);
  });

  it("sequences multiple assistant events in stream order", async () => {
    const run = fakeRun([
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "alpha" }] },
      },
      { type: "thinking", message: { content: [{ type: "text", text: "ignored" }] } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "beta" },
            { type: "text", text: "gamma" },
          ],
        },
      },
    ]);
    const got = await collect(textDeltas(run));
    assert.deepEqual(got, ["alpha", "beta", "gamma"]);
  });
});

describe("buildChunk", () => {
  const base = { id: "chatcmpl-1", created: 1700000000, model: "hw-test-gen-v1" };

  it("emits a role-only chunk (no content, no finish) when only `role` is passed", () => {
    const chunk = buildChunk({ ...base, role: "assistant" });
    assert.equal(chunk.choices.length, 1);
    const choice = chunk.choices[0];
    assert.deepEqual(choice.delta, { role: "assistant" });
    assert.equal(choice.finish_reason, null);
    assert.equal("content" in choice.delta, false);
  });

  it("emits a content-only chunk (no role) when only `content` is passed", () => {
    const chunk = buildChunk({ ...base, content: "hello" });
    const choice = chunk.choices[0];
    assert.deepEqual(choice.delta, { content: "hello" });
    assert.equal(choice.finish_reason, null);
    assert.equal("role" in choice.delta, false);
  });

  it("emits a finish chunk (empty delta) when only `finish` is passed", () => {
    const chunk = buildChunk({ ...base, finish: "stop" });
    const choice = chunk.choices[0];
    assert.deepEqual(choice.delta, {});
    assert.equal(choice.finish_reason, "stop");

    const lengthChunk = buildChunk({ ...base, finish: "length" });
    assert.equal(lengthChunk.choices[0].finish_reason, "length");
    assert.deepEqual(lengthChunk.choices[0].delta, {});
  });

  it("combines role, content, and finish_reason when all are supplied", () => {
    const chunk = buildChunk({
      ...base,
      role: "assistant",
      content: "hi",
      finish: "stop",
    });
    const choice = chunk.choices[0];
    assert.deepEqual(choice.delta, { role: "assistant", content: "hi" });
    assert.equal(choice.finish_reason, "stop");
  });

  it("defaults `finish_reason` to null when `finish` is omitted or explicitly null", () => {
    const omitted = buildChunk({ ...base, content: "x" });
    assert.equal(omitted.choices[0].finish_reason, null);

    const explicit = buildChunk({ ...base, content: "x", finish: null });
    assert.equal(explicit.choices[0].finish_reason, null);
  });

  it("always sets index: 0 and object: 'chat.completion.chunk' across variants", () => {
    const variants = [
      buildChunk({ ...base, role: "assistant" }),
      buildChunk({ ...base, content: "x" }),
      buildChunk({ ...base, finish: "stop" }),
      buildChunk({ ...base, role: "assistant", content: "x", finish: "stop" }),
    ];
    for (const v of variants) {
      assert.equal(v.object, "chat.completion.chunk");
      assert.equal(v.choices.length, 1);
      assert.equal(v.choices[0].index, 0);
      // top-level fields are passed through verbatim
      assert.equal(v.id, base.id);
      assert.equal(v.created, base.created);
      assert.equal(v.model, base.model);
    }
  });
});

describe("buildCompletion", () => {
  const base = { id: "chatcmpl-2", created: 1700000001, model: "hw-test-gen-v1" };

  it("produces a well-formed OpenAI chat.completion for typical content", () => {
    const out = buildCompletion({ ...base, content: "hello world" }); // length 11
    assert.equal(out.id, base.id);
    assert.equal(out.object, "chat.completion");
    assert.equal(out.created, base.created);
    assert.equal(out.model, base.model);
    assert.equal(out.choices.length, 1);

    const choice = out.choices[0];
    assert.equal(choice.index, 0);
    assert.equal(choice.finish_reason, "stop");
    assert.deepEqual(choice.message, { role: "assistant", content: "hello world" });

    // Math.ceil(11/4) = 3
    assert.equal(out.usage.completion_tokens, 3);
    assert.equal(out.usage.total_tokens, 3);
    assert.equal(out.usage.prompt_tokens, 0);
  });

  it("computes completion_tokens === 1 for content of length 4 (boundary)", () => {
    const out = buildCompletion({ ...base, content: "abcd" });
    assert.equal(out.usage.completion_tokens, 1);
    assert.equal(out.usage.total_tokens, 1);
  });

  it("computes completion_tokens === 2 for content of length 5 (Math.ceil rounds up)", () => {
    const out = buildCompletion({ ...base, content: "abcde" });
    assert.equal(out.usage.completion_tokens, 2);
    assert.equal(out.usage.total_tokens, 2);
  });

  it("reports completion_tokens === 0 and total_tokens === 0 for empty content", () => {
    const out = buildCompletion({ ...base, content: "" });
    assert.equal(out.usage.completion_tokens, 0);
    assert.equal(out.usage.total_tokens, 0);
    assert.equal(out.usage.prompt_tokens, 0);
    assert.equal(out.choices[0].message.content, "");
  });

  it("always reports prompt_tokens === 0 regardless of content size", () => {
    for (const content of ["", "x", "a longer reply that spans several heuristic tokens"]) {
      const out = buildCompletion({ ...base, content });
      assert.equal(out.usage.prompt_tokens, 0, `prompt_tokens for content of length ${content.length}`);
    }
  });

  it("keeps total_tokens === completion_tokens (since prompt_tokens is always 0)", () => {
    for (const content of ["", "a", "ab", "abc", "abcd", "abcde", "abcdefghij"]) {
      const out = buildCompletion({ ...base, content });
      assert.equal(
        out.usage.total_tokens,
        out.usage.completion_tokens,
        `bookkeeping mismatch for content length ${content.length}`,
      );
    }
  });
});
