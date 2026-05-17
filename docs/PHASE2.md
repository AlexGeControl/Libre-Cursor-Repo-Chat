# Phase 2 — MVP hardening

> **Status:** done, frozen 2026-05-17. Future phases reference this
> doc but do not edit it. Operational facts that survive Phase 2
> live in [`ARCHITECTURE.md`](ARCHITECTURE.md); inherited open
> questions live in [`PHASE3.md`](PHASE3.md).

## Goal

Phase 2 took on the inherited Phase-1 backlog as a coherent "make
the MVP shippable to NVIDIA HW infra engineers" arc:

- **Backend test rigor** — TDD backfill across the six adapter
  modules that shipped in Phase 1 without unit coverage, so future
  changes have an executable contract to regress against.
- **Frontend operator-readiness** — LibreChat UI lockdown via
  config (no fork): hide every panel and feature outside the MVP's
  chat-with-a-workspace surface, swap in NVIDIA branding, and strip
  the sampling params the `gpt-5.5-extra-high-fast` backend rejects.

Scope drift admitted up front: the original Phase 2 goal was
narrower ("Test rigor" cluster only — TDD backfill plus tier-2
context-mgmt evals). The backfill shipped; tier-2 evals were not
done. The LibreChat config-hardening slice was added mid-phase
once it became clear that an operator-ready MVP needs both halves
(test rigor below the line + UI hardening above). Tier-2 evals
move to Phase 3.

## Outcome

The system is now MVP-ready for NVIDIA HW infra engineers:

- 94 deterministic adapter tests (Phase 1 closed at 27), every
  source module covered by a `.spec.md` co-located with its
  implementation. `npm test` green in ~1.2s; `npm run typecheck`
  clean.
- LibreChat UI collapsed to the MVP surface: only the model
  selector + bookmarks + chat history + chat input + share button
  remain. All five composer "Tools" rows off, so the dropdown
  disappears entirely. Files panel + Export-menu shell still
  visible — the two fork-only items, deferred.
- `gpt-5.5-extra-high-fast` sampling params (`temperature`,
  `top_p`, `presence_penalty`, `frequency_penalty`, `max_tokens`,
  `stop`, `user`) stripped on the wire via `dropParams` — the
  backend's "no temperature" requirement is honored regardless of
  what LibreChat defaults to.
- NVIDIA visual identity: logo (green `#76B900` on transparent),
  matching favicons, `APP_TITLE="AIOF Agentic Engineer"`,
  `CUSTOM_FOOTER="Agentic Engineer for SCG Efficiency - Applied AI
  Team"`, `HELP_AND_FAQ_URL=https://nvidia.glean.com`. Zero
  LibreChat fork; the upstream image is unchanged, branding lands
  via docker bind-mounts.
- New reference docs: [`docs/LibreChat/`](LibreChat/) contains the
  widget→config-key map, alphabetical config reference, and an
  interactive single-file mockup (`mockup.html`) that lets an
  operator preview UI states by toggling config keys.
- Annotated `librechat.yaml.example` and an extended `.env.example`
  for onboarding the next operator.

## Inherited from Phase 1 — resolved

