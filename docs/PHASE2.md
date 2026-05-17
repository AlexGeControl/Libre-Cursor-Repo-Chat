# Phase 2 — TBD

> **Status:** scaffold. Not started. Handoff from
> [`PHASE1.md`](PHASE1.md). See [`PLAN.md`](PLAN.md) for the macro
> picture and [`CONTEXT.md`](CONTEXT.md) for how this doc evolves.

## Goal

Phase 2 is not yet scoped. Phase 1 closed feature-complete on the
core "workspace-as-a-service" hypothesis: rules + skills + MCP all
visibly shape responses through the Dockerized adapter, with TDD
coverage for the adapter logic and a bracketed eval suite for the
context-management surface.

Phase 2 picks up the items Phase 1 deliberately deferred. Below is
the inherited backlog — Phase 2 starts when there's reason to take
one (or a coherent cluster) on as a real phase.

## Bootstrap — for the session that takes Phase 2 on

When a future contributor (human or Claude) opens this file with
intent to start Phase 2, here is the minimum context to load and
the minimum state to verify *before* picking an item from the
inherited backlog.

### 1. Read order

1. [`../CLAUDE.md`](../CLAUDE.md) — note the status banner; sections
   §3–§13 are historical and describe Phase 0 plumbing, not today's
   system. Read for mission + rules-of-the-road, not for design.
2. [`CONTEXT.md`](CONTEXT.md) — the phase-based doc lifecycle this
   repo follows.
3. [`PLAN.md`](PLAN.md) — multi-phase plan; confirm Phase 2 is still
   the live target.
4. [`PHASE1.md`](PHASE1.md) — narrative for everything that's
   load-bearing in today's system. The "Critical design choices" and
   "Lessons learned" sections are the highest-signal parts for a
   Phase 2 starter.
5. [`ARCHITECTURE.md`](ARCHITECTURE.md) — operational manual for the
   running system; **how to actually run, debug, and extend it.**
6. This file ([`PHASE2.md`](PHASE2.md)) — pick a Phase 2 candidate
   from the inherited backlog below.
7. [`../adapter/test/README.md`](../adapter/test/README.md) — TDD
   conventions, including the `.spec.md` discipline. Required reading
   before adding any new feature.

### 2. Required environment

The repo expects (`.env.example` documents the schema):

