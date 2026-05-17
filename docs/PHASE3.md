# Phase 3 — Re-orientation: from "Cursor Skill Workspace" to "Agentic Engineer"

> **Status:** scaffold, Slice 1 spec drafted, not yet started.
> Handoff from [`PHASE2.md`](PHASE2.md). See [`PLAN.md`](PLAN.md)
> for the macro picture and [`CONTEXT.md`](CONTEXT.md) for how this
> doc evolves.

## Goal

Phase 3 opens with a **product re-orientation slice** before any
new capability work. The Phase-1 framing ("a deployed Cursor skill
workspace") was technically accurate but used software-jargon
nouns ("skill") that don't map cleanly onto NVIDIA HW engineers'
mental model. The actual product — a Cursor agent with
rules + skills + MCP + repo context, to which a HW engineer can
delegate rote farm work (test command generation, failure
analysis, next-step action drafting) — is more accessible to that
audience as an **"agentic engineer"**: a teammate persona you
delegate to, not a "workspace" you configure.

The re-orientation is naming-and-positioning, not capability.
Once it's landed, Phase 3 picks up the remaining items inherited
from Phase 2 and Phase 1 (tier-2 evals, production-readiness,
fork-only UI items) as subsequent slices.

## Slice 1 — Workspace rename + Agentic Engineer rebrand (planned)

### Intent

Bring internal code identifiers into line with the existing
external surface (`workspaces/` folder, "Workspaces" endpoint
label), then flip the user-facing surface from
"Cursor Skill Workspace" to "Agentic Engineer" terminology so the
HW engineer audience can mentally place the product on first sight.

This is naming hygiene + brand positioning, no logic changes. The
94-test suite is the regression net — `npm test` must stay green
end-to-end.

### Decisions locked

| # | Decision | Locked answer | Why |
|---|---|---|---|
| 1 | Internal code entity | `Workspace` (not `CursorWorkspace`, not `AgenticEngineer`) | Aligns internal with existing external (folder + endpoint already use "workspace"). Reserves `AgenticEngineer` as a brand-surface label that re-positions later without code churn. |
| 2 | SQLite column `conv_agents.skill_id` | Nuke `.run/adapter/conv-state.sqlite` on first start after rename | Pre-rollout; only impact is loss of in-flight convo continuity (no real internal users). Skips a one-shot migration framework that would never be used again. |
| 3 | Existing workspace ids | Rename retroactively to engineer-shaped ids | Operator wants to see the "agentic" framing live in the dropdown. Names get decided at slice kickoff with operator input; proposed starting points below. |
| 4 | LibreChat endpoint label | Flip "Cursor Workspaces" → "Agentic Engineers" | Sets up the marketing campaign at the most visible surface (model-selector header). |

### Rename map

#### Code identifiers (one agent, sequential pass)

| Old | New |
|---|---|
| `Skill` (type) | `Workspace` |
| `SkillManifest` (type) | `WorkspaceManifest` |
| `loadSkills()` | `loadWorkspaces()` |
| `skillId` (field/variable) | `workspaceId` |
| `skill_id` (SQLite column) | `workspace_id` (recreate via DB nuke; do NOT add a migration) |
| `src/skills/` (dir) | `src/workspaces/` |
| `test/skills/` (dir) | `test/workspaces/` |
| `makeSkill()` (test fixture) | `makeWorkspace()` |
| `SkillEntry`, `SkillRegistry` (CLAUDE.md design types) | `WorkspaceEntry`, `WorkspaceRegistry` |

The `package.json` test glob updates to `test/workspaces/**/*.test.ts`.

The Cursor concept `.cursor/skills/` (workspace-internal procedure
files) is **NOT** renamed — that's Cursor's own surface, not ours.

#### Existing workspace ids — proposed mapping (operator confirms at kickoff)

The five existing workspace dirs under `workspaces/` get
engineer-role names:

| Existing id | Proposed id | Persona |
|---|---|---|
| `cmu-genai-v1` | `engineer-genai-mentor-v1` | "Mentor for generative-AI fundamentals questions" |
| `cmu-llm-systems-v1` | `engineer-llm-systems-mentor-v1` | "Mentor for LLM serving / systems topics" |
| `cursor-cookbook-v1` | `engineer-cursor-sdk-guide-v1` | "Reference engineer for Cursor SDK usage" |
| `context-mgmt-eval-v1` | `eval-context-mgmt-configured-v1` | Test fixture (still visible in dropdown until manifest `hidden: true` lands — see inherited backlog) |
| `context-mgmt-eval-bare-v1` | `eval-context-mgmt-bare-v1` | Test fixture (same) |

Each rename = `git mv workspaces/<old> workspaces/<new>` +
`manifest.json` `id` field update + `display_name` to user-facing
copy. The submodule pointers stay intact (mv preserves them).

#### User-facing copy

- `librechat.yaml` endpoint `name`: "Cursor Workspaces" → "Agentic Engineers"
- `docs/LibreChat/widget-map.md`, `config-reference.md`, `mockup.html`: prose updates to use "Agentic Engineer" where the user-visible label appears, "Workspace" where the code identifier appears
- `CLAUDE.md` mission paragraph: update framing
- New `docs/AGENTIC-ENGINEER.md`: one-page explainer for the next operator / management deck — what an "agentic engineer" is in this project, how it maps to Cursor's primitives, what the role-shaped names mean

### Execution plan — one agent, four sequential passes

The rename touches every file simultaneously, so parallel agents
would just merge-conflict each other. Single agent, sequential
passes, with `npm test` green-bar checked after each pass.

1. **Pass 1 — code identifier rename.** `Skill` → `Workspace`
   across all `adapter/src/` and `adapter/test/`. Includes
   directory renames (`src/skills/` → `src/workspaces/`,
   `test/skills/` → `test/workspaces/`), package.json test glob,
   8 spec.md files, fixtures helper. Run `npm test` after
   each file group; suite must stay at 94/94.
2. **Pass 2 — SQLite column rename + DB nuke.** Update
   `conv-store.ts` schema DDL and prepared statements to use
   `workspace_id`. Update `conv-store.spec.md`. Update
   `chat-completions.ts` dispatcher references. Add a one-line
   instruction to `ARCHITECTURE.md` "Daily startup" pointing at
   `rm -f .run/adapter/conv-state.sqlite` as a one-time step
   on first start after this slice lands.
3. **Pass 3 — workspace dir renames.** `git mv` the five
   `workspaces/<id>` dirs to engineer-shaped ids, update each
   `manifest.json` `id` + `display_name`. Update
   `librechat.yaml` `models.default` list to match the new ids.
   The eval test files in `test/evals/` reference workspace ids
   — update those too.
4. **Pass 4 — user-facing copy.** `librechat.yaml` endpoint name
   flip. Doc pass through `CLAUDE.md`, `docs/LibreChat/*`,
   `docs/PHASE*.md` prose (NOT the frozen Phase 0/1/2
   narratives — those record history; only update where the
   text describes current state, e.g. PHASE3.md and
   ARCHITECTURE.md). Write the new `docs/AGENTIC-ENGINEER.md`
   one-pager. Update the `docs/LibreChat/mockup.html` labels
   where they describe the user-visible surface.

### Definition of done

- [ ] `Skill` no longer appears as a code identifier in
      `adapter/src/` or `adapter/test/`.
- [ ] `npm test` → 94/94 green; `npm run typecheck` clean;
      `npm run test:evals` → 6/6 green (requires live adapter).
- [ ] Five workspaces visible in the LibreChat model selector
      with engineer-shaped ids and the new endpoint label
      "Agentic Engineers".
- [ ] `docs/AGENTIC-ENGINEER.md` exists as the one-page explainer.
- [ ] `ARCHITECTURE.md` records the one-time DB-nuke step.
- [ ] `PHASE3.md` findings log entry recording the slice +
      capturing any surprises that came up during execution.

### Out of scope for this slice

- Manifest `hidden: true` flag (to hide eval fixtures from the
  dropdown) — listed in the inherited backlog; separate slice.
- Manifest schema validation (zod / hand-rolled assert) — listed
  in inherited backlog; separate slice.
- Any tier-2 evals or production-readiness work.

## Other Phase 3 candidates (after Slice 1)

When Slice 1 lands, the next operator picks from the inherited
backlog. The clusters from Phase 2's original table still apply.

## Bootstrap — for the session that takes Phase 3 on

### 1. Read order

1. [`../CLAUDE.md`](../CLAUDE.md) — note the status banner;
   sections §3–§13 are historical, not today's system. Read for
   mission + rules-of-the-road only.
2. [`CONTEXT.md`](CONTEXT.md) — the phase-based doc lifecycle.
3. [`PLAN.md`](PLAN.md) — multi-phase plan; confirm Phase 3 is
   still the live target.
4. [`PHASE2.md`](PHASE2.md) — the "MVP hardening" narrative.
   "Critical design choices" + "Lessons learned" are the highest-
   signal parts for a Phase 3 starter.
5. [`PHASE1.md`](PHASE1.md) — read on demand. The Cursor SDK +
   adapter design is mostly described in here.
6. [`ARCHITECTURE.md`](ARCHITECTURE.md) — operational manual for
   the running system. Required if you want to run, debug, or
   extend it.
7. [`LibreChat/`](LibreChat/) — config reference + widget map +
   interactive mockup. Required if you're touching the chat UI.
8. [`../adapter/test/README.md`](../adapter/test/README.md) — TDD
   conventions including `.spec.md` discipline. Required before
   adding adapter features.
9. This file ([`PHASE3.md`](PHASE3.md)) — pick a candidate from the
   inherited backlog below.

### 2. Required environment

Unchanged from Phase 2. `.env.example` documents the schema.
Briefly: `CURSOR_API_KEY` (must not hit the `/v1/models`
entitlement gate that breaks `@cursor/sdk@1.0.13`), optional
`OREILLY_MCP_TOKEN`, the four LibreChat secrets, plus the five
branding/feature env vars (`APP_TITLE`, `CUSTOM_FOOTER`,
`HELP_AND_FAQ_URL`, `ALLOW_SHARED_LINKS`, `SEARCH`).

### 3. Verify the baseline before touching anything

```bash
docker compose up -d
curl -fsS http://127.0.0.1:8080/health | jq .                       # adapter healthy
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3080/    # LibreChat 200
curl -fsS http://127.0.0.1:8080/v1/models | jq '.data[].id'         # 5 skills
curl -fsS http://127.0.0.1:3080/api/config | jq '.appTitle'         # "AIOF Agentic Engineer"
```

Then the full test sweep:

```bash
cd adapter
npm run typecheck   # clean
npm test            # 94/94
npm run test:evals  # 6/6 (requires OREILLY_MCP_TOKEN for C1)
```

If anything is red before you've touched anything, **stop and
diagnose first**. Likely culprits: stale `@cursor/sdk` (caret
resolved to 1.0.13 again), missing env vars, `ripgrep` not
installed in the adapter image after a rebuild, brand-asset
mount serving stale inode (run `docker compose restart api`).

### 4. Working conventions

Carried forward from Phase 2:

- **Doc lifecycle.** PLAN.md and ARCHITECTURE.md stay read-only
  during a phase. Edit `PHASE3.md` freely; ratchet operational
  knowledge into ARCHITECTURE.md *at phase close*. See
  [`CONTEXT.md`](CONTEXT.md).
- **`.spec.md` discipline.** Every new feature gets a
  `<feature>.spec.md` co-located with its implementation. Spec
  first, then failing tests mirroring the table 1:1, then
  implementation. Canonical example:
  [`../adapter/src/cursor/rehydration.spec.md`](../adapter/src/cursor/rehydration.spec.md).
- **Eval-marker discipline.** Marker literals MUST live only in
  `.cursor/` files or be runtime-generated nonces, never
  hardcoded in test source. See PHASE1.md "Tier-1 evals".
- **`@cursor/sdk` pin.** Exact `"1.0.7"` in any package.json that
  depends on it. Never `"^1.0.7"`. The caret resolves to a broken
  1.0.13 with the `feature_unavailable` entitlement bug.
- **Source-grounded research before implementation.** When the
  surface area is large or unfamiliar (e.g. a LibreChat fork, a
  self-hosted Cursor runtime), spend a cycle on a write-up first.
  The write-up doubles as onboarding for the next operator.
- **Brand asset edits require api restart.** Single-file
  bind-mounts pin to host inodes; atomic-rename writes break the
  link. After editing anything under `brand/`, run
  `docker compose restart api`. See ARCHITECTURE.md "Single-file
  bind-mounts" gotcha.

### 5. After Slice 1 — picking the next item

Slice 1 (re-orientation) is spec'd at the top of this file. Once
it lands, the next operator picks from the inherited backlog
below. The clusters from Phase 2's original table still apply:

| Theme | Combine |
|---|---|
| "Production-ready isolation" | Workspace data isolation + per-user API keys + manifest `hidden` flag |
| "Eval breadth" | Tier-2 context-mgmt evals + rehydration prompt iteration + title-gen contamination test |
| "NVIDIA deployment readiness" | Self-hosted Cursor runtime + per-user keys + SSO |
| "UI fork" | Files panel hide + Export menu shell hide + NVIDIA dark theme + pre-hydration title flash |

Pick one cluster, write a new slice spec above the inherited
backlog, then start with the first item's `.spec.md`. Phase 1
and Phase 2's slice structure are good templates.

## Inherited from Phase 2

### Tier-2 context-management evals

Phase 2's original scope listed this as half of the "Test rigor"
cluster. The TDD backfill shipped (Slice 1); tier-2 evals did
not. The
[`context-mgmt-eval-v1`](../workspaces/context-mgmt-eval-v1/) /
[`context-mgmt-eval-bare-v1`](../workspaces/context-mgmt-eval-bare-v1/)
pair already covers tier-1 (always-rule + skill + MCP, presence +
absence). Tier-2 would add:

- **Glob-scoped rule** fires when a matching file is in context;
  does NOT fire when it isn't.
- **Description-selected rule** fires when the prompt matches;
  does NOT leak to off-topic prompts.
- **Manual rule** fires only on `@rule-name` invocation.

These would close the "is Cursor's rule selection actually working
as documented?" question and add ~5 more evals to the suite.

### UI fork candidates (deferred from Phase 2 Slice 2)

Three widgets that LibreChat ships unconditionally and the MVP
operator considered out-of-scope to fork in Phase 2:

- **Files sidebar panel** — `useSideNavLinks.ts:173-180` pushes
  it unconditionally. No `interface:` toggle.
- **Export menu shell** — `Header.tsx:62-79` always renders the
  menu. The Share item inside is env-gated (`ALLOW_SHARED_LINKS`),
  but the menu shell itself is not.
- **Pre-hydration title flash** — `client/index.html:11`
  hardcodes `<title>LibreChat</title>`. Visible for a beat before
  React mounts and `APP_TITLE` takes over.
- **NVIDIA dark theme** — no `customCSS` hook exists. Smallest
  fork: ~20-30 lines across `client/src/style.css:69-191` (CSS
  variable ramps for light/dark) and `client/tailwind.config.cjs:75-87`
  (green ramp). Rebuild the LibreChat image and pin a custom tag
  in `docker-compose.yml`.

All four would land cleanly in one "UI fork" slice if pursued
together. The trade-off: any LibreChat upstream bump now requires
a manual rebase against our fork. Worth doing only when the
operator has a real reason (e.g. brand polish before a wider
internal rollout).

## Inherited from Phase 1 (still open)

### Workspace data isolation

Two leak windows discovered during Phase 1, both still deferred:

1. **`~/.cursor/chats/<hash>/`** — Cursor caches per-host chat
   transcripts. A fresh agent (different convKey, same workspace)
   can grep them and surface another conversation's data.
   Documented in PHASE1.md "Slice 2b — side-channel finding".
2. **Cross-workspace grep within `/app/workspaces/`** — the
   bare-vs-configured eval pair currently passes (the agent
   doesn't bother), but the topology allows it. A determined or
   differently-trained agent could grep
   `context-mgmt-eval-v1/.cursor/` from
   `context-mgmt-eval-bare-v1/`'s cwd.

Production-grade fixes:

- **Per-agent containers** — each Cursor agent invocation gets
  its own short-lived container with only its workspace mounted.
  Heavier ops but airtight.
- **Or:** a chrooted / namespaced cwd inside the existing adapter
  container.
- **Or:** an upstream Cursor option to disable cross-cwd file
  access.

### Per-user / per-skill API keys

Today the adapter uses one shared `CURSOR_API_KEY` for all
invocations. Production needs per-skill or per-user keys for cost
attribution. Plumb a key resolver into `CursorAdapter` and let
manifests declare a key alias.

### Self-hosted Cursor runtime

The cloud-hosted runtime is fine for the dev pilot but blocks
NVIDIA HW IP deployment per CLAUDE.md §10. Phase-3 confirmation:
does the team have the Enterprise SKU, can we run a self-hosted
runtime, and what does the adapter need to look like when the
SDK points at a local cluster instead of `api.cursor.com`?

### SSO

Today: LibreChat local username/password registration. CLAUDE.md
§11 lists SSO as Phase-3 work. Likely the first thing required
before a wider internal rollout.

### Manifest schema enhancements

- `hidden: true` flag to suppress test-fixture workspaces from
  the user-facing `/v1/models` listing (both eval workspaces
  currently appear in the LibreChat dropdown — cosmetic noise).
- `cursor_settings_sources` override per workspace if some
  workspace ever needs `["user", "project"]` or similar.
- Per-skill MCP server overrides separate from `mcp.json`.

### Manifest validation

`registry.ts` currently does no schema validation beyond
TypeScript's structural `as SkillManifest` cast (pinned as
documented behavior in
[`registry.spec.md`](../adapter/src/skills/registry.spec.md)
Edge cases). A missing `id` passes `loadSkills` and surfaces
later as an undefined comparison in the sort. A
manifest-validation slice would add zod or a hand-rolled assert,
plus wrap the raw `SyntaxError` from `JSON.parse` with skill-id
context.

### Rehydration prompt iteration

Slice 2c's rehydration prompt (PHASE1.md) is deliberately blunt.
Two known soft spots:

- **Title-gen contamination** — LibreChat's `titleConvo` flow
  resumes the same Cursor agent with a "summarize for title"
  prompt, which enters the agent's history. Not visibly broken
  but worth tracking.
- The "do not respond to prior user turns" framing may be too
  prescriptive — could be softened once the eval suite covers
  enough cases to detect regression.

### LibreChat config version bump

`librechat.yaml` declares `version: 1.3.5` while upstream's example
is on `1.3.11`. Field is unenforced
(`packages/data-provider/src/config.ts:1339` — `version: z.string()`),
so it's cosmetic — a startup warning, not a failure. Bump when
convenient.

## Cross-references

- Phase 1 narrative + frozen findings: [`PHASE1.md`](PHASE1.md)
- Phase 2 narrative + frozen findings: [`PHASE2.md`](PHASE2.md)
- Current system architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Macro plan: [`PLAN.md`](PLAN.md)
- LibreChat config reference: [`LibreChat/`](LibreChat/)
- TDD conventions: [`../adapter/test/README.md`](../adapter/test/README.md)
- Project mission and rules-of-the-road: [`../CLAUDE.md`](../CLAUDE.md)
