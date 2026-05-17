// Spec: ../../src/state/sweeper.spec.md
// Each `it()` below maps 1:1 to a row in the spec's Behavior table,
// in the same order. When you add a test, add the row first.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { ConvStore } from "../../src/state/conv-store.ts";
import { startIdleSweeper } from "../../src/state/sweeper.ts";

// --- Test-only helpers --------------------------------------------------

function makeStore(): { store: ConvStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "sweeper-test-"));
  const store = new ConvStore(join(dir, "conv.sqlite"));
  return {
    store,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Insert a row with a specific last_used_at value by writing then
// touching with a controlled timestamp. Since ConvStore.put always
// sets last_used_at to Date.now(), we override via direct SQL after
// insert — this is test-only access; the production code never
// rewrites last_used_at directly.
function insertRowWithLastUsed(
  store: ConvStore,
  convKey: string,
  cursorAgentId: string,
  skillId: string,
  lastUsedAt: number,
): void {
  store.put(convKey, cursorAgentId, skillId);
  // Bracket access bypasses the `private` visibility check — test-only
  // backdoor to set a specific last_used_at. Production code never
  // mutates this column directly outside ConvStore's API.
  const db = (store as unknown as { db: import("better-sqlite3").Database }).db;
  db.prepare("UPDATE conv_agents SET last_used_at = ? WHERE conv_key = ?").run(
    lastUsedAt,
    convKey,
  );
}

// --- ConvStore.deleteStale (primitive) ----------------------------------

describe("ConvStore.deleteStale", () => {
  let store: ConvStore;
  let cleanup: () => void;

  beforeEach(() => {
    ({ store, cleanup } = makeStore());
  });
  afterEach(() => cleanup());

  it("S1: empty store → returns [] and changes nothing", () => {
    const result = store.deleteStale(Date.now());
    assert.deepEqual(result, []);
  });

  it("S2: all rows fresh → returns [], all rows remain", () => {
    const now = 10_000;
    insertRowWithLastUsed(store, "u:c1", "agent-1", "skill-A", now);
    insertRowWithLastUsed(store, "u:c2", "agent-2", "skill-A", now + 1);

    const result = store.deleteStale(now); // strict less-than → nothing
    assert.deepEqual(result, []);
    assert.ok(store.get("u:c1"));
    assert.ok(store.get("u:c2"));
  });

  it("S3: all rows stale → returns every key, table empty after", () => {
    insertRowWithLastUsed(store, "u:c1", "agent-1", "skill-A", 100);
    insertRowWithLastUsed(store, "u:c2", "agent-2", "skill-A", 200);

    const result = store.deleteStale(1_000);
    assert.deepEqual(result, ["u:c1", "u:c2"]); // ascending last_used_at
    assert.equal(store.get("u:c1"), null);
    assert.equal(store.get("u:c2"), null);
  });

  it("S4: mix → only stale convKeys deleted, fresh untouched", () => {
    insertRowWithLastUsed(store, "u:stale-old", "a-old", "skill-A", 100);
    insertRowWithLastUsed(store, "u:fresh-new", "a-new", "skill-A", 5_000);
    insertRowWithLastUsed(store, "u:stale-mid", "a-mid", "skill-A", 500);

    const result = store.deleteStale(1_000);
    assert.deepEqual(result, ["u:stale-old", "u:stale-mid"]);
    assert.equal(store.get("u:stale-old"), null);
    assert.equal(store.get("u:stale-mid"), null);
    assert.ok(store.get("u:fresh-new"));
  });

  it("S5: boundary — row with last_used_at === beforeMs is NOT deleted (strict less-than)", () => {
    insertRowWithLastUsed(store, "u:on-boundary", "agent-b", "skill-A", 1_000);
    const result = store.deleteStale(1_000);
    assert.deepEqual(result, []);
    assert.ok(store.get("u:on-boundary"));
  });

  it("S6: multiple stale rows returned in ascending last_used_at order", () => {
    insertRowWithLastUsed(store, "u:second", "agent-2", "skill-A", 200);
    insertRowWithLastUsed(store, "u:first", "agent-1", "skill-A", 100);
    insertRowWithLastUsed(store, "u:third", "agent-3", "skill-A", 300);

    const result = store.deleteStale(1_000);
    assert.deepEqual(result, ["u:first", "u:second", "u:third"]);
  });
});

// --- startIdleSweeper (orchestration) -----------------------------------

describe("startIdleSweeper", () => {
  let store: ConvStore;
  let cleanup: () => void;

  beforeEach(() => {
    ({ store, cleanup } = makeStore());
  });
  afterEach(() => {
    cleanup();
    mock.timers.reset();
  });

  it("W1: sweepNow on empty store → returns []", () => {
    const sweeper = startIdleSweeper({
      store,
      ttlMs: 60_000,
      intervalMs: 60_000,
      now: () => 1_000_000,
    });
    try {
      assert.deepEqual(sweeper.sweepNow(), []);
    } finally {
      sweeper.stop();
    }
  });

  it("W2: sweepNow with controlled now → deletes only rows older than now - ttlMs", () => {
    insertRowWithLastUsed(store, "u:old", "a-old", "skill-A", 500);
    insertRowWithLastUsed(store, "u:fresh", "a-fresh", "skill-A", 950);

    const sweeper = startIdleSweeper({
      store,
      ttlMs: 100,
      intervalMs: 60_000,
      now: () => 1_000, // beforeMs = 900
    });
    try {
      const deleted = sweeper.sweepNow();
      assert.deepEqual(deleted, ["u:old"]);
      assert.equal(store.get("u:old"), null);
      assert.ok(store.get("u:fresh"));
    } finally {
      sweeper.stop();
    }
  });

  it("W3: timer fires after intervalMs → sweep runs without manual invocation", () => {
    mock.timers.enable({ apis: ["setInterval"], now: 0 });
    insertRowWithLastUsed(store, "u:old", "a-old", "skill-A", -10_000);

    let currentNow = 0;
    const sweeper = startIdleSweeper({
      store,
      ttlMs: 100,
      intervalMs: 1_000,
      now: () => currentNow,
    });
    try {
      assert.ok(store.get("u:old"), "row still present before any tick");
      currentNow = 1_000;
      mock.timers.tick(1_000);
      assert.equal(store.get("u:old"), null, "row should be swept by the first tick");
    } finally {
      sweeper.stop();
    }
  });

  it("W4: stop() cancels the timer; subsequent ticks do not sweep", () => {
    mock.timers.enable({ apis: ["setInterval"], now: 0 });

    let sweepCount = 0;
    const sweeper = startIdleSweeper({
      store,
      ttlMs: 100,
      intervalMs: 1_000,
      now: () => 0,
      log: {
        info: () => {
          sweepCount++;
        },
      },
    });

    mock.timers.tick(1_000);
    const countBefore = sweepCount;

    sweeper.stop();
    mock.timers.tick(10_000);

    assert.equal(sweepCount, countBefore, "no further sweeps after stop()");
  });

  it("W5: stop() called twice is idempotent (no throw)", () => {
    const sweeper = startIdleSweeper({
      store,
      ttlMs: 100,
      intervalMs: 1_000,
      now: () => 0,
    });
    sweeper.stop();
    sweeper.stop(); // must not throw
  });

  it("W6: implementation calls unref() on the timer handle (so the event loop won't be kept alive)", () => {
    const originalSetInterval = globalThis.setInterval;
    let unrefCalled = false;

    globalThis.setInterval = ((
      handler: (...args: unknown[]) => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      const handle = originalSetInterval(handler, ms, ...rest);
      const originalUnref = handle.unref?.bind(handle);
      handle.unref = (): NodeJS.Timeout => {
        unrefCalled = true;
        return originalUnref ? originalUnref() : handle;
      };
      return handle;
    }) as typeof setInterval;

    let sweeper: ReturnType<typeof startIdleSweeper> | undefined;
    try {
      sweeper = startIdleSweeper({
        store,
        ttlMs: 100,
        intervalMs: 60_000,
        now: () => 0,
      });
      assert.ok(unrefCalled, "implementation must call .unref() on the interval handle");
    } finally {
      sweeper?.stop();
      globalThis.setInterval = originalSetInterval;
    }
  });
});
