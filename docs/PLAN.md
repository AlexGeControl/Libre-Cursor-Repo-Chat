# Plan — Cursor-as-a-Service

> Live plan. See [`CONTEXT.md`](CONTEXT.md) for how this document is
> maintained. For how the current system actually runs, see
> [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Mission

Let HW infra engineers turn their **Cursor workspaces** (distilled
test-gen / result-analysis know-how, encoded in `.cursor/` configs +
target repos) into **agentic engineers** — teammate personas any
authorized engineer can delegate rote farm work to. One workspace = one
agentic engineer in the LibreChat model dropdown, backed by a Cursor
agent running with the original engineer's config and a mounted repo.
Delegate, not replace.

One-page explainer: [`AGENTIC-ENGINEER.md`](AGENTIC-ENGINEER.md). The
original design and constraints live in [`../CLAUDE.md`](../CLAUDE.md).

## Phases

### Phase 0 — CLI-first plumbing exploration (✓ done, 2026-05-16)

Validated LibreChat ↔ adapter ↔ Cursor end-to-end via
`anyrobert/cursor-api-proxy` + Cursor CLI, using a personal CMU
learning repo. De-risked before committing to SDK work. Full story:
[`PHASE0.md`](PHASE0.md).

### Phase 1 — Adapter MVP, feature-complete workspace-as-a-service (✓ done, 2026-05-17)

Replaced the borrowed proxy with our own Fastify + `@cursor/sdk@1.0.7`
adapter, Dockerized. Owns real `Agent.resume` continuity (SQLite-backed
convKey → agentId mapping), serves multiple workspaces from one
process, validates rules + skills + MCP end-to-end through a TDD eval
suite with a bare-workspace negative control. Full story:
[`PHASE1.md`](PHASE1.md).

### Phase 2 — MVP hardening (✓ done, 2026-05-17)

Backend test rigor + frontend operator-readiness, shipped as two
slices: TDD backfill brought the adapter suite from 27 to 94
deterministic tests (every source module covered by a `.spec.md`),
and LibreChat was locked down to the MVP UI surface with NVIDIA
branding overlaid via docker bind-mounts — zero LibreChat fork.
Full story: [`PHASE2.md`](PHASE2.md).

### Phase 3 — in flight (Slice 1 done, 2026-05-18; next slice TBD)

Phase 3 opened with a product re-orientation slice rather than new
capability work — the Phase-1 "skill / workspace" framing didn't read
to NVIDIA HW engineers, who place teammate-shaped abstractions more
easily than configurable-software ones. **Slice 1 — workspace rename +
Agentic Engineer rebrand** shipped 2026-05-18: internal code entity
unified to `Workspace`, five workspace ids renamed to engineer/eval
shape, LibreChat endpoint label flipped to "Agentic Engineers", and a
new [`AGENTIC-ENGINEER.md`](AGENTIC-ENGINEER.md) one-pager grounds the
product positioning. 94/94 unit tests + 4/4 deterministic evals stayed
green throughout.

After Slice 1, the inherited backlog from Phase 2 carries forward:
tier-2 context-management evals, production-readiness (workspace data
isolation, per-user keys, self-hosted Cursor runtime, SSO), and the
cosmetic fork items from Phase 2 Slice 2 (Files panel, Export menu
shell, NVIDIA dark theme). Full list of candidates and the Slice 1
findings: [`PHASE3.md`](PHASE3.md). Next slice picks up when an item —
or a coherent cluster — has user-pull.
