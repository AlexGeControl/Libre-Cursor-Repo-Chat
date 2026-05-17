// Spec: ../../src/cursor/runtime.spec.md
// Each `it()` below maps 1:1 to a row in the spec's Behavior table,
// in the same order. When you add a test, add the row first.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { ensureRipgrepOnPath } from "../../src/cursor/runtime.ts";

// We override $HOME so homedir() points at a private fixture tree.
// On Linux, node:os homedir() honors $HOME — test #1 asserts this so
// a future Node change breaks loudly here, not silently elsewhere.
let fakeHome: string;
let savedHome: string | undefined;
let savedPath: string | undefined;

function versionsRoot(): string {
  return join(fakeHome, ".local", "share", "cursor-agent", "versions");
}

function makeVersionDir(name: string, opts: { withRg: boolean; mtime?: Date }): string {
  const dir = join(versionsRoot(), name);
  mkdirSync(dir, { recursive: true });
  if (opts.withRg) {
    const rgPath = join(dir, "rg");
    writeFileSync(rgPath, "#!/bin/sh\nexit 0\n");
    if (opts.mtime) {
      utimesSync(rgPath, opts.mtime, opts.mtime);
      utimesSync(dir, opts.mtime, opts.mtime);
    }
  }
  if (opts.mtime) {
    utimesSync(dir, opts.mtime, opts.mtime);
  }
  return dir;
}

beforeEach(() => {
  savedHome = process.env.HOME;
  savedPath = process.env.PATH;
  fakeHome = mkdtempSync(join(tmpdir(), "runtime-test-"));
  process.env.HOME = fakeHome;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("ensureRipgrepOnPath", () => {
  it("sanity: node:os homedir() honors $HOME on this platform (approach A precondition)", () => {
    assert.equal(
      homedir(),
      fakeHome,
      "approach (A) requires homedir() to follow $HOME — if this fails on a future Node, switch to approach (B)",
    );
  });

  it("returns { rgDir: null } and leaves PATH unchanged when the versions dir does not exist", () => {
    const before = process.env.PATH;
    const result = ensureRipgrepOnPath();
    assert.deepEqual(result, { rgDir: null });
    assert.equal(process.env.PATH, before);
  });

  it("returns { rgDir: null } when the versions dir exists but is empty", () => {
    mkdirSync(versionsRoot(), { recursive: true });
    const before = process.env.PATH;
    const result = ensureRipgrepOnPath();
    assert.deepEqual(result, { rgDir: null });
    assert.equal(process.env.PATH, before);
  });

  it("returns { rgDir: null } when version subdirs exist but none contains an `rg` file", () => {
    makeVersionDir("0.1.0", { withRg: false });
    makeVersionDir("0.2.0", { withRg: false });
    const before = process.env.PATH;
    const result = ensureRipgrepOnPath();
    assert.deepEqual(result, { rgDir: null });
    assert.equal(process.env.PATH, before);
  });

  it("returns the version dir and prepends it to PATH when one version has an `rg` binary", () => {
    const dir = makeVersionDir("1.0.0", { withRg: true });
    process.env.PATH = "/usr/bin:/bin";
    const result = ensureRipgrepOnPath();
    assert.deepEqual(result, { rgDir: dir });
    assert.equal(process.env.PATH, `${dir}:/usr/bin:/bin`);
  });

  it("picks the version dir with the most recent mtime when multiple have an `rg`", () => {
    // Write the OLDER one first to prove ordering isn't filesystem-iteration order.
    const older = makeVersionDir("1.0.0", {
      withRg: true,
      mtime: new Date("2025-01-01T00:00:00Z"),
    });
    const newer = makeVersionDir("2.0.0", {
      withRg: true,
      mtime: new Date("2026-01-01T00:00:00Z"),
    });
    process.env.PATH = "/usr/bin";
    const result = ensureRipgrepOnPath();
    assert.equal(result.rgDir, newer);
    assert.notEqual(result.rgDir, older);
    assert.equal(process.env.PATH, `${newer}:/usr/bin`);
  });

  it("is idempotent — calling twice does not duplicate the PATH entry", () => {
    const dir = makeVersionDir("1.0.0", { withRg: true });
    process.env.PATH = "/usr/bin";
    ensureRipgrepOnPath();
    const afterFirst = process.env.PATH;
    ensureRipgrepOnPath();
    assert.equal(process.env.PATH, afterFirst);

    // And the dir should appear exactly once in PATH.
    const occurrences = (process.env.PATH ?? "")
      .split(":")
      .filter((p) => p === dir).length;
    assert.equal(occurrences, 1);
  });

  it("preserves existing PATH entries (only prepends)", () => {
    const dir = makeVersionDir("1.0.0", { withRg: true });
    process.env.PATH = "/usr/local/bin:/usr/bin:/bin";
    ensureRipgrepOnPath();
    assert.equal(process.env.PATH, `${dir}:/usr/local/bin:/usr/bin:/bin`);
  });
});
