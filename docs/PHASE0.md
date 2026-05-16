# Phase 0 — CLI-first plumbing exploration

> **Status:** done, 2026-05-16. This document is frozen — see
> [`CONTEXT.md`](CONTEXT.md). For overall plan see [`PLAN.md`](PLAN.md).
> For how the resulting system runs today see
> [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Goal

Validate the LibreChat ↔ adapter ↔ Cursor pipeline end-to-end with the
**Cursor CLI** via `anyrobert/cursor-api-proxy`, using a personal CMU
learning repo as the workspace. No custom adapter code. De-risk before
committing to SDK-based adapter work described in [`../CLAUDE.md`](../CLAUDE.md).

This phase intentionally **diverged** from CLAUDE.md in two ways:

- Used the **CLI** (`agent`) via the existing proxy, not `@cursor/sdk`.
- Used a **personal CMU repo** as the workspace, not an NVIDIA HW repo —
  removes data-residency hesitation so we can iterate fast.

## What we tried, in order

1. Cloned `anyrobert/cursor-api-proxy` as a sibling dir of this repo.
2. Added the CMU learning repo as a git submodule under
   `workspaces/cmu-genai-v1/repo`.
3. Installed Cursor agent CLI (`curl https://cursor.com/install | bash`),
   authenticated via `CURSOR_API_KEY` from `.env`.
4. Built `cursor-api-proxy` and started it on the host bound to
   `0.0.0.0:8765`, pointing at the CMU workspace.
5. Smoke-tested `/v1/models`, non-streaming `/v1/chat/completions`, and
   SSE streaming directly against the proxy.
6. Wrote `librechat.yaml` + `docker-compose.yml` for a minimal LibreChat
   + MongoDB stack, registering one custom endpoint `Cursor (CMU GenAI)`.
7. Stood up the compose stack, registered a test user, drove a 2-turn
   chat through the modern `/api/agents/chat/:endpoint` flow.

## Critical findings

These are the deltas worth remembering. Operational consequences are
also recorded in [`ARCHITECTURE.md`](ARCHITECTURE.md); this section is
the narrative — why we hit each one and what we decided.

### `cursor-api-proxy` does not pass `--trust` in real-workspace mode

When `CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=false` (so the agent sees the
real repo instead of an empty tempdir), the CLI refuses to run unless
the workspace is trusted. The proxy only passes `--trust` to the CLI
when chat-only mode is on; in real-workspace mode it relies on
`--force`, which we couldn't use (next item).

**Decision:** patched `cursor-api-proxy/src/lib/agent-cmd-args.ts` to
always add `--trust`. One-line change. This is the right behavior for a
proxy that's already shielded by network policy; the upstream proxy's
exposure model is conservative because it expects to be reachable from
arbitrary clients. Worth an upstream PR eventually.

### `--force` is admin-disabled for this Cursor team

Setting `CURSOR_BRIDGE_FORCE=true` made the CLI exit 1 with:
> *Your team administrator has disabled the 'Run Everything' option.*

So `--force` is not a workaround. `--trust` is structurally the right
flag anyway — it grants workspace trust without granting blanket
command execution.

### Proxy must bind `0.0.0.0` to be reachable from the LibreChat container

Default `CURSOR_BRIDGE_HOST=127.0.0.1` is unreachable from
`host.docker.internal:8765` inside the API container. Set
`CURSOR_BRIDGE_HOST=0.0.0.0` (firewall externally if exposing beyond
the host).

### LibreChat blocks non-browser User-Agents on `/api/agents/chat`

Middleware `uaParser.js` rejects any UA whose ua-parser-js parse has no
`browser.name`, returning `{"message":"Illegal request"}`. Browsers are
fine. API smoke-tests must spoof a Chrome-shaped UA — not a problem in
production, but worth knowing for any future automated end-to-end test.

### "Continuity" is LibreChat replaying full history, not `agent --resume`

This is the most important finding for Phase 1. We confirmed:

- Turn 1 `prompt_tokens`: 21
- Turn 2 `prompt_tokens`: 70 (history included in the prompt)

The proxy spawns a fresh `agent` per request and hands it the entire
conversation as a single prompt. There is no conversation-id mapping in
the proxy. For Phase 0 plumbing this is fine — the chat *looks*
continuous because LibreChat re-sends history. But this means:

- Cursor's own context cache (if any) is not warm across turns.
- Cost scales linearly with conversation length on each turn.
- True multi-turn agent behaviour (where the agent's *plan* persists
  across turns, not just its visible text) is not happening.

Phase 1 must own its own `convId → cursorChatId` mapping, which is what
CLAUDE.md §8 originally specified and what `@cursor/sdk`'s
`Agent.resume` makes clean.

### Modern LibreChat has no `/api/ask/*` route

The legacy chat endpoints described in older LibreChat tutorials are
gone. Custom-endpoint chat goes through `POST /api/agents/chat/:endpoint`
(URL-encoded), which returns `{streamId, conversationId}`, and the SSE
itself comes from a follow-up `GET /api/agents/chat/stream/:streamId`.

This is internal to LibreChat and Phase 1 doesn't need to care — the
adapter only ever sees the upstream OpenAI-shape call from LibreChat's
custom-endpoint client. But it's worth knowing if anyone tries to do
direct API smoke-tests of LibreChat in the future.

### `usage.*` tokens from the proxy are heuristic, not billing meters

Both `prompt_tokens` and `completion_tokens` are character count ÷ 4.
Do not use for cost attribution. Real attribution will need to come
from Cursor's own usage API or per-key tracking.

## Smoke-test results that mattered

- `GET /v1/models` against the proxy → full Cursor model list.
- `POST /v1/chat/completions` (non-stream) → grounded answer citing the
  CMU repo's `README.md`.
- Same with `stream:true` → OpenAI-shape `data: {...}` chunks, `[DONE]`
  terminator.
- End-to-end via LibreChat: JWT login → `POST /api/agents/chat/...` →
  SSE deltas → `event: message {final:true}` with workspace-grounded
  responses across 2 turns.

## What this phase deliberately did not solve

- Multiple workspaces from one proxy process (proxy is single-workspace
  per process today).
- True conversation continuity (see finding above).
- Auth beyond LibreChat's local username/password.
- Workspace `.cursor/skills` / `.cursor/rules` / `.cursor/mcp.json` — the
  CMU repo has none of these. Phase 0 only proved the agent can read
  arbitrary repo files; the skill-driven UX is unverified.
- Anything in CLAUDE.md §10 (data residency, key model, runtime
  hosting) — these are Phase 2+ concerns.

## Hand-off to Phase 1

See [`PHASE1.md`](PHASE1.md) for the resulting scaffold. The big-rock
items it inherits from Phase 0:

1. Migrate from `cursor-api-proxy` (CLI-based, third-party) to our own
   adapter on `@cursor/sdk`.
2. Implement real conv-state mapping (`Agent.resume`).
3. Make workspace → endpoint mapping dynamic so adding a workspace
   doesn't require editing `librechat.yaml` + restart.
4. Verify the skill-driven UX with a real `.cursor/skills` config —
   pick or write one in the CMU repo before Phase 1 ends.
