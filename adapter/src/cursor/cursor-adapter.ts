import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Agent } from "@cursor/sdk";
import type { McpServerConfig, SDKAgent } from "@cursor/sdk";
import type { Skill } from "../skills/manifest.ts";

/**
 * Boundary between the route handler and the Cursor SDK. Production
 * uses `sdkCursorAdapter` (a thin wrapper over `Agent.create` /
 * `Agent.resume`). Tests substitute a `FakeCursor` from
 * `test/support/fake-cursor.ts`, which exposes the same surface
 * without touching the network.
 *
 * Keeping this interface narrow on purpose — anything more the
 * handler needs from the SDK should be added here, not pulled in
 * via a separate import in the route.
 */
export interface CreateArgs {
  skill: Skill;
  /** Used as the agent's display name on Cursor's side for traceability. */
  convKey: string;
}

export interface ResumeArgs {
  skill: Skill;
}

export interface CursorAdapter {
  create(args: CreateArgs): Promise<SDKAgent>;
  resume(agentId: string, args: ResumeArgs): Promise<SDKAgent>;
}

// `settingSources: ["project"]` is what makes the workspace's
// .cursor/rules and .cursor/skills actually load. Without it the SDK
// boots a bare local agent that ignores those configs — silently
// breaking rules and skills. Discovered while bringing up the
// context-mgmt-eval-v1 evals; see
// workspaces/context-mgmt-eval-v1/eval.spec.md for the post-mortem.
const SETTING_SOURCES = ["project"] as const;

/**
 * `settingSources: ["project"]` does NOT also load `.cursor/mcp.json`
 * — that file has to be parsed and passed via `mcpServers` explicitly.
 * Plus the SDK doesn't expand `${ENV_VAR}` placeholders in MCP config
 * values, so we do that here against `process.env` before handing off.
 *
 * The expansion uses the same `${NAME}` syntax `.cursor/mcp.json`
 * already uses (per the O'Reilly integration guide). Unresolved
 * placeholders are left as literal strings so a misconfigured token
 * surfaces as a 401 from the MCP server instead of a silent skip.
 */
function loadMcpServers(workspaceDir: string): Record<string, McpServerConfig> | undefined {
  const mcpPath = join(workspaceDir, ".cursor", "mcp.json");
  if (!existsSync(mcpPath)) return undefined;
  const raw = readFileSync(mcpPath, "utf8");
  const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
  if (!parsed.mcpServers || Object.keys(parsed.mcpServers).length === 0) return undefined;
  return expandEnv(parsed.mcpServers) as Record<string, McpServerConfig>;
}

function expandEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (whole, name: string) => {
      const v = process.env[name];
      return v !== undefined ? v : whole;
    });
  }
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandEnv(v);
    return out;
  }
  return value;
}

export const sdkCursorAdapter: CursorAdapter = {
  async create({ skill, convKey }) {
    const mcpServers = loadMcpServers(skill.workspace_dir_abs);
    return await Agent.create({
      apiKey: process.env.CURSOR_API_KEY,
      name: `${skill.id} ${convKey}`,
      model: { id: skill.cursor_model },
      local: {
        cwd: skill.workspace_dir_abs,
        settingSources: [...SETTING_SOURCES],
      },
      ...(mcpServers ? { mcpServers } : {}),
    });
  },

  async resume(agentId, { skill }) {
    const mcpServers = loadMcpServers(skill.workspace_dir_abs);
    return await Agent.resume(agentId, {
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: skill.cursor_model },
      local: {
        cwd: skill.workspace_dir_abs,
        settingSources: [...SETTING_SOURCES],
      },
      ...(mcpServers ? { mcpServers } : {}),
    });
  },
};
