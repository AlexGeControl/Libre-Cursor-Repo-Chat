import type { Workspace } from "../../src/workspaces/manifest.ts";

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    schema_version: 1,
    id: "test-workspace-v1",
    display_name: "Test Workspace",
    description: "Fixture workspace for tests.",
    owner: "test",
    workspace_dir: "./repo",
    cursor_model: "gpt-5.5-extra-high-fast",
    mode: "ask",
    workspace_dir_abs: "/tmp/test-workspace",
    manifest_path: "/tmp/test-workspace/manifest.json",
    ...overrides,
  };
}

export interface FakeChatMessage {
  role: string;
  content: string | Array<{ type?: string; text?: string }>;
}

export function userMsg(content: string): FakeChatMessage {
  return { role: "user", content };
}

export function assistantMsg(content: string): FakeChatMessage {
  return { role: "assistant", content };
}

export function systemMsg(content: string): FakeChatMessage {
  return { role: "system", content };
}
