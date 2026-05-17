import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Skill, SkillManifest } from "./manifest.ts";

export async function loadSkills(workspacesDir: string): Promise<Skill[]> {
  const entries = await readdir(workspacesDir, { withFileTypes: true });
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(workspacesDir, entry.name, "manifest.json");

    const raw = await readFile(manifestPath, "utf8").catch(() => null);
    if (raw === null) continue;

    const m = JSON.parse(raw) as SkillManifest;
    const workspaceDirAbs = resolve(dirname(manifestPath), m.workspace_dir);
    const st = await stat(workspaceDirAbs).catch(() => null);
    if (!st?.isDirectory()) {
      throw new Error(
        `skill "${m.id}": workspace_dir does not exist or is not a directory: ${workspaceDirAbs}`,
      );
    }

    skills.push({ ...m, workspace_dir_abs: workspaceDirAbs, manifest_path: manifestPath });
  }

  skills.sort((a, b) => a.id.localeCompare(b.id));
  return skills;
}
