// Spec: ../../src/workspaces/registry.spec.md
// Each `it()` below maps 1:1 to a row in the spec's Behavior table,
// in the same order. When you add a test, add the row first.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { loadWorkspaces } from "../../src/workspaces/registry.ts";
import type { WorkspaceManifest } from "../../src/workspaces/manifest.ts";

/**
 * Integration tests for loadWorkspaces().
 *
 * What's real here: the filesystem. Each test builds a fresh temp
 * directory tree under os.tmpdir() so manifests, sibling `repo/`
 * directories, and missing-target failures are exercised end-to-end.
 *
 * What's faked: nothing. This is the lightest test that proves the
 * loader's filesystem contract.
 *
 * Each test gets a fresh root via beforeEach / afterEach.
 */

function makeManifest(overrides: Partial<WorkspaceManifest> = {}): WorkspaceManifest {
  return {
    schema_version: 1,
    id: "test-workspace-v1",
    display_name: "Test Workspace",
    description: "Fixture workspace for tests.",
    owner: "test",
    workspace_dir: "./repo",
    cursor_model: "gpt-5.5-extra-high-fast",
    mode: "ask",
    ...overrides,
  };
}

async function writeWorkspace(
  workspacesDir: string,
  dirName: string,
  manifest: WorkspaceManifest,
  opts: { createRepo?: boolean; repoDirName?: string } = {},
): Promise<{ workspaceDir: string; repoDir: string; manifestPath: string }> {
  const { createRepo = true, repoDirName = "repo" } = opts;
  const workspaceDir = join(workspacesDir, dirName);
  await mkdir(workspaceDir, { recursive: true });
  const manifestPath = join(workspaceDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const repoDir = join(workspaceDir, repoDirName);
  if (createRepo) {
    await mkdir(repoDir, { recursive: true });
  }
  return { workspaceDir, repoDir, manifestPath };
}

describe("loadWorkspaces (filesystem-backed registry)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "registry-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // ---------- 1 ----------
  it("returns an empty array when workspacesDir has no entries", async () => {
    const workspaces = await loadWorkspaces(root);
    assert.deepEqual(workspaces, []);
  });

  // ---------- 2 ----------
  it("loads one workspace, resolves workspace_dir to an absolute path, and records manifest_path", async () => {
    const m = makeManifest({ id: "alpha-v1" });
    const { repoDir, manifestPath } = await writeWorkspace(root, "alpha", m);

    const workspaces = await loadWorkspaces(root);
    assert.equal(workspaces.length, 1);
    const [w] = workspaces;
    assert.equal(w.id, "alpha-v1");
    assert.equal(w.display_name, "Test Workspace");
    assert.equal(w.workspace_dir, "./repo");
    assert.ok(isAbsolute(w.workspace_dir_abs), "workspace_dir_abs must be absolute");
    assert.equal(w.workspace_dir_abs, repoDir, "workspace_dir_abs must resolve against the manifest's directory");
    assert.ok(isAbsolute(w.manifest_path), "manifest_path must be absolute");
    assert.equal(w.manifest_path, manifestPath);
  });

  // ---------- 3 ----------
  it("returns multiple workspaces sorted by id ascending, regardless of on-disk directory order", async () => {
    await writeWorkspace(root, "z-dir", makeManifest({ id: "charlie-v1" }));
    await writeWorkspace(root, "a-dir", makeManifest({ id: "alpha-v1" }));
    await writeWorkspace(root, "m-dir", makeManifest({ id: "bravo-v1" }));

    const workspaces = await loadWorkspaces(root);
    assert.deepEqual(
      workspaces.map((w) => w.id),
      ["alpha-v1", "bravo-v1", "charlie-v1"],
    );
  });

  // ---------- 4 ----------
  it("silently skips subdirectories that have no manifest.json", async () => {
    await writeWorkspace(root, "with-manifest", makeManifest({ id: "alpha-v1" }));
    // A bare subdir, no manifest.
    await mkdir(join(root, "wip-workspace"), { recursive: true });

    const workspaces = await loadWorkspaces(root);
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].id, "alpha-v1");
  });

  // ---------- 5 ----------
  it("skips loose (non-directory) entries directly under workspacesDir", async () => {
    await writeWorkspace(root, "real-workspace", makeManifest({ id: "alpha-v1" }));
    // A loose file at the workspaces/ root — must not be treated as a workspace.
    await writeFile(join(root, "README.md"), "# notes\n", "utf8");

    const workspaces = await loadWorkspaces(root);
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].id, "alpha-v1");
  });

  // ---------- 6 ----------
  it("throws with the workspace id in the message when workspace_dir does not exist", async () => {
    const m = makeManifest({ id: "broken-v1", workspace_dir: "./does-not-exist" });
    // Write manifest but do NOT create ./does-not-exist sibling.
    await writeWorkspace(root, "broken", m, { createRepo: false });

    await assert.rejects(
      () => loadWorkspaces(root),
      (err: unknown) => {
        assert.ok(err instanceof Error, "expected an Error");
        assert.match(err.message, /broken-v1/, "error must mention the offending workspace id");
        assert.match(err.message, /workspace_dir/, "error must mention workspace_dir");
        return true;
      },
    );
  });

  // ---------- 7 ----------
  it("throws when a manifest.json is not valid JSON (current behavior: raw SyntaxError)", async () => {
    const workspaceDir = join(root, "garbled");
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, "manifest.json"), "{ not valid json", "utf8");

    await assert.rejects(
      () => loadWorkspaces(root),
      (err: unknown) => {
        // Documents current behavior: JSON.parse throws SyntaxError
        // unwrapped. Spec.md "Edge cases" flags this as a known
        // rough edge for a future improvement.
        assert.ok(err instanceof SyntaxError, "expected a SyntaxError from JSON.parse");
        return true;
      },
    );
  });
});
