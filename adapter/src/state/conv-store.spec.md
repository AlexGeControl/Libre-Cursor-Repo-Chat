# ConvStore — SQLite-backed conv-key ↔ agent mapping

> **Feature spec** for [`src/state/conv-store.ts`](./conv-store.ts).
> **Executable spec:** [`test/state/conv-store.test.ts`](../../test/state/conv-store.test.ts).
>
> This is the RED-phase artifact: read it first to understand the
> feature, read the tests for exhaustive cases, read the
> implementation only when you need to know *how* the contract is met.

## Purpose

The adapter has to remember which Cursor `agentId` belongs to which
LibreChat conversation so that turn 2+ of a chat can call
`Agent.resume` instead of starting from scratch. `ConvStore` is the
tiny SQLite-backed table that holds that mapping, plus the timestamps
the [idle sweeper](./sweeper.spec.md) uses to garbage-collect
abandoned rows.

The store is intentionally minimal: one table, one primary key
(`conv_key`), five columns. Phase 1 is single-host single-process —
if/when we scale beyond one host, swap this for the same shape backed
by Redis without touching the call sites.

## Contract

```ts
interface ConvAgentRow {
  cursorAgentId: string;
  workspaceId: string;
  createdAt: number;     // ms since epoch, set on first put
  lastUsedAt: number;    // ms since epoch, updated by put/touch
}

class ConvStore {
  constructor(path: string);            // ":memory:" or filesystem path
  get(convKey: string): ConvAgentRow | null;
  put(convKey: string, cursorAgentId: string, workspaceId: string): void;
  touch(convKey: string): void;
  delete(convKey: string): void;
  deleteStale(beforeMs: number): string[];  // see sweeper.spec.md
  close(): void;
}
```

**Construction:**
- Ensures the parent directory of `path` exists (`mkdirSync(..., {recursive:true})`).
  Harmless no-op for `":memory:"` (whose dirname is `"."`).
- Opens (or creates) the SQLite database.
- Sets `journal_mode = WAL` and `synchronous = NORMAL` pragmas.
- Creates the `conv_agents` table and `idx_conv_agents_last_used`
  index `IF NOT EXISTS` — safe to reopen an existing db.
- Prepares all statements eagerly so per-call cost is just an exec.

**Invariants:**
- `conv_key` is the primary key. `put` is an upsert; `created_at`
  is set only on first insert and preserved across subsequent
  `put`s for the same key (see `ON CONFLICT(conv_key) DO UPDATE SET`
  clause — it updates `cursor_agent_id`, `workspace_id`, and
  `last_used_at` but NOT `created_at`).
- `put` sets `created_at` and `last_used_at` to the same `Date.now()`
  on first insert.
- `touch` updates `last_used_at` only; never modifies any other column.
- `get` returns `null` (not `undefined`) when the row is missing,
  so callers can pattern-match on `=== null`.
- `delete` is a no-op when the row does not exist; never throws.
- `close` is idempotent in practice (the underlying `better-sqlite3`
  `Database.close()` will throw on double-close, but Phase 1 callers
  never close twice — see Edge cases below).
- `deleteStale` is specced in [`./sweeper.spec.md`](./sweeper.spec.md)
  (S1–S6) and NOT re-tested here. It is the primitive the sweeper
  uses; tests for the sweeper exercise it.

## Behavior

Each row corresponds 1:1 to a test case in
[`conv-store.test.ts`](../../test/state/conv-store.test.ts), in the
same order. **When you add a behavior, append a row here AND add the
matching test.**

### Construction & schema

| # | Scenario | Expected |
|---|----------|----------|
| C1 | `new ConvStore(":memory:")` succeeds | constructor returns; no throw |
| C2 | constructor creates the `conv_agents` table | `put` then `get` round-trips without "no such table" |
| C3 | constructor enables WAL journal mode | `db.pragma("journal_mode")` returns `"wal"` |
| C4 | constructor is idempotent against an existing schema | opening the same file twice in sequence does not throw (uses `IF NOT EXISTS`) |

### `get`

| # | Scenario | Expected |
|---|----------|----------|
| G1 | `get` on empty store | returns `null` (not `undefined`) |
| G2 | `get` on a key that does not exist (but other keys do) | returns `null` |
| G3 | `get` after `put` | returns a `ConvAgentRow` with the inserted `cursorAgentId`, `workspaceId`, and numeric `createdAt`/`lastUsedAt` |

### `put`

| # | Scenario | Expected |
|---|----------|----------|
| P1 | `put` on a fresh key | row exists; `createdAt === lastUsedAt` (both set to `Date.now()` at insert time) |
| P2 | `put` twice on the same `convKey` (upsert) | second `put` wins on `cursorAgentId`, `workspaceId`, and `lastUsedAt`; `createdAt` is preserved from the FIRST insert |
| P3 | `put` of different keys does not interfere | each key's row holds its own values |

### `touch`

| # | Scenario | Expected |
|---|----------|----------|
| T1 | `touch` updates `lastUsedAt` only | `lastUsedAt` advances; `createdAt`, `cursorAgentId`, `workspaceId` are unchanged |
| T2 | `touch` on a missing key | no-op; no row created, no throw |

### `delete`

| # | Scenario | Expected |
|---|----------|----------|
| D1 | `delete` removes the row | subsequent `get` returns `null` |
| D2 | `delete` on a missing key | no-op; no throw |
| D3 | `delete` of one key does not affect siblings | other rows remain intact |

### `close`

| # | Scenario | Expected |
|---|----------|----------|
| X1 | `close` on an open store | returns without throw |

## Edge cases discovered post-implementation

> Append-only log of behaviors learned after the test suite first
> went green — usually during smoke tests or in production. Each
> entry: date, what we found, what changed (if anything).

- _(none yet — Phase 2 backfill.)_

## Related

- **Implementation:** [`src/state/conv-store.ts`](./conv-store.ts)
- **Tests:** [`test/state/conv-store.test.ts`](../../test/state/conv-store.test.ts)
- **Companion spec:** [`./sweeper.spec.md`](./sweeper.spec.md) — the
  idle sweeper, which owns the `deleteStale(beforeMs)` cases (S1–S6).
  Those cases are tested in [`test/state/sweeper.test.ts`](../../test/state/sweeper.test.ts)
  and intentionally NOT duplicated here.
- **Used by:** [`src/routes/chat-completions.ts`](../routes/chat-completions.ts)
  — the dispatcher reads on every turn, writes on agent creation,
  and touches on resume.
- **Background:** [`docs/PHASE1.md`](../../../docs/PHASE1.md) — initial
  slice; [`docs/PHASE2.md`](../../../docs/PHASE2.md) — TDD backfill.
