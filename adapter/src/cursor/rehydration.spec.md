# rehydration prompt builder

> **Feature spec** for [`src/cursor/rehydration.ts`](./rehydration.ts).
> **Executable spec:** [`test/cursor/rehydration.test.ts`](../../test/cursor/rehydration.test.ts).
>
> This is the RED-phase artifact: read it first to understand the
> feature, read the tests for exhaustive cases, read the
> implementation only when you need to know *how* the contract is met.

## Purpose

When the adapter has to start a fresh Cursor agent for a conversation
that LibreChat thinks is ongoing — either because the convKey was
never mapped (SQLite was wiped, or some other re-key happened) or
because the mapped Cursor agent has been garbage-collected
server-side — the new agent has no memory of the prior turns. The
user, however, sees the full transcript in LibreChat and expects
continuity.

This builder converts the LibreChat `messages[]` array into a single
prompt that gives the new agent enough context to answer the latest
user question correctly, in one `agent.send` call.

## Contract

```ts
buildRehydrationPrompt(messages: ChatMessage[]): string
```

**Inputs:**
- `messages` — non-empty array. Each entry has `role` (string) and
  `content` (string OR an array of `{ type, text }` parts).
- The last message MUST be `role: "user"`.

**Outputs:**
- A single string suitable to pass directly to `agent.send(...)`.

**Throws:**
- `Error` when `messages` is empty.
- `Error` when the last message is not `role: "user"`.

**Invariants:**
- When there is no effective prior history — length 1, OR every prior
  turn has empty/unsupported content — returns just the latest text
  with no preamble. This keeps the first-turn happy path free of
  rehydration ceremony.
- The latest user message NEVER appears inside the `Prior conversation`
  block. It appears only in the "respond to this" section.
- Prior turns are formatted as `<ROLE>: <text>` lines, role uppercased.
- `role: "system"` messages are preserved in the prior block so persona
  / system instructions survive a hard rehydrate.
- Turns with no extractable text content are skipped, not emitted as
  blank labeled lines.

## Behavior

Each row corresponds 1:1 to a test case in the test file, in the same
order. **When you add a behavior, append a row here AND add the
matching test.**

| # | Scenario | Expected |
|---|----------|----------|
| 1 | empty `messages[]` | throws — defensive, caller must filter |
| 2 | last message not `role: "user"` | throws — defensive |
| 3 | single user message (length 1) | returns just that text, no preamble |
| 4 | multi-turn (user → assistant → user) | prompt includes prior block + clearly demarcated latest question |
| 5 | latest message kept OUT of prior block | prior block bounded; latest only in the "respond to this" section |
| 6 | system message present | preserved as `SYSTEM: …` in prior block |
| 7 | content as array-of-text-parts (multimodal-lite) | parts concatenated correctly |
| 8 | empty-content turns | skipped, no blank `USER: ` / `ASSISTANT: ` lines emitted |

## Edge cases discovered post-implementation

> Append-only log of behaviors learned after the test suite first went
> green — usually during smoke tests or in production. Each entry:
> date, what we found, what changed (if anything).

- **2026-05-17** — Smoke test against `@cursor/sdk@1.0.7` with a
  bogus agentId planted in SQLite revealed that `Agent.resume`
  returns a stub synchronously and the "agent not found" error fires
  on the first `send()`, not on `resume()`. The rehydration builder
  itself is unaffected (input/output unchanged), but it forced the
  *caller* (the dispatcher in `chat-completions.ts`) to catch the
  missing-agent error around both `resume` AND the first `send`.
  Captured as test case `D'` in the integration suite. See
  [`docs/PHASE1.md`](../../../docs/PHASE1.md) → "Slice 2c"
  for the full narrative.

## Related

- **Implementation:** [`src/cursor/rehydration.ts`](./rehydration.ts)
- **Tests:** [`test/cursor/rehydration.test.ts`](../../test/cursor/rehydration.test.ts) — 8 unit tests, one per behavior row
- **Used by:** [`src/routes/chat-completions.ts`](../routes/chat-completions.ts) — the `dispatch` function passes the result as `createdPromptText` when `messages.length > 1`
- **Background:** [`docs/PHASE1.md`](../../../docs/PHASE1.md) — "Slice 2c: rehydration (TDD)"
