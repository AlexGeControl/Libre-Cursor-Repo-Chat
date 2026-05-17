// Spec: ../../src/skills/registry.spec.md
// Each `it()` below maps 1:1 to a row in the spec's Behavior table,
// in the same order. When you add a test, add the row first.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { loadSkills } from "../../src/skills/registry.ts";
import type { SkillManifest } from "../../src/skills/manifest.ts";

/**
 * Integration tests for loadSkills().
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

function makeManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    schema_version: 1,
    id: "test-skill-v1",
    display_name: "Test Skill",
    description: "Fixture skill for tests.",
    owner: "test",
    workspace_dir: "./repo",
    cursor_model: "gpt-5.5-extra-high-fast",
    mode: "ask",
    ...overrides,
  };
}

async function writeSkill(
  workspacesDir: string,
  dirName: string,
  manifest: SkillManifest,
  opts: { createRepo?: boolean; repoDirName?: string } = {},
): Promise<{ skillDir: string; repoDir: string; manifestPath: string }> {
  const { createRepo = true, repoDirName = "repo" } = opts;
  const skillDir = join(workspacesDir, dirName);
  await mkdir(skillDir, { recursive: true });
  const manifestPath = join(skillDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const repoDir = join(skillDir, repoDirName);
  if (createRepo) {
    await mkdir(repoDir, { recursive: true });
  }
  return { skillDir, repoDir, manifestPath };
}

describe("loadSkills (filesystem-backed registry)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "registry-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // ---------- 1 ----------
  it("returns an empty array when workspacesDir has no entries", async () => {
    const skills = await loadSkills(root);
    assert.deepEqual(skills, []);
  });

  // ---------- 2 ----------
  it("loads one skill, resolves workspace_dir to an absolute path, and records manifest_path", async () => {
    const m = makeManifest({ id: "alpha-v1" });
    const { repoDir, manifestPath } = await writeSkill(root, "alpha", m);

    const skills = await loadSkills(root);
    assert.equal(skills.length, 1);
    const [s] = skills;
    assert.equal(s.id, "alpha-v1");
    assert.equal(s.display_name, "Test Skill");
    assert.equal(s.workspace_dir, "./repo");
    assert.ok(isAbsolute(s.workspace_dir_abs), "workspace_dir_abs must be absolute");
    assert.equal(s.workspace_dir_abs, repoDir, "workspace_dir_abs must resolve against the manifest's directory");
    assert.ok(isAbsolute(s.manifest_path), "manifest_path must be absolute");
    assert.equal(s.manifest_path, manifestPath);
  });

  // ---------- 3 ----------
  it("returns multiple skills sorted by id ascending, regardless of on-disk directory order", async () => {
    await writeSkill(root, "z-dir", makeManifest({ id: "charlie-v1" }));
    await writeSkill(root, "a-dir", makeManifest({ id: "alpha-v1" }));
    await writeSkill(root, "m-dir", makeManifest({ id: "bravo-v1" }));

    const skills = await loadSkills(root);
    assert.deepEqual(
      skills.map((s) => s.id),
      ["alpha-v1", "bravo-v1", "charlie-v1"],
    );
  });

  // ---------- 4 ----------
  it("silently skips subdirectories that have no manifest.json", async () => {
    await writeSkill(root, "with-manifest", makeManifest({ id: "alpha-v1" }));
    // A bare subdir, no manifest.
    await mkdir(join(root, "wip-skill"), { recursive: true });

    const skills = await loadSkills(root);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, "alpha-v1");
  });

  // ---------- 5 ----------
  it("skips loose (non-directory) entries directly under workspacesDir", async () => {
    await writeSkill(root, "real-skill", makeManifest({ id: "alpha-v1" }));
    // A loose file at the workspaces/ root — must not be treated as a skill.
    await writeFile(join(root, "README.md"), "# notes\n", "utf8");

    const skills = await loadSkills(root);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, "alpha-v1");
  });

  // ---------- 6 ----------
  it("throws with the skill id in the message when workspace_dir does not exist", async () => {
    const m = makeManifest({ id: "broken-v1", workspace_dir: "./does-not-exist" });
    // Write manifest but do NOT create ./does-not-exist sibling.
    await writeSkill(root, "broken", m, { createRepo: false });

    await assert.rejects(
      () => loadSkills(root),
      (err: unknown) => {
        assert.ok(err instanceof Error, "expected an Error");
        assert.match(err.message, /broken-v1/, "error must mention the offending skill id");
        assert.match(err.message, /workspace_dir/, "error must mention workspace_dir");
        return true;
      },
    );
  });

  // ---------- 7 ----------
  it("throws when a manifest.json is not valid JSON (current behavior: raw SyntaxError)", async () => {
    const skillDir = join(root, "garbled");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "manifest.json"), "{ not valid json", "utf8");

    await assert.rejects(
      () => loadSkills(root),
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
