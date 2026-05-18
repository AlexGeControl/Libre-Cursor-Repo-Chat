import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Workspace, WorkspaceManifest } from "./manifest.ts";

export async function loadWorkspaces(workspacesDir: string): Promise<Workspace[]> {
  const entries = await readdir(workspacesDir, { withFileTypes: true });
  const workspaces: Workspace[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(workspacesDir, entry.name, "manifest.json");

    const raw = await readFile(manifestPath, "utf8").catch(() => null);
    if (raw === null) continue;

    const m = JSON.parse(raw) as WorkspaceManifest;
    const workspaceDirAbs = resolve(dirname(manifestPath), m.workspace_dir);
    const st = await stat(workspaceDirAbs).catch(() => null);
    if (!st?.isDirectory()) {
      throw new Error(
        `workspace "${m.id}": workspace_dir does not exist or is not a directory: ${workspaceDirAbs}`,
      );
    }

    workspaces.push({ ...m, workspace_dir_abs: workspaceDirAbs, manifest_path: manifestPath });
  }

  workspaces.sort((a, b) => a.id.localeCompare(b.id));
  return workspaces;
}