- `CURSOR_API_KEY` — a valid Cursor API key. Must NOT be subject to
  the `/v1/models` entitlement gate that broke
  `@cursor/sdk@1.0.13` for this team (see PHASE1.md "verdict
  reversed" finding). The adapter pins `@cursor/sdk@1.0.7` exactly
  to dodge this.
- `OREILLY_MCP_TOKEN` — optional. The MCP eval (`C1`) skips cleanly
  when absent.
- The four LibreChat secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`,
  `CREDS_KEY`, `CREDS_IV`) — regenerate per machine via
  `openssl rand -hex 32` (or 16 for `CREDS_IV`).

Submodules (`git submodule update --init --recursive`) bring three
real workspace repos under `workspaces/`. The two eval workspaces
(`context-mgmt-eval-v1`, `context-mgmt-eval-bare-v1`) are plain
directories in this repo, not submodules.

### 3. Verify the Phase 1 baseline before touching anything

```bash
docker compose up -d
curl -fsS http://127.0.0.1:8080/health | jq .          # adapter
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3080/  # LibreChat = 200
curl -fsS http://127.0.0.1:8080/v1/models | jq '.data[].id'        # 5 skills
```

Expected: adapter healthy, 5 workspaces listed, LibreChat returns
200. Then run the full test sweep:

```bash
cd adapter
npm test            # 27/27 unit+integration pass
npm run test:evals  # 6/6 evals pass (requires OREILLY_MCP_TOKEN for C1)
```

If any of these fail before you've touched anything, **stop and
diagnose first** — don't start Phase 2 work against a broken Phase 1
baseline. Likely culprits: stale `@cursor/sdk` (caret resolved to
1.0.13 again), missing env vars, `ripgrep` not installed in the
adapter image after a rebuild.

### 4. Working conventions

- **Doc lifecycle:** PLAN.md and ARCHITECTURE.md are read-only
  during a phase. Edit `PHASE2.md` freely; ratchet operational
  knowledge into ARCHITECTURE.md *at the end of the phase*, not
  mid-stream. See [`CONTEXT.md`](CONTEXT.md).
- **TDD with feature specs:** every new feature gets a
  `<feature>.spec.md` co-located with its implementation. Write the
  spec first, then the failing test, then the implementation. See
  [`adapter/src/cursor/rehydration.spec.md`](../adapter/src/cursor/rehydration.spec.md)
  for the canonical example.
- **Eval discipline:** marker literals MUST live only in `.cursor/`
  files or be runtime-generated nonces, never hardcoded in test
  source. See `context-mgmt-eval-v1/eval.spec.md` for the
  post-mortem on why.
- **Pin `@cursor/sdk` to exact `1.0.7`** in any package.json that
  depends on it. Never `^1.0.7`. The caret resolves to 1.0.13 which
  has the `feature_unavailable` entitlement bug.
- **Memory:** the project carries two persistent feedback memories
  (default Cursor model = `gpt-5.5-extra-high-fast`, SDK pin to
  1.0.7). New Claude sessions auto-load these via MEMORY.md.

### 5. Picking a Phase 2 starting item

The inherited backlog below is unordered on purpose — Phase 2's
real shape depends on which item (or cluster) has user-pull. A few
clusters that would make coherent phase-2 packages:

| Theme | Combine |
|---|---|
| "Production-ready isolation" | Workspace data isolation + per-user API keys + manifest `hidden` flag |
| "Test rigor" | TDD backfill for all adapter modules + tier-2 context-mgmt evals |
| "NVIDIA deployment readiness" | Self-hosted Cursor runtime + per-user keys + SSO |
| "Eval breadth" | Tier-2 evals + rehydration prompt iteration + title-gen contamination test |

Pick one cluster, write a real Phase 2 goal at the top of this
file, then start the first slice with its `.spec.md`. The Phase 1
slices in [`PHASE1.md`](PHASE1.md) are good templates for slice-by-
slice TDD execution.

## Inherited from Phase 1

### Test parity (TDD backfill)

Phase 1 shipped tests for the modules where TDD was actively driving
design: `rehydration`, `chat-completions` (dispatch + resume +
rehydrate), `conv-store.deleteStale`, `sweeper`. Other adapter
modules still ship without tests because we needed end-to-end
functionality first. Concrete inventory:

| Module | Test type | Priority |
|---|---|---|
| `src/skills/registry.ts` | integration with real fs fixtures | high — manifest schema is the public API |
| `src/state/conv-store.ts` (get/put/touch/delete) | unit + integration | high — durable state, easy to test |
| `src/cursor/openai-translate.ts` | unit (pure functions) | medium |
| `src/cursor/runtime.ts` (`ensureRipgrepOnPath`) | unit with fs mocks | medium |
| `src/routes/models.ts` | integration | low (trivial route) |
| `src/cursor/cursor-adapter.ts` (`loadMcpServers`, env expansion) | unit | medium — env expansion has edge cases |

Each backfill follows the established TDD discipline (write
`<feature>.spec.md` first, then failing tests, then implementation
notes). See [`adapter/test/README.md`](../adapter/test/README.md).

### Tier-2 context-management evals

The [`context-mgmt-eval-v1`](../workspaces/context-mgmt-eval-v1/) /
[`context-mgmt-eval-bare-v1`](../workspaces/context-mgmt-eval-bare-v1/)
pair covers the basics (always-rule + skill + MCP, presence + absence).
The spec defines tier-2 cases that exercise Cursor's *selection*
logic:

- **Glob-scoped rule** fires when a matching file is in context; does
  NOT fire when it isn't.
- **Description-selected rule** fires when the prompt matches; does
  NOT leak to off-topic prompts.
- **Manual rule** fires only on `@rule-name` invocation.

These would close the "is Cursor's rule selection actually working
as documented?" question and add ~5 more evals to the suite.

### Workspace data isolation

Two related leak windows discovered during Phase 1, both deferred:

1. **`~/.cursor/chats/<hash>/`** — Cursor caches per-host chat
   transcripts. A fresh agent (different convKey, same workspace)
   can grep them and surface another conversation's data. Documented
   in PHASE1.md "Slice 2b — side-channel finding".
2. **Cross-workspace grep within `/app/workspaces/`** — the bare-vs-
   configured eval pair currently passes (the agent doesn't bother),
   but the topology allows it. A determined or differently-trained
   agent could grep `context-mgmt-eval-v1/.cursor/` from
   `context-mgmt-eval-bare-v1/`'s cwd.

Production-grade fixes:
- Per-agent containers — each Cursor agent invocation gets its own
  short-lived container with only its workspace mounted. Heavier ops
  but airtight.
- Or: a chrooted / namespaced cwd inside the existing adapter
  container.
- Or: an upstream Cursor option to disable cross-cwd file access.

### Per-user / per-skill API keys

Today the adapter uses one shared `CURSOR_API_KEY` for all
invocations. Production needs per-skill or per-user keys for cost
attribution. Plumb a key resolver into `CursorAdapter` and let
manifests declare a key alias.

### Self-hosted Cursor runtime

The cloud-hosted runtime is fine for the dev pilot but blocks NVIDIA
HW IP deployment per CLAUDE.md §10. Phase 2 confirmation: does the
team have the Enterprise SKU, can we run a self-hosted runtime, and
what does our adapter need to look like when the SDK points at a
local cluster instead of `api.cursor.com`?

### Manifest schema enhancements

- `hidden: true` flag to suppress test-fixture workspaces from the
  user-facing `/v1/models` listing (currently both eval workspaces
  appear in the LibreChat dropdown — cosmetic noise).
- `cursor_settings_sources` override per workspace if some workspace
  ever needs `["user", "project"]` or similar.
- Per-skill MCP server overrides separate from `mcp.json`.

### Rehydration prompt iteration

Slice 2c's rehydration prompt is deliberately blunt (treats prior
turns as established context, asks the agent to respond only to the
latest). Two known soft spots:
- Title-gen contamination — LibreChat's titleConvo flow resumes the
  same Cursor agent with a "summarize for title" prompt, which
  enters the agent's history. Not visibly broken but worth tracking.
- The prompt's "do not respond to prior user turns" framing may be
  too prescriptive — could be softened once the test suite covers
  enough cases to detect regression.

### LibreChat config version bump

`librechat.yaml` declares `version: 1.3.5` while the running container
ships at `v0.8.6-rc1` (whose config schema is on a later version).
Cosmetic startup warning. Bump when convenient.

### SSO

Phase 1 uses LibreChat's local username/password registration. CLAUDE.md
§11 lists SSO as Phase 3 work; Phase 2 may or may not pick it up
depending on user-rollout pressure.

## Cross-references

- Phase 1 narrative + frozen findings: [`PHASE1.md`](PHASE1.md)
- Current system architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Macro plan: [`PLAN.md`](PLAN.md)
- TDD conventions: [`../adapter/test/README.md`](../adapter/test/README.md)
- Project mission and rules-of-the-road: [`../CLAUDE.md`](../CLAUDE.md)
