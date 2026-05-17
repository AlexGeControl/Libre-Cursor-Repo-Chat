# Plan — Cursor-as-a-Service

> Live plan. See [`CONTEXT.md`](CONTEXT.md) for how this document is
> maintained. For how the current system actually runs, see
> [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Mission

Let HW infra engineers deploy their **Cursor workspaces** (distilled
test-gen / result-analysis know-how, encoded in `.cursor/` configs +
target repos) as **multi-user chat services**, so per-engineer expertise
scales across the org. One workspace = one "skill" in a LibreChat model
dropdown, backed by a Cursor agent running with the original engineer's
config and a mounted repo.

The original design and constraints live in [`../CLAUDE.md`](../CLAUDE.md).

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

### Phase 3 — TBD (planned)

Phase 3 inherits tier-2 context-management evals (deferred from
Phase 2's original scope) plus the production-readiness backlog
that's been carrying since Phase 1 (workspace data isolation,
per-user / per-skill API keys, self-hosted Cursor runtime, SSO).
Plus a handful of cosmetic fork items from Phase 2 Slice 2 (Files
panel, Export menu shell, NVIDIA dark-theme). Full list of
candidates: [`PHASE3.md`](PHASE3.md). A real Phase 3 starts when
one item — or a coherent cluster — has user-pull.
