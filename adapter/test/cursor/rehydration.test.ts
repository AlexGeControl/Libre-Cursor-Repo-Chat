// Spec: ../../src/cursor/rehydration.spec.md
// Each `it()` below maps 1:1 to a row in the spec's Behavior table,
// in the same order. When you add a test, add the row first.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRehydrationPrompt } from "../../src/cursor/rehydration.ts";

// Local minimal shape — the production type is wider, but rehydration
// only reads role + content.
type Msg = { role: string; content: unknown };

describe("buildRehydrationPrompt", () => {
  it("throws when messages is empty (defensive — caller must filter)", () => {
    assert.throws(
      () => buildRehydrationPrompt([]),
      /at least one message/i,
    );
  });

  it("throws when the last message is not from the user", () => {
    const msgs: Msg[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    assert.throws(
      () => buildRehydrationPrompt(msgs),
      /last message.*user/i,
    );
  });

  it("returns just the latest user content when there is no prior history (length 1)", () => {
    const out = buildRehydrationPrompt([{ role: "user", content: "What is this repo?" }]);
    assert.equal(out, "What is this repo?");
  });

  it("includes prior turns in a clearly delimited block when history exists", () => {
    const out = buildRehydrationPrompt([
      { role: "user", content: "Remember PINEAPPLE." },
      { role: "assistant", content: "Got it, remembering PINEAPPLE." },
      { role: "user", content: "What did I ask you to remember?" },
    ]);

    // The prior block is marked with explicit fences.
    assert.match(out, /=== Prior conversation ===/);
    assert.match(out, /=== End prior conversation ===/);

    // Prior turns appear inside the block, labeled by role.
    assert.match(out, /USER: Remember PINEAPPLE\./);
    assert.match(out, /ASSISTANT: Got it, remembering PINEAPPLE\./);

    // The agent is told to respond only to the new question.
    assert.match(out, /respond to this message only/i);
  });

  it("keeps the latest user message OUTSIDE the prior block", () => {
    const out = buildRehydrationPrompt([
      { role: "user", content: "Remember PINEAPPLE." },
      { role: "assistant", content: "Got it." },
      { role: "user", content: "What was the secret word?" },
    ]);

    const priorMatch = out.match(
      /=== Prior conversation ===([\s\S]*?)=== End prior conversation ===/,
    );
    assert.ok(priorMatch, "prior block must be present");
    assert.doesNotMatch(
      priorMatch[1],
      /What was the secret word/,
      "latest user message must not appear inside the prior block",
    );
    // …but it must appear somewhere in the prompt.
    assert.match(out, /What was the secret word\?/);
  });

  it("preserves system messages in the prior block (so persona/instructions survive)", () => {
    const out = buildRehydrationPrompt([
      { role: "system", content: "You are a helpful assistant for HW infra engineers." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How are you?" },
    ]);
    assert.match(out, /SYSTEM: You are a helpful assistant for HW infra engineers\./);
  });

  it("concatenates array-of-text-parts content (multimodal-lite shape)", () => {
    const out = buildRehydrationPrompt([
      {
        role: "user",
        content: [
          { type: "text", text: "part one " },
          { type: "text", text: "part two" },
        ],
      },
      { role: "assistant", content: "ack" },
      { role: "user", content: "now what" },
    ]);
    assert.match(out, /USER: part one part two/);
  });

  it("skips turns with no extractable text rather than emitting blank labeled lines", () => {
    const out = buildRehydrationPrompt([
      { role: "user", content: "" },
      { role: "assistant", content: null },
      { role: "user", content: "real question" },
    ]);
    // Should not contain "USER: \n" or "ASSISTANT: \n" or trailing
    // blank labels — a totally empty turn is dropped.
    assert.doesNotMatch(out, /^USER:\s*$/m);
    assert.doesNotMatch(out, /^ASSISTANT:\s*$/m);

    // With both prior turns dropped, the prior block has nothing to
    // hold, so the function falls back to the bare-prompt form (no
    // preamble).
    assert.equal(out, "real question");
  });
});
