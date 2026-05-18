import type { FastifyPluginAsync } from "fastify";
import type { Workspace } from "../workspaces/manifest.ts";

interface Options {
  workspaces: Workspace[];
}

export const models: FastifyPluginAsync<Options> = async (app, opts) => {
  app.get("/v1/models", async () => ({
    object: "list",
    data: opts.workspaces.map((w) => ({
      id: w.id,
      object: "model",
      created: 0,
      owned_by: "cursor-as-a-service",
      display_name: w.display_name,
      description: w.description,
    })),
  }));
};
