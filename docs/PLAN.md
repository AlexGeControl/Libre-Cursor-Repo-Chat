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
The phases below replace its §9 bootstrap task list.

## Phases

### Phase 0 — CLI-first plumbing exploration (✓ done, 2026-05-16)

Validate the LibreChat ↔ adapter ↔ Cursor pipeline end-to-end with the
**Cursor CLI** via `anyrobert/cursor-api-proxy`, using a personal CMU
learning repo. No custom adapter code. Goal: de-risk before committing
to SDK-based adapter work.

**Outcome:** plumbing works. Browser → LibreChat → proxy → `agent` CLI
→ workspace, with SSE streaming and multi-turn (replayed history) all
confirmed. Several proxy/LibreChat gotchas surfaced.

→ Full story in [`PHASE0.md`](PHASE0.md).

### Phase 1 — SDK-based adapter, MVP (planned)

Replace the borrowed proxy with our own thin adapter built on
`@cursor/sdk`. Goal: own the conv-state mapping (so continuity is real
`Agent.resume`, not just LibreChat replaying history), expose multiple
workspaces from a single process, and keep the OpenAI-compatible
surface so LibreChat config stays trivial.

Definition of done is roughly CLAUDE.md §5's MVP definition but
de-NVIDIA'd for the exploration repo. Open questions and inherited
decisions live in the phase doc.

→ Draft scaffold in [`PHASE1.md`](PHASE1.md).

### Phase 2+ — not yet scoped

Likely candidates, in no particular order:

- Self-hosted Cursor runtime (data-residency story for NVIDIA HW IP).
- Per-skill / per-user API keys for cost attribution.
- Dynamic workspace registration (engineer ships a manifest, the
  system picks it up without a config edit + restart).
- Real auth (SSO).
- Worker pool / concurrent agents.

These are placeholders. They become real phases when there's reason to
start one.
