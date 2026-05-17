# skill registry loader

> **Feature spec** for [`src/skills/registry.ts`](./registry.ts).
> **Executable spec:** [`test/skills/registry.test.ts`](../../test/skills/registry.test.ts).
>
> RED-phase artifact: read this first to understand the feature,
> read the tests for exhaustive cases, read the implementation only
> when you need to know *how* the contract is met.

## Purpose

The adapter exposes one "model" per deployed skill. A skill is a
directory under `workspaces/` that contains a `manifest.json`
describing the skill's id, display name, owner, target Cursor model,
and the workspace cwd (`.cursor/` config + repo) the agent should run
in. At adapter boot we walk `workspaces/`, parse each manifest, and
return a stable list of `Skill` records that the routes layer can
serve from `GET /v1/models` and resolve against `body.model` on
`POST /v1/chat/completions`.

This is filesystem-backed (no DB, no network) — what's on disk at
boot IS the registry. Adding a skill means adding a directory; no
restart-time migration step.

## Contract

```ts
loadSkills(workspacesDir: string): Promise<Skill[]>
```

**Inputs:**
- `workspacesDir` — path to the directory whose immediate
  subdirectories each contain a `manifest.json`. May be absolute or
  relative to the caller's cwd.

**Outputs:**
- Array of `Skill` records (`SkillManifest` + `workspace_dir_abs` +
  `manifest_path`), sorted by `id` ascending. Empty array if the
  directory has no manifest-bearing children.

**Throws:**
- When a manifest's `workspace_dir` resolves to a path that is missing
  or not a directory — the error message includes the offending skill
  `id` and the resolved absolute path.
- When a `manifest.json` is not valid JSON — surfaced as the
  underlying `SyntaxError` from `JSON.parse` (no per-skill wrapping).
- When `workspacesDir` itself does not exist — surfaced as the
  underlying `ENOENT` from `readdir`.

**Invariants:**
- Subdirectories without a `manifest.json` are silently skipped — a
  workspace under construction does not break boot.
- Non-directory entries directly under `workspacesDir` (loose files,
  symlinks-to-files) are skipped.
- `workspace_dir` in the manifest is resolved relative to the
  manifest's own directory, not relative to process cwd. So a
  manifest that says `"workspace_dir": "./repo"` always points at the
  sibling `repo/` regardless of where the adapter was launched from.
- `workspace_dir_abs` in the returned `Skill` is always an absolute
  path.
- `manifest_path` in the returned `Skill` is the absolute path to the
  manifest that was read.
- Result is sorted by `id` ascending so `GET /v1/models` is
  deterministic across boots.

## Behavior

Each row corresponds 1:1 to a test case in the test file, in the same
order. **When you add a behavior, append a row here AND add the
matching test.**

| # | Scenario | Expected |
|---|----------|----------|
| 1 | empty `workspacesDir` (no entries) | returns `[]` |
| 2 | one subdir with valid manifest + sibling `repo/` | returns one `Skill`; `workspace_dir_abs` is absolute and points at the sibling `repo/`; `manifest_path` is absolute |
| 3 | multiple valid manifests with out-of-order ids | returned array is sorted by `id` ascending |
| 4 | subdir with no `manifest.json` alongside subdirs that have one | the empty subdir is silently skipped; others returned |
| 5 | loose file directly under `workspacesDir` | skipped (only directories are inspected) |
| 6 | manifest's `workspace_dir` points at a path that does not exist | throws; error message contains the skill `id` |
| 7 | `manifest.json` contains invalid JSON | throws (currently a raw `SyntaxError` from `JSON.parse`) — see Edge cases |

## Edge cases discovered post-implementation

> Append-only log of behaviors learned after the test suite first went
> green — usually during smoke tests or in production. Each entry:
> date, what we found, what changed (if anything).

- **2026-05-17** — Invalid JSON in a manifest currently throws the
  raw `SyntaxError` from `JSON.parse` with no skill-id context, which
  makes the boot failure harder to triage than the "missing
  workspace_dir" case (which DOES include the id). Documented as
  current behavior in test row #7 rather than fixed in-scope; a
  future change should wrap with `skill "<dir>": invalid manifest
  JSON: ...` to match the missing-workspace_dir error shape.
- **2026-05-17** — There is no schema validation beyond TypeScript's
  structural type assertion (`as SkillManifest`). A manifest missing
  required fields (e.g. no `id`) passes `loadSkills` and surfaces
  later as an undefined comparison in the sort or as a confusing
  failure in the routes layer. Not in scope for Phase 2; flagged for
  the manifest-validation slice (zod or hand-rolled assert).

## Related

- **Implementation:** [`src/skills/registry.ts`](./registry.ts)
- **Manifest type:** [`src/skills/manifest.ts`](./manifest.ts)
- **Tests:** [`test/skills/registry.test.ts`](../../test/skills/registry.test.ts) — 7 integration tests using real temp-dir fixtures, one per behavior row
- **Used by:** [`src/index.ts`](../index.ts) — called once at adapter boot; the resulting array is handed to the routes layer and to the `/v1/models` endpoint
- **Background:** [`docs/PHASE2.md`](../../../docs/PHASE2.md) — TDD backfill scope
