export interface WorkspaceManifest {
  schema_version: 1;
  id: string;
  display_name: string;
  description: string;
  owner: string;
  workspace_dir: string;
  cursor_model: string;
  mode: "ask" | "agent";
}

export interface Workspace extends WorkspaceManifest {
  workspace_dir_abs: string;
  manifest_path: string;
}
