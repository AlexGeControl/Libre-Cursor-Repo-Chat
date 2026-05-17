# idle-agent sweeper

> **Feature spec** for [`src/state/sweeper.ts`](./sweeper.ts).
> **Executable spec:** [`test/state/sweeper.test.ts`](../../test/state/sweeper.test.ts).
>
> Companion primitive: `ConvStore.deleteStale(beforeMs)` in
> [`./conv-store.ts`](./conv-store.ts). A comprehensive spec for
> `ConvStore` itself lands as part of the Phase 2 test backfill;
> this slice tests `deleteStale` via the sweeper's integration tests.

## Purpose

The adapter's `conv_agents` SQLite table grows by one row per
LibreChat conversation. Without cleanup it accumulates forever:
every dropped chat, every test conversation, every now-deleted
LibreChat user leaves a row behind that nobody will resume.

The sweeper periodically forgets mappings that haven't been touched
in a configurable TTL window. **Forgetting is lazy GC** — we only
delete the SQLite row; the Cursor-side agent is left for Cursor's
own server-side garbage collection to reclaim. (The SDK's
`Agent.delete` is cloud-only, and our agents are local, so we have
no way to delete them upstream anyway. Even if we did, an idle agent
on a server we don't own is not our resource leak to worry about.)

The user-facing consequence: a conversation that's been idle longer
than the TTL, when the user next sends a message, will hit the
adapter's create-path with history, which triggers the rehydration
prompt (slice 2c). They lose Cursor's working memory on that turn
but keep the conversation transcript LibreChat shows them.

## Contract

### Primitive on `ConvStore`

```ts
class ConvStore {
  // ... existing methods ...
  deleteStale(beforeMs: number): string[];
}
```

- Deletes every row where `last_used_at < beforeMs` (strict).
- Returns the deleted `convKey`s in ascending `last_used_at` order,
  so the oldest dropped key is first in the list.
- Atomic with respect to other store operations (relies on SQLite's
  default single-writer behavior).

### Sweeper

```ts
function startIdleSweeper(opts: {
  store: ConvStore;
  ttlMs: number;        // rows untouched for this long become stale
  intervalMs: number;   // how often to scan
  now?: () => number;   // injected clock for testability; defaults to Date.now
  log?: {
    info: (obj: object, msg: string) => void;
    warn?: (obj: object, msg: string) => void;
  };
}): {
  stop: () => void;
  sweepNow: () => string[];
};
```

- `sweepNow()` runs one sweep synchronously and returns the deleted
  keys. Useful for tests and manual ops.
- `stop()` cancels the periodic timer; idempotent.
- The interval timer is `.unref()`'d so it does not keep the process
  alive on its own. A clean shutdown path elsewhere is responsible
  for calling `stop()` for symmetry.

## Behavior

### `ConvStore.deleteStale`

| # | Scenario | Expected |
|---|----------|----------|
| S1 | store is empty | returns `[]`; no rows changed |
| S2 | all rows are fresh (`last_used_at >= beforeMs`) | returns `[]`; all rows remain |
| S3 | all rows are stale | returns every convKey, ascending by `last_used_at`; table is empty after |
| S4 | mix of fresh and stale rows | returns only stale convKeys; fresh rows remain untouched |
| S5 | boundary — row with `last_used_at === beforeMs` | NOT deleted (strict less-than) |
| S6 | multiple stale rows | returned in deterministic ascending-`last_used_at` order |

### `startIdleSweeper`

| # | Scenario | Expected |
|---|----------|----------|
| W1 | `sweepNow()` on empty store | returns `[]`; logs zero-delete at debug-equivalent |
| W2 | `sweepNow()` with controlled `now` and prefilled store | deletes rows where `last_used_at < now() - ttlMs`; returns those convKeys |
| W3 | timer fires after `intervalMs` | sweepNow-equivalent runs without manual invocation |
| W4 | `stop()` cancels the timer; further ticks do not sweep | true after stop |
| W5 | calling `stop()` twice | idempotent; no error |
| W6 | timer does not keep the event loop alive | process can exit without explicit `stop()` (handle is unref'd) |

The behavior tests use Node's built-in `mock.timers` for W3-W6 so we
don't actually wait for wall-clock minutes during tests.

## Operational defaults

Recommended `index.ts` wiring (set via env vars):

| Env var | Default | Notes |
|---|---|---|
| `ADAPTER_IDLE_TTL_HOURS` | `24` | Conservative for a single-user dev box; raise for production multi-user |
| `ADAPTER_SWEEPER_INTERVAL_MIN` | `30` | Half-hourly is enough — eviction is not time-critical |

Both are tuned to be obviously safe for Phase 1's single-host deploy.

## Edge cases discovered post-implementation

> Append-only. Each entry: date, what we found, what changed (if anything).

- **2026-05-17** — Smoke test against the running adapter (with
  `ADAPTER_IDLE_TTL_HOURS=0.001` and
  `ADAPTER_SWEEPER_INTERVAL_MIN=0.05`) confirmed end-to-end: a row
  with `last_used_at = 1` was deleted on the first tick (~3s after
  start); the next tick logged `"no stale mappings"`. No surprises;
  spec and behavior match. Production defaults (24h / 30min)
  re-applied after the test.

## Related

- **Implementation:** [`src/state/sweeper.ts`](./sweeper.ts)
- **Tests:** [`test/state/sweeper.test.ts`](../../test/state/sweeper.test.ts)
- **Primitive used:** [`src/state/conv-store.ts`](./conv-store.ts) → `deleteStale`
- **Wired into:** [`src/index.ts`](../index.ts) — adapter startup
- **Background:** [`docs/PHASE1.md`](../../../docs/PHASE1.md) — "Known TODOs deferred out of slice 2"
