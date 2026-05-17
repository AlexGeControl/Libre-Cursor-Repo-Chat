export interface SkillManifest {
  schema_version: 1;
  id: string;
  display_name: string;
  description: string;
  owner: string;
  workspace_dir: string;
  cursor_model: string;
  mode: "ask" | "agent";
}

export interface Skill extends SkillManifest {
  workspace_dir_abs: string;
  manifest_path: string;
}
