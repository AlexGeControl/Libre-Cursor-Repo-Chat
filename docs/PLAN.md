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

### Phase 2 — TBD (planned)

Phase 2 is not yet scoped. The deferred backlog from Phase 1 (TDD
backfill for adapter modules, workspace data isolation, per-user API
keys, self-hosted Cursor runtime, SSO, tier-2 context-management
evals, manifest enhancements) is enumerated in
[`PHASE2.md`](PHASE2.md). A real Phase 2 starts when there's reason
to take one of those items — or a coherent cluster — on as a phase.
