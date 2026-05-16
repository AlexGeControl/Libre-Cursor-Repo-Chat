# Phase 1 — SDK-based adapter, MVP

> **Status:** scaffold. Not started. Hand-off from
> [`PHASE0.md`](PHASE0.md). See [`PLAN.md`](PLAN.md) for the macro
> picture and [`CONTEXT.md`](CONTEXT.md) for how this doc evolves.

## Goal

Replace the borrowed `cursor-api-proxy` with our own thin adapter built
on `@cursor/sdk`. Match the OpenAI-compatible surface that LibreChat
already talks to, but own enough of the lifecycle that:

- conversation continuity is real `Agent.resume`, not LibreChat-side
  history replay;
- one adapter process can serve multiple workspaces;
- adding a workspace doesn't require editing `librechat.yaml` and
  restarting LibreChat.

Definition of done is roughly CLAUDE.md §5's MVP definition, de-NVIDIA'd
for this exploration repo: one engineer opens LibreChat, picks one of
several skills from the model dropdown, asks a question, sees a streamed
reply that demonstrably used the workspace's `.cursor/` config, and
continues the conversation across 3+ turns with continuity that
survives a fresh adapter request.

## Inherited from Phase 0

These problems Phase 0 surfaced but did not solve. Phase 1 picks them
up:

1. **Real conv-state mapping.** The adapter holds a `convId → cursorAgentId`
   map (Redis or SQLite per CLAUDE.md §4) and calls `Agent.resume` on
   second+ turns. Verifies that Cursor's own context state actually
   persists across turns, unlike Phase 0.

2. **Multi-workspace from one process.** The adapter's `/v1/models`
   reads from a registry that scans `workspaces/*/manifest.json`. Each
   workspace becomes a model id. LibreChat's `librechat.yaml` registers
   one custom endpoint with `models: fetch: true` and lets the adapter
   own the list.

3. **Skill-driven UX is unverified.** The CMU repo Phase 0 used has no
   `.cursor/` config. Before Phase 1 ends, drop a real `.cursor/skills/`
   + `.cursor/rules/` into the workspace and confirm they actually
   shape responses. This is the first time we'd be testing the *actual*
   product hypothesis (skill-as-service), not just the plumbing.

4. **Workspace trust handling.** Phase 0's solution was to patch the
   third-party proxy. The new adapter needs its own decision: pass
   `--trust` to the underlying SDK call? Use a different sandbox model?
   Worth re-deciding from first principles, not just inheriting the
   patch.

## Open decisions

These are real choices Phase 1 will have to make. Not yet decided.

### SDK vs continued CLI

Re-confirm `@cursor/sdk` is in fact the right substrate. The SDK is
public beta (Apr 2026 per CLAUDE.md). If the SDK's lifecycle primitives
(`Agent.create`, `Agent.resume`, `agent.send`, `run.stream()`) cover
our needs cleanly, we use it. If they don't, we fall back to spawning
the CLI ourselves with a better-designed wrapper than cursor-api-proxy.
This decision unblocks the rest of Phase 1.

### Conv-state store

CLAUDE.md §4 suggests Redis (MVP) / SQLite (single-node). For one
exploration host with low concurrency, SQLite is simpler and removes a
container. Redis becomes worthwhile when there are multiple adapter
processes or we want LRU eviction primitives we don't want to write.
Likely answer: SQLite for Phase 1, Redis later — but reconfirm.

### LibreChat surface: OpenAI-compat or Anthropic-compat

LibreChat supports both shapes via different endpoint types. OpenAI is
what we have working. Anthropic shape might map more cleanly to
Cursor's underlying call semantics. Worth a 30-minute read before
locking in.

### Workspace manifest schema

CLAUDE.md §7's `SkillEntry` is a starting sketch — `modelName`,
`workspaceDir`, `description`, `owner`, `cursorModel`. Phase 1 should
finalize this and document it under `docs/SKILL_MANIFEST.md` (also
referenced by CLAUDE.md §6 and not yet written).

## Out of scope for Phase 1

- Auth beyond LibreChat local username/password.
- Per-user / per-skill Cursor API keys.
- Self-hosted Cursor runtime (data residency story).
- Worker pool / concurrent agents per workspace.
- Engineer-facing manifest upload UI — that's Phase 3 per CLAUDE.md §11.

## Definition of done

- Adapter under `adapter/` (Node + TS), implements `GET /v1/models` and
  `POST /v1/chat/completions` (with `stream: true`).
- At least two workspaces are exposed from one adapter process.
- A multi-turn chat in LibreChat demonstrably uses `Agent.resume` (verify
  via adapter logs or Cursor-side state, not just visible continuity).
- At least one workspace has real `.cursor/skills` + `.cursor/rules`
  that visibly shape responses.
- `cursor-api-proxy` is no longer in the runtime path. The sibling
  checkout can stay as a reference.
- Phase 0's operational gotchas (proxy patch, `--force` admin block,
  bind address) either no longer apply to the new adapter or are
  documented in `ARCHITECTURE.md` for the new world.

## Findings log

> Append to this section during the phase. Distill into headings at the
> end of the phase per [`CONTEXT.md`](CONTEXT.md).

_(empty — Phase 1 has not started)_