| # | Inherited problem | Resolution |
|---|---|---|
| 1 | TDD coverage parity for adapter modules | Six modules backfilled with `.spec.md` + executable tests. Suite size 27 → 94. See [Slice 1 findings](#2026-05-17--slice-1-tdd-backfill-across-six-adapter-modules). |
| 2 | LibreChat UI surface — too much for MVP | Full `interface:` lockdown in `librechat.yaml`; only `modelSelect` + `bookmarks` on. See [Slice 2 findings](#2026-05-17--slice-2-librechat-config-hardening--brand-overlay). |
| 3 | `gpt-5.5-extra-high-fast` rejects `temperature` etc. | `dropParams` on the custom endpoint strips the 7 offending fields before they leave LibreChat. Smoking-gun consume site upstream: `packages/api/src/endpoints/openai/transform.ts:114-127`. |
| 4 | No NVIDIA visual identity | Logo + favicons mounted into `dist/assets/`; `APP_TITLE`/`CUSTOM_FOOTER`/`HELP_AND_FAQ_URL` env vars wired. No LibreChat fork. |

## Critical design choices

Distilled from the findings log. Changing any of these requires
re-spiking, not refactoring.

### `.spec.md` discipline carried forward, not invented per-module

Phase 1 introduced the `<feature>.spec.md` convention for the four
modules that shipped with TDD. Phase 2's backfill applied the same
template (Purpose / Contract / Behavior table / Edge cases /
Related) verbatim across all six remaining modules. The result is
a uniform module-level surface: any contributor can read one spec
to learn one module's contract in 30 seconds, without reading
test-assertion bodies. Documented in
[`adapter/test/README.md`](../adapter/test/README.md).

### Minimal source surface for testability

Two modules needed *tiny* source edits to be testable, both
narrowly justified:

- `cursor-adapter.ts` — added `export` to `loadMcpServers` and
  `expandEnv` so the env-expansion contract (which IS the public
  adapter API for `.cursor/mcp.json` handling) could be unit-tested
  directly. No signature or behavior change.
- No refactor of `runtime.ts` to accept an injectable `home`
  parameter — the `process.env.HOME` override approach worked, with
  a sanity-guard test at the top of the file asserting
  `os.homedir()` honors `$HOME` on the host.

Other modules (`registry.ts`, `conv-store.ts`, `openai-translate.ts`,
`models.ts`) were testable as-shipped.

### Document behavior vs fix the bug

Two known rough edges in `registry.ts` were pinned in spec rather
than fixed in this slice:

1. Invalid manifest JSON throws raw `SyntaxError` from `JSON.parse`
   with no skill-id context (vs. the missing-`workspace_dir` error
   which does include the id).
2. No manifest schema validation beyond a TypeScript structural
   cast.

Both flagged in `registry.spec.md` Edge-cases section for a future
manifest-validation slice. The discipline: TDD backfill should not
double as opportunistic refactoring. Tests pin current behavior;
deliberate fixes are their own slices.

### `dropParams` for wire-level suppression, separate from UI hiding

The Parameters sidebar panel (`interface.parameters: false`) hides
the slider UI but does **not** strip the values from the request
body — defaults still go on the wire. The two concerns are
orthogonal in upstream's schema. For `gpt-5.5-extra-high-fast` we
need both: `dropParams` so the backend doesn't 4xx, and
`interface.parameters: false` so the user doesn't see a slider
that has no effect. Either alone is wrong.

### Brand overlay mounts `dist/assets/`, not `public/assets/`

The upstream `ghcr.io/danny-avila/librechat:latest` image is built
with `publicDir` effectively on, baking `client/public/assets/`
into `client/dist/assets/` at image-build time. The static handler
serves `dist` first (`api/server/index.js:138-140`). Bind-mounting
to `public/assets/` is silently ineffective. The active mount path
is `dist/assets/`. The pre-slice research note that pointed at
`public/assets/` was wrong; it's been corrected in
`docs/LibreChat/widget-map.md` and `config-reference.md`.

### Run agent fleets in parallel for independent module work

Slice 1 dispatched six agents in parallel, one per module. Wall
clock saved 5–6× vs a serial pass, at the cost of one post-merge
typecheck cleanup (a narrowing fix in
`test/cursor/cursor-adapter.test.ts`). Worth it when the work is
genuinely independent — each agent owned a disjoint file pair
(`<module>.spec.md` + `<module>.test.ts`).

## Lessons learned

In rough order of "would save the most time if shipped as part of
the team's playbook."

### Pre-research note ≠ verified behavior — mount the path you observe

The asset-overlay slice burned one cycle on a wrong mount path
because the pre-slice research said `public/assets/` (citing
`vite.config.ts:131` — `publicDir: false`). The actual served path
in the upstream image is `dist/assets/`. md5'ing both copies in the
container revealed the divergence; the fix was a five-second yaml
edit. The general rule: **before bind-mounting against a config
that documents what a builder *should* do, verify what the
*shipped image* actually serves.** A `docker exec md5sum` is faster
than re-reading the source.

### Source-grounded research compresses the implementation phase

Three parallel research agents spent ~5 minutes each mapping
LibreChat's config surface against the sibling clone *before* any
yaml was written. The result was the
[`docs/LibreChat/`](LibreChat/) folder + an annotated
`librechat.yaml.example`. The actual config edits then took ~15
minutes because every key was already validated. The discipline:
**when the surface area is large and unfamiliar, spend the cycle
on a write-up first.** The write-up doubles as onboarding for the
next operator.

### Mockups beat prose for config-to-UI mapping

`docs/LibreChat/mockup.html` was the single highest-leverage
artifact of the LibreChat slice. The operator could see exactly
which widget each yaml key controlled by toggling checkboxes — far
faster than reading a table. The discipline: **for config-driven
UIs, ship an interactive mock alongside the reference doc.** Tiny
HTML+JS files cost ~30 minutes and pay for themselves the first
time someone needs to "see" a config change before committing it.

### The `.spec.md` template scales linearly with no extra meta-design

Six modules, six specs, identical structure. No template revisions
needed. The Phase-1 hypothesis (the convention turns "test
coverage" into "feature contracts") survived a 6× scale-up
unchanged.

### `process.env` is shared across the entire `npm test` run

Any test that mutates `process.env` MUST restore in `t.after()` —
otherwise it bleeds into every subsequent test file. The
`cursor-adapter` and `runtime` test files were the only places
this mattered in Phase 2's backfill, but the pattern is
exemplified for future contributors. Worth flagging in
`test/README.md` if a third test file ever needs env mutation.

### Single-file docker bind-mounts pin to inodes

Bind-mounting a single file (vs. a directory) pins to the host
inode. Atomic-rename writes (which `Edit` and most editors use)
break the mount; the container keeps serving the old file. Fix:
`docker compose restart` after editing any single-file-mounted
asset. Standard Docker behavior, not project-specific — but worth
recording for the operator who hits it on a brand-asset refresh.

### Doc lifecycle held up under scope drift

Phase 2's actual shape diverged from its initial goal (added the
LibreChat slice). The lifecycle accommodated this cleanly: PHASE2.md
absorbed the new slice as a second findings-log entry, PLAN.md and
ARCHITECTURE.md stayed read-only mid-phase, and the polish-and-
ratchet step at phase close pulled both slices' operational facts
into ARCHITECTURE.md in one pass. The discipline worked because the
mid-phase doc (PHASE2.md) was the *only* thing that moved.

## Findings log

### 2026-05-17 — Slice 2: LibreChat config hardening + brand overlay

Shipped the MVP UI lockdown + NVIDIA branding overlay via pure
config + docker bind-mounts. Zero LibreChat fork; the upstream
`ghcr.io/danny-avila/librechat:latest` image is unchanged.

**Doc artifacts (created first, then implementation):**

- [`docs/LibreChat/README.md`](LibreChat/README.md) — orientation
- [`docs/LibreChat/widget-map.md`](LibreChat/widget-map.md) —
  layout walk-through, widget → key
- [`docs/LibreChat/config-reference.md`](LibreChat/config-reference.md)
  — alphabetical reference per option, with `file:line` citations
  into `/home/yaoge/Workspace/LibreChat` (`v0.8.6-rc1`)
- [`docs/LibreChat/mockup.html`](LibreChat/mockup.html) — interactive
  single-file mock that toggles widgets by config key
- [`librechat.yaml.example`](../librechat.yaml.example) — annotated
  yaml with every researched key
- [`.env.example`](../.env.example) — extended with all branding +
  feature-gate env vars

**Live config changes:**

- `librechat.yaml` — added full `interface:` block; only widget kept
  on alongside `modelSelect` is `bookmarks` (paired with
  `ALLOW_SHARED_LINKS=true` for tag-and-share). All five "Tools"-
  dropdown rows off, so the dropdown itself disappears. Added
  `dropParams: [temperature, top_p, presence_penalty,
  frequency_penalty, max_tokens, stop, user]` to the Cursor
  Workspaces endpoint — strips sampling params the
  `gpt-5.5-extra-high-fast` backend rejects (smoking-gun consume
  site in upstream: `packages/api/src/endpoints/openai/transform.ts:114-127`).
- `.env` — added `APP_TITLE="AIOF Agentic Engineer"`,
  `CUSTOM_FOOTER="Agentic Engineer for SCG Efficiency - Applied AI
  Team"`, `HELP_AND_FAQ_URL=https://nvidia.glean.com`,
  `ALLOW_SHARED_LINKS=true`, `SEARCH=false`.
- `docker-compose.yml` — four `:ro` bind-mounts from `./brand/` into
  the api container's `dist/assets/` for logo + 3 favicon sizes.

**Branding assets generated:**

- `brand/logo.svg` — Simple Icons NVIDIA glyph (MIT-licensed
  monochrome eye+wordmark), recolored to NVIDIA green `#76B900` on
  transparent (the default black was invisible against LibreChat's
  dark shell).
- `brand/favicon-{16x16,32x32}.png`, `apple-touch-icon-180x180.png`
  — rasterized from the SVG via the running librechat-api
  container's bundled `sharp` 0.33.5 (no local rasterizer needed).
  12% transparent margin added so the mark doesn't crash into
  favicon edges.

**Non-obvious finding — asset overlay path is `dist/`, not `public/`.**
Our pre-slice research note in `docs/LibreChat/widget-map.md` said
to mount over `client/public/assets/` based on
`client/vite.config.ts:131` (`publicDir: command === 'serve' ? './public' : false`).
The first attempt did exactly that and **failed** — the served
files were still the LibreChat defaults. Md5'ing both copies in the
container revealed `/app/client/dist/assets/logo.svg` and
`/app/client/public/assets/logo.svg` are *different* files: the
upstream `ghcr.io/danny-avila/librechat:latest` image is built with
`publicDir` effectively on, baking `public/assets/` into
`dist/assets/` at image-build time. The static handler then serves
`dist` first (`api/server/index.js:138-140`). Fixed by mounting
over `dist/assets/` instead, and corrected the two LibreChat
reference docs as part of the end-of-phase ratchet.

**Single-file bind-mount inode gotcha.** When recoloring the SVG
to NVIDIA green, the container kept serving the original black
version despite the host file being updated. Cause: bind-mounts on
single files pin to the host inode, and `Edit`'s atomic-rename
write created a new inode. Fix: `docker compose restart api`.
Standard Docker behavior; not project-specific.

**Verification (live):**

```
$ curl -fsS http://127.0.0.1:3080/api/config | jq '{appTitle, customFooter, helpAndFaqURL, sharedLinksEnabled}'
{
  "appTitle": "AIOF Agentic Engineer",
  "customFooter": "Agentic Engineer for SCG Efficiency - Applied AI Team",
  "helpAndFaqURL": "https://nvidia.glean.com",
  "sharedLinksEnabled": true
}

$ diff -q <(curl -s http://127.0.0.1:3080/assets/logo.svg) brand/logo.svg
# (silent — files match)

# adapter still healthy with the new yaml
$ curl -fsS http://127.0.0.1:8080/v1/models | jq '.data[].id'
"cmu-genai-v1"
"cmu-llm-systems-v1"
"context-mgmt-eval-bare-v1"
"context-mgmt-eval-v1"
"cursor-cookbook-v1"
```

The `/api/config` response shows `interface: {}` to unauthenticated
clients (deliberate — `routes/config.js:156-163` only forwards
privacyPolicy/termsOfService publicly; line 182 forwards the full
block only to authenticated users). The yaml-loaded interface IS
correct, verified via `docker logs librechat-api | grep -A50 'Custom config file loaded'`.

**Caveat — title-gen contamination still applies.** `titleConvo:
true` + `titleModel: "cmu-genai-v1"` means the title-summarize
prompt enters the Cursor agent's history (see PHASE1.md). Not
visibly broken; tracking for a later rehydration-prompt iteration
in Phase 3.

### 2026-05-17 — Slice 1: TDD backfill across six adapter modules

Closed the "Test parity" inherited item in one coordinated slice.
Six modules, each handed to a dedicated agent in parallel; every
agent followed the same discipline (write `<module>.spec.md` first,
then failing tests mirroring the spec table 1:1, then run + reconcile).

**Suite delta:** 27 → 94 tests, 18 suites, `npm run typecheck`
clean, `npm test` green end-to-end (≈1.2s).

| Module | Tests added | Test type | Spec |
|---|---|---|---|
| `src/skills/registry.ts` | 7 | integration (real-fs temp fixtures) | [registry.spec.md](../adapter/src/skills/registry.spec.md) |
| `src/state/conv-store.ts` (get/put/touch/delete + construction) | 16 | unit + integration | [conv-store.spec.md](../adapter/src/state/conv-store.spec.md) |
| `src/cursor/openai-translate.ts` | 18 | unit (pure functions) | [openai-translate.spec.md](../adapter/src/cursor/openai-translate.spec.md) |
| `src/cursor/runtime.ts` (`ensureRipgrepOnPath`) | 8 | unit (fs + `$HOME` override) | [runtime.spec.md](../adapter/src/cursor/runtime.spec.md) |
| `src/cursor/cursor-adapter.ts` (`loadMcpServers`, env expansion) | 13 | unit | [cursor-adapter.spec.md](../adapter/src/cursor/cursor-adapter.spec.md) |
| `src/routes/models.ts` | 5 | integration (`app.inject()`) | [models.spec.md](../adapter/src/routes/models.spec.md) |

**Production-source surface kept minimal:**

- `adapter/src/cursor/cursor-adapter.ts` — added `export` to the
  internal `loadMcpServers` and `expandEnv` helpers so they can be
  unit-tested directly. Justified in
  [`cursor-adapter.spec.md`](../adapter/src/cursor/cursor-adapter.spec.md):
  the env-expansion contract IS the public adapter API for
  `.cursor/mcp.json` handling, even though the helpers themselves
  are module-private at the call-site level. Signatures and
  behavior unchanged.
- `adapter/package.json` — widened test glob to include
  `test/skills/**/*.test.ts` so the new `registry` tests are
  discovered.
- No other production-source changes. `registry.ts`,
  `conv-store.ts`, `openai-translate.ts`, `runtime.ts`, and
  `models.ts` were correct as written — Phase 1 left no latent
  bugs in the modules we backfilled.

**Behavior documented rather than fixed (two known rough edges
pinned in spec, not corrected in this slice):**

1. `registry.ts` throws a raw `SyntaxError` from `JSON.parse` on a
   malformed manifest, with no skill-id context — in contrast to
   the missing-`workspace_dir` error which does include the id.
   Test row #7 in `registry.spec.md` pins current behavior; a
   future change should wrap with `skill "<dir>": invalid manifest
   JSON: …` to match.
2. `registry.ts` does no schema validation beyond TypeScript's
   structural `as SkillManifest` cast. A manifest missing required
   fields (e.g. no `id`) passes `loadSkills` and surfaces later as
   an undefined comparison in the sort or as a confusing failure
   downstream. Flagged for a future manifest-validation slice
   (zod or hand-rolled assert).

**Testing patterns crystallized for the next backfill:**

- `:memory:` SQLite is fine for the hot path of `ConvStore`, but
  WAL-pragma + reopen-idempotency tests need a real file
  (`mkdtempSync`) because `journal_mode` for an in-memory db
  always reports `"memory"` regardless of the requested pragma.
- For `runtime.ts`, `process.env.HOME` override + `utimesSync` for
  deterministic mtime is enough to test the mtime-sorted-versions
  selector hermetically — no need to refactor a `home` parameter
  into the production signature. The first test in the file is a
  sanity guard asserting `os.homedir()` honors `$HOME` on the test
  host, so a future Node change breaking the assumption fails
  loudly at that test rather than silently reading the real
  `$HOME`.
- `process.env` is shared across the whole `npm test` run; every
  test that mutates it must restore in `t.after()`. The
  `cursor-adapter` and `runtime` test files were the only places
  this mattered, but the pattern is now exemplified for future
  contributors.

**Coordination cost:** Running six agents in parallel saved
roughly 5–6× wall clock over a serial pass, at the cost of one
post-merge typecheck cleanup (a narrowing fix in
`test/cursor/cursor-adapter.test.ts:171` for a nested-object
assertion). Worth it.

## Cross-references

- Phase 1 narrative + frozen findings: [`PHASE1.md`](PHASE1.md)
- Phase 3 handoff (inherited open questions): [`PHASE3.md`](PHASE3.md)
- Current system architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Macro plan: [`PLAN.md`](PLAN.md)
- LibreChat config reference: [`LibreChat/`](LibreChat/)
- TDD conventions: [`../adapter/test/README.md`](../adapter/test/README.md)
- Project mission and rules-of-the-road: [`../CLAUDE.md`](../CLAUDE.md)
