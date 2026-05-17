import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Ensure a real `rg` binary is on PATH before any Cursor SDK call. The
 * SDK's local executor uses `which rg` at startup and crashes with
 * "Ripgrep path not configured" when nothing resolves. The shell
 * function shipped by Claude Code does NOT count as a binary, so we
 * actively look for the bundled rg that ships with the Cursor agent
 * CLI install and prepend its directory to PATH.
 *
 * Idempotent — safe to call multiple times.
 */
export function ensureRipgrepOnPath(): { rgDir: string | null } {
  const versionsDir = join(homedir(), ".local", "share", "cursor-agent", "versions");

  if (!existsSync(versionsDir)) return { rgDir: null };

  const entries = readdirSync(versionsDir)
    .map((name) => ({ name, path: join(versionsDir, name) }))
    .filter((e) => existsSync(join(e.path, "rg")))
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);

  if (entries.length === 0) return { rgDir: null };

  const rgDir = entries[0].path;
  const cur = process.env.PATH ?? "";
  if (!cur.split(":").includes(rgDir)) {
    process.env.PATH = `${rgDir}:${cur}`;
  }
  return { rgDir };
}
