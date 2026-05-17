# OpenAI translation helpers

> **Feature spec** for [`src/cursor/openai-translate.ts`](./openai-translate.ts).
> **Executable spec:** [`test/cursor/openai-translate.test.ts`](../../test/cursor/openai-translate.test.ts).
>
> This is the RED-phase artifact: read it first to understand the
> feature, read the tests for exhaustive cases, read the
> implementation only when you need to know *how* the contract is met.

## Purpose

LibreChat talks the OpenAI Chat Completions wire format. Cursor's SDK
talks its own event stream of `SDKMessage`s. This module is the
shape-translation seam between the two: turn SDK events into visible
text deltas, then wrap those deltas (or the full reply) into the JSON
objects LibreChat expects.

Three exports, each a small pure-ish function:

1. `textDeltas(run)` — async generator over `run.stream()`. Yields the
   text of each assistant text block, in order. Filters out
   thinking / tool_call / status events and empty text blocks so the
   chat UI sees only visible content.
2. `buildChunk(args)` — assemble a single streaming chunk object
   (`object: "chat.completion.chunk"`). Role, content, and
   finish_reason are each conditional so callers can emit a role-only
   opener, content-only middles, and a finish-only terminator.
3. `buildCompletion(args)` — assemble the single non-streaming response
   object (`object: "chat.completion"`). Includes a heuristic usage
   count (`Math.ceil(content.length / 4)`) because the SDK doesn't
   surface real token counts yet.

## Contract

```ts
async function* textDeltas(run: Run): AsyncGenerator<string>

function buildChunk(args: {
  id: string;
  created: number;
  model: string;
  content?: string;
  finish?: "stop" | "length" | null;
  role?: "assistant";
}): OpenAIChunk

function buildCompletion(args: {
  id: string;
  created: number;
  model: string;
  content: string;
}): OpenAICompletion
```

**Invariants — `textDeltas`:**
- Only `event.type === "assistant"` events contribute output. Every
  other SDK event type is silently dropped.
- Within an assistant event, only blocks with `type === "text"` AND
  non-empty `text` are yielded. Empty-string text blocks are skipped.
- Order is preserved: blocks within an event yield in array order;
  events yield in stream order.

**Invariants — `buildChunk`:**
- `object` is always the literal `"chat.completion.chunk"`.
- Exactly one choice, always `index: 0`.
- `delta.role` is present iff the caller passed `role`.
- `delta.content` is present iff the caller passed `content` (so
  `content: ""` is treated as "intentionally empty content present",
  while omitting it leaves the field off).
- `finish_reason` is `null` when the caller passes nothing or `null`.

**Invariants — `buildCompletion`:**
- `object` is always the literal `"chat.completion"`.
- Exactly one choice, always `index: 0`, `finish_reason: "stop"`.
- `usage.prompt_tokens` is always `0` (heuristic — no real prompt
  counting on the adapter side yet).
- `usage.completion_tokens === usage.total_tokens === Math.ceil(content.length / 4)`.
- Empty `content` yields `completion_tokens: 0`.

## Behavior

Each row corresponds 1:1 to a test case in the test file, in the same
order. **When you add a behavior, append a row here AND add the
matching test.**

### `textDeltas`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | stream emits a non-assistant event (e.g. `thinking`) | nothing yielded |
| 2 | stream emits an assistant event with a single text block | that text yielded once |
| 3 | assistant event with multiple text blocks in `content` | each block's text yielded, in array order |
| 4 | assistant event mixes text and non-text blocks (tool_call, image, …) | only the text blocks are yielded |
| 5 | text block with empty `text: ""` | skipped — not yielded |
| 6 | multiple assistant events in sequence | texts yielded in stream order, all events drained |

### `buildChunk`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | role only (no content, no finish) | `delta = { role: "assistant" }`, `finish_reason: null` |
| 2 | content only (no role) | `delta = { content }`, no `role` key, `finish_reason: null` |
| 3 | finish only (no role, no content) | `delta = {}`, `finish_reason: "stop"` (or "length") |
| 4 | role + content + finish combined | all three present together |
| 5 | `finish` omitted defaults to `null` | `finish_reason: null` |
| 6 | every chunk has `index: 0` and `object: "chat.completion.chunk"` | shape invariants hold across all variants |

### `buildCompletion`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | typical content string | full OpenAI completion shape; `object: "chat.completion"`; one choice at index 0; `finish_reason: "stop"`; message role assistant; usage heuristic exact |
| 2 | content length 4 | `completion_tokens === 1` (`Math.ceil(4/4)`) |
| 3 | content length 5 | `completion_tokens === 2` (`Math.ceil(5/4)`) |
| 4 | empty content (`""`) | `completion_tokens === 0`, `total_tokens === 0` |
| 5 | `prompt_tokens` always 0 regardless of content | reflects "heuristic, no real prompt counting" invariant |
| 6 | `total_tokens === completion_tokens` (prompt is 0) | bookkeeping consistency |

## Edge cases discovered post-implementation

> Append-only log of behaviors learned after the test suite first went
> green — usually during smoke tests or in production. Each entry:
> date, what we found, what changed (if anything).

_None yet._

## Related

- **Implementation:** [`src/cursor/openai-translate.ts`](./openai-translate.ts)
- **Tests:** [`test/cursor/openai-translate.test.ts`](../../test/cursor/openai-translate.test.ts)
- **Used by:** [`src/routes/chat-completions.ts`](../routes/chat-completions.ts) — streaming branch consumes `textDeltas` + `buildChunk`; non-streaming branch consumes `buildCompletion`.
- **Background:** [`docs/PHASE1.md`](../../../docs/PHASE1.md), [`docs/PHASE2.md`](../../../docs/PHASE2.md) — TDD backfill of the SSE translation seam.
