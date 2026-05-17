# ripgrep PATH bootstrap

> **Feature spec** for [`src/cursor/runtime.ts`](./runtime.ts).
> **Executable spec:** [`test/cursor/runtime.test.ts`](../../test/cursor/runtime.test.ts).
>
> This is the RED-phase artifact: read it first to understand the
> feature, read the tests for exhaustive cases, read the
> implementation only when you need to know *how* the contract is met.

## Purpose

The Cursor SDK's local executor shells out to `rg` (ripgrep) at
startup and refuses to run with "Ripgrep path not configured" if
`which rg` returns nothing real. The shell function that Claude Code
defines does NOT count as a binary on the executor's check, and many
NVIDIA dev hosts don't have a system-wide `rg` package. The Cursor
agent CLI install bundles its own `rg` under
`$HOME/.local/share/cursor-agent/versions/<release>/rg`, so this
helper finds the freshest bundled copy and prepends its directory to
`process.env.PATH` before we ever touch the SDK.

It runs once at adapter startup. It must be a no-op if a previous
call already added the directory — multiple startups (e.g. in tests)
must not duplicate the entry.

## Contract

```ts
ensureRipgrepOnPath(): { rgDir: string | null }
```

**Inputs:**
- None. Reads `homedir()` and `process.env.PATH`.

**Outputs:**
- `{ rgDir: string }` — absolute path to the version directory that
  contains the `rg` binary (i.e. the directory you'd prepend to PATH).
- `{ rgDir: null }` — no usable bundled `rg` was found. PATH is left
  untouched.

**Throws:** never. Missing directories and missing binaries are
expected conditions and surface as `rgDir: null`.

**Invariants:**
- When multiple version directories carry an `rg` binary, the one
  with the most recent `mtime` wins. (Ties are not specified — they
  shouldn't happen in the install layout, and the spec doesn't
  promise an order for them.)
- PATH is prepended, never overwritten — existing entries survive.
- Calling the function twice does not duplicate the entry on PATH.
- Subdirectories that exist but contain no `rg` file are ignored.
- When `$HOME/.local/share/cursor-agent/versions` does not exist, the
  function returns `null` and leaves PATH untouched (this is the
  common case on fresh containers before the agent CLI has run).

## Testing approach

The function calls `homedir()` directly with no injection seam, and
we cannot let the test see the real user's `~/.local/share/...`
tree (it would be flaky and possibly non-empty). We use **approach
(A)**: override `process.env.HOME` to a `mkdtempSync` root before the
test, then restore it after. On Linux, `node:os` `homedir()` honors
`$HOME` — verified directly in the suite's first test as a sanity
assert so a future Node change that breaks this assumption fails
loudly here rather than silently reading the real `$HOME`.

Each test also snapshots and restores `process.env.PATH`, because the
function mutates it and the rest of the suite shares the same
process.

`mtime` ordering is made deterministic with `utimesSync` rather than
relying on real-time file creation order — filesystems with 1s mtime
granularity would otherwise flake this.

## Behavior

Each row corresponds 1:1 to a test case in the test file, in the same
order. **When you add a behavior, append a row here AND add the
matching test.**

| # | Scenario | Expected |
|---|----------|----------|
| 1 | `homedir()` honors `$HOME` (sanity guard for approach A) | `os.homedir()` equals our temp root |
| 2 | versions dir does not exist | returns `{ rgDir: null }`, PATH unchanged |
| 3 | versions dir exists but is empty | returns `{ rgDir: null }`, PATH unchanged |
| 4 | versions dir has subdirs but none contains an `rg` file | returns `{ rgDir: null }`, PATH unchanged |
| 5 | one version dir contains an `rg` file | returns that dir, PATH prepended with it |
| 6 | multiple version dirs, all with `rg` — newest mtime wins | returns the newest dir, PATH prepended with it |
| 7 | calling twice does not duplicate the PATH entry (idempotent) | PATH contains the dir exactly once |
| 8 | existing PATH entries are preserved (only prepended) | original PATH appears after the prepended dir |

## Edge cases discovered post-implementation

> Append-only log of behaviors learned after the test suite first went
> green — usually during smoke tests or in production. Each entry:
> date, what we found, what changed (if anything).

_(none yet)_

## Related

- **Implementation:** [`src/cursor/runtime.ts`](./runtime.ts)
- **Tests:** [`test/cursor/runtime.test.ts`](../../test/cursor/runtime.test.ts)
- **Called by:** [`src/index.ts`](../index.ts) — invoked once at adapter boot, before any `@cursor/sdk` import-side-effect runs.
- **Background:** [`docs/PHASE1.md`](../../../docs/PHASE1.md) — the "Ripgrep path not configured" finding from the first end-to-end smoke run.
