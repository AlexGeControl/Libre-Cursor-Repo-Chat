import type { FastifyPluginAsync } from "fastify";
import type { Skill } from "../skills/manifest.ts";

interface Options {
  skills: Skill[];
}

export const models: FastifyPluginAsync<Options> = async (app, opts) => {
  app.get("/v1/models", async () => ({
    object: "list",
    data: opts.skills.map((s) => ({
      id: s.id,
      object: "model",
      created: 0,
      owned_by: "cursor-as-a-service",
      display_name: s.display_name,
      description: s.description,
    })),
  }));
};
