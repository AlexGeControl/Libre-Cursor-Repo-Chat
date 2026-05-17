# cursor-adapter MCP config loading

> **Feature spec** for the internal helpers in
> [`src/cursor/cursor-adapter.ts`](./cursor-adapter.ts):
> `loadMcpServers` and `expandEnv`.
> **Executable spec:** [`test/cursor/cursor-adapter.test.ts`](../../test/cursor/cursor-adapter.test.ts).
>
> This is the RED-phase artifact: read it first to understand the
> feature, read the tests for exhaustive cases, read the
> implementation only when you need to know *how* the contract is met.

## Scope

The `CursorAdapter` interface and the `sdkCursorAdapter` production
wrapper around `Agent.create` / `Agent.resume` are **not** unit-tested
directly — they are exercised end-to-end by route integration tests
that swap in `FakeCursor` (see `test/support/fake-cursor.ts` and
`test/routes/chat-completions.test.ts`). The wrapper is a thin
"forward to SDK" object; mocking the SDK to test it would only
re-assert the obvious.

What does warrant unit coverage is the `.cursor/mcp.json` loading
pipeline — it has real branching (missing file, missing key, empty
map, JSON parse error) and a non-trivial env-expansion contract that
the SDK does **not** provide for us. That contract is what the public
adapter API actually promises, even though the helpers themselves
live behind module boundaries. For testability we promote
`loadMcpServers` and `expandEnv` from module-private to module
exports (the only edit to the source file).

## Purpose

`.cursor/mcp.json` declares MCP server integrations (e.g. the O'Reilly
Books MCP used by `workspaces/context-mgmt-eval-v1/`). Two things the
Cursor SDK does NOT do for us, which this module covers:

1. Auto-loading `mcp.json` from `cwd`. The SDK loads
   `.cursor/rules/` and `.cursor/skills/` when
   `settingSources: ["project"]` is set, but **not** `mcp.json`. The
   adapter has to parse the file and pass the result via the
   `mcpServers` agent option explicitly. (See PHASE1 → "Project
   `settingSources` + explicit MCP loading".)
2. Expanding `${ENV_VAR}` placeholders in config values. The same
   `${NAME}` syntax that `.cursor/mcp.json` already uses (per the
   O'Reilly integration guide) is **not** substituted by the SDK.
   The adapter expands against `process.env` before handing off.

Unresolved placeholders are intentionally left as literal `${NAME}`
strings rather than dropped or replaced with empty. The MCP server
then rejects them as a 401, which surfaces a misconfigured token
loudly instead of silently skipping the server. See the doc comment
above `loadMcpServers` in the source.

## Contract

```ts
loadMcpServers(workspaceDir: string): Record<string, McpServerConfig> | undefined
expandEnv(value: unknown): unknown
```

### `loadMcpServers`

**Inputs:**
- `workspaceDir` — absolute path to a workspace directory. The file
  it looks for is `<workspaceDir>/.cursor/mcp.json`.

**Outputs:**
- `undefined` when there is no MCP config to apply (file missing,
  `mcpServers` key absent, or `mcpServers` is the empty object).
  Returning `undefined` lets the caller spread-conditional-merge so
  the `mcpServers` agent option isn't emitted at all in that case.
- The parsed `mcpServers` object (with env expansion applied
  recursively) when present and non-empty.

**Throws:**
- Anything `JSON.parse` throws (i.e. `SyntaxError`) when the file
  exists but is not valid JSON. Documented, intentional: a malformed
  config should fail loudly at agent-creation time rather than
  silently disabling MCP.

### `expandEnv`

**Inputs:**
- Any value. Strings, arrays, plain objects, and primitives are
  handled; the function recurses through arrays and objects.

**Outputs:**
- For strings: every `${NAME}` placeholder (where `NAME` matches the
  regex `/\$\{([A-Z_][A-Z0-9_]*)\}/g` — must start with uppercase or
  underscore, followed by uppercase/digit/underscore) is replaced
  with `process.env[NAME]` if defined; otherwise the whole literal
  `${NAME}` is left in place.
- For arrays: a new array with every element recursively expanded.
- For plain objects: a new object with every value recursively
  expanded. Keys are untouched.
- For other values (number, boolean, null, undefined): returned as-is.

**Invariants:**
- The placeholder regex is uppercase-only on purpose. `${lowercase}`
  is left literal. This matches the convention `.cursor/mcp.json`
  uses for env vars and avoids accidentally rewriting strings that
  look ${like-this} but aren't config-token references.
- No global state mutated. The function reads `process.env` but
  never writes to it. Callers may freely mutate `process.env` around
  the call; the function reflects the value at call time.

## Behavior

Each row corresponds 1:1 to a test case in the test file, in the
same order. **When you add a behavior, append a row here AND add
the matching test.**

### `loadMcpServers`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | no `.cursor/mcp.json` in workspace | returns `undefined` |
| 2 | file exists but has no `mcpServers` key | returns `undefined` |
| 3 | file exists, `mcpServers` is `{}` | returns `undefined` (empty == "nothing to apply") |
| 4 | file exists, `mcpServers` has servers (no placeholders) | returns the parsed object verbatim |
| 5 | file exists, `mcpServers` has a `${ENV_VAR}` placeholder, env set | returns object with placeholder expanded |
| 6 | file exists, JSON is malformed | throws (intentional — surfaces loudly) |

### `expandEnv`

| # | Scenario | Expected |
|---|----------|----------|
| 7  | literal string with no placeholder | returned unchanged |
| 8  | `${KNOWN_VAR}` where the var is set | replaced with the env value |
| 9  | `${UNKNOWN_VAR}` where the var is unset | left as literal `${UNKNOWN_VAR}` (surfaces as 401 downstream) |
| 10 | multiple placeholders in one string | each substituted independently |
| 11 | placeholder nested deep — object > array > object > string | reached and expanded by recursion |
| 12 | non-string primitives (number, boolean, null) | passed through unchanged |
| 13 | lowercase placeholder `${lowercase}` | NOT expanded (regex is `[A-Z_][A-Z0-9_]*`) |

## Edge cases discovered post-implementation

> Append-only log of behaviors learned after the test suite first
> went green — usually during smoke tests or in production. Each
> entry: date, what we found, what changed (if anything).

(none yet — backfilled in Phase 2 TDD pass)

## Related

- **Implementation:** [`src/cursor/cursor-adapter.ts`](./cursor-adapter.ts)
- **Tests:** [`test/cursor/cursor-adapter.test.ts`](../../test/cursor/cursor-adapter.test.ts)
- **Used by:** `sdkCursorAdapter.create` and `sdkCursorAdapter.resume`
  in the same file — both invoke `loadMcpServers(skill.workspace_dir_abs)`
  and spread the result into the SDK options when defined.
- **Reference workspace:** [`workspaces/context-mgmt-eval-v1/.cursor/mcp.json`](../../../workspaces/context-mgmt-eval-v1/.cursor/mcp.json)
  — the canonical MCP config using `${OREILLY_MCP_TOKEN}`.
- **Background:** [`docs/PHASE1.md`](../../../docs/PHASE1.md) — "Project
  `settingSources` + explicit MCP loading" and "Slice — Tier-1
  context-management evals" (the `mcpServers` finding).
