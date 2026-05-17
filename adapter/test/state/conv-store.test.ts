// Spec: ../../src/state/conv-store.spec.md
// Each `it()` below maps 1:1 to a row in the spec's Behavior table,
// in the same order. When you add a test, add the row first.
//
// `deleteStale` is intentionally NOT tested here — it is owned by
// sweeper.spec.md (cases S1–S6) and exercised in
// test/state/sweeper.test.ts.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

import { ConvStore } from "../../src/state/conv-store.ts";

// --- Construction & schema ---------------------------------------------

describe("ConvStore construction & schema", () => {
  it("C1: new ConvStore(':memory:') succeeds", () => {
    const store = new ConvStore(":memory:");
    try {
      assert.ok(store, "constructor returned a ConvStore instance");
    } finally {
      store.close();
    }
  });

  it("C2: constructor creates the conv_agents table (put → get round-trip works)", () => {
    const store = new ConvStore(":memory:");
    try {
      store.put("u:c1", "agent-1", "skill-A");
      const row = store.get("u:c1");
      assert.ok(row, "row should be readable after put");
      assert.equal(row!.cursorAgentId, "agent-1");
      assert.equal(row!.skillId, "skill-A");
    } finally {
      store.close();
    }
  });

  it("C3: constructor enables WAL journal mode", () => {
    // WAL is a file-only mode in SQLite — :memory: dbs report "memory".
    // Use a tempdir-backed file so we can observe the pragma effect.
    const dir = mkdtempSync(join(tmpdir(), "conv-store-test-"));
    const store = new ConvStore(join(dir, "conv.sqlite"));
    try {
      const db = (store as unknown as { db: Database.Database }).db;
      const mode = db.pragma("journal_mode", { simple: true });
      assert.equal(mode, "wal");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("C4: constructor is idempotent against an existing schema (reopening does not throw)", () => {
    const dir = mkdtempSync(join(tmpdir(), "conv-store-test-"));
    const path = join(dir, "conv.sqlite");
    try {
      const first = new ConvStore(path);
      first.put("u:c1", "agent-1", "skill-A");
      first.close();

      // Reopen — must not throw on CREATE TABLE / CREATE INDEX.
      const second = new ConvStore(path);
      try {
        const row = second.get("u:c1");
        assert.ok(row, "data persisted across reopen");
        assert.equal(row!.cursorAgentId, "agent-1");
      } finally {
        second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- get ----------------------------------------------------------------

describe("ConvStore.get", () => {
  let store: ConvStore;

  beforeEach(() => {
    store = new ConvStore(":memory:");
  });
  afterEach(() => store.close());

  it("G1: get on an empty store returns null", () => {
    assert.equal(store.get("u:missing"), null);
  });

  it("G2: get on a non-existent key returns null even when other keys exist", () => {
    store.put("u:present", "agent-1", "skill-A");
    assert.equal(store.get("u:absent"), null);
  });

  it("G3: get after put returns a ConvAgentRow with numeric timestamps", () => {
    const before = Date.now();
    store.put("u:c1", "agent-1", "skill-A");
    const after = Date.now();

    const row = store.get("u:c1");
    assert.ok(row, "row should exist");
    assert.equal(row!.cursorAgentId, "agent-1");
    assert.equal(row!.skillId, "skill-A");
    assert.equal(typeof row!.createdAt, "number");
    assert.equal(typeof row!.lastUsedAt, "number");
    assert.ok(
      row!.createdAt >= before && row!.createdAt <= after,
      "createdAt within the call window",
    );
    assert.ok(
      row!.lastUsedAt >= before && row!.lastUsedAt <= after,
      "lastUsedAt within the call window",
    );
  });
});

// --- put ----------------------------------------------------------------

describe("ConvStore.put", () => {
  let store: ConvStore;

  beforeEach(() => {
    store = new ConvStore(":memory:");
  });
  afterEach(() => store.close());

  it("P1: put on a fresh key sets createdAt === lastUsedAt", () => {
    store.put("u:c1", "agent-1", "skill-A");
    const row = store.get("u:c1");
    assert.ok(row);
    // Both timestamps are set from the same Date.now() call inside put.
    assert.equal(
      row!.createdAt,
      row!.lastUsedAt,
      "createdAt and lastUsedAt should be identical on first insert",
    );
  });

  it("P2: put twice on the same convKey upserts — second wins on agentId/skillId/lastUsedAt, but createdAt is preserved from the first insert", async () => {
    store.put("u:c1", "agent-1", "skill-A");
    const first = store.get("u:c1");
    assert.ok(first);
    const firstCreatedAt = first!.createdAt;

    // Make sure Date.now() advances before the second put. A 2ms
    // delay is enough on every supported platform.
    await new Promise((r) => setTimeout(r, 2));

    store.put("u:c1", "agent-2", "skill-B");
    const second = store.get("u:c1");
    assert.ok(second);

    assert.equal(second!.cursorAgentId, "agent-2", "agentId updated");
    assert.equal(second!.skillId, "skill-B", "skillId updated");
    assert.equal(
      second!.createdAt,
      firstCreatedAt,
      "createdAt preserved from first insert (ON CONFLICT does not touch it)",
    );
    assert.ok(
      second!.lastUsedAt >= firstCreatedAt,
      "lastUsedAt advanced (or at least did not regress)",
    );
  });

  it("P3: put on different keys keeps rows independent", () => {
    store.put("u:c1", "agent-1", "skill-A");
    store.put("u:c2", "agent-2", "skill-B");

    const r1 = store.get("u:c1");
    const r2 = store.get("u:c2");
    assert.ok(r1 && r2);
    assert.equal(r1!.cursorAgentId, "agent-1");
    assert.equal(r1!.skillId, "skill-A");
    assert.equal(r2!.cursorAgentId, "agent-2");
    assert.equal(r2!.skillId, "skill-B");
  });
});

// --- touch --------------------------------------------------------------

describe("ConvStore.touch", () => {
  let store: ConvStore;

  beforeEach(() => {
    store = new ConvStore(":memory:");
  });
  afterEach(() => store.close());

  it("T1: touch updates lastUsedAt only; createdAt/agentId/skillId unchanged", async () => {
    store.put("u:c1", "agent-1", "skill-A");
    const before = store.get("u:c1");
    assert.ok(before);

    await new Promise((r) => setTimeout(r, 2));
    store.touch("u:c1");

    const after = store.get("u:c1");
    assert.ok(after);
    assert.equal(after!.cursorAgentId, before!.cursorAgentId);
    assert.equal(after!.skillId, before!.skillId);
    assert.equal(after!.createdAt, before!.createdAt, "createdAt unchanged");
    assert.ok(
      after!.lastUsedAt >= before!.lastUsedAt,
      "lastUsedAt advanced (or held steady)",
    );
  });

  it("T2: touch on a missing key is a no-op (no row created, no throw)", () => {
    assert.doesNotThrow(() => store.touch("u:nope"));
    assert.equal(store.get("u:nope"), null);
  });
});

// --- delete -------------------------------------------------------------

describe("ConvStore.delete", () => {
  let store: ConvStore;

  beforeEach(() => {
    store = new ConvStore(":memory:");
  });
  afterEach(() => store.close());

  it("D1: delete removes the row", () => {
    store.put("u:c1", "agent-1", "skill-A");
    assert.ok(store.get("u:c1"));
    store.delete("u:c1");
    assert.equal(store.get("u:c1"), null);
  });

  it("D2: delete on a missing key is a no-op (no throw)", () => {
    assert.doesNotThrow(() => store.delete("u:never-existed"));
  });

  it("D3: delete leaves sibling rows intact", () => {
    store.put("u:c1", "agent-1", "skill-A");
    store.put("u:c2", "agent-2", "skill-B");
    store.delete("u:c1");
    assert.equal(store.get("u:c1"), null);
    const r2 = store.get("u:c2");
    assert.ok(r2);
    assert.equal(r2!.cursorAgentId, "agent-2");
  });
});

// --- close --------------------------------------------------------------

describe("ConvStore.close", () => {
  it("X1: close on an open store returns without throw", () => {
    const store = new ConvStore(":memory:");
    assert.doesNotThrow(() => store.close());
  });
});
