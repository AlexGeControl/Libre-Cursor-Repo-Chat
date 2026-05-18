// Spec: ../../src/routes/models.spec.md
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";

import { models } from "../../src/routes/models.ts";
import { makeWorkspace } from "../support/fixtures.ts";

/**
 * Integration tests for GET /v1/models.
 *
 * What's real here: the Fastify route registration, the JSON response
 * serialization, and the projection from Workspace[] to the OpenAI model
 * list envelope.
 *
 * Nothing is faked — the route has no external dependencies. Each
 * test builds its own Fastify app and closes it via t.after so no
 * state leaks between cases.
 */

async function buildApp(workspaces: ReturnType<typeof makeWorkspace>[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(models, { workspaces });
  return app;
}

describe("GET /v1/models", () => {
  // ---------- 1 ----------
  it("1: empty workspaces array → 200 with envelope { object: 'list', data: [] }", async (t) => {
    const app = await buildApp([]);
    t.after(() => app.close());

    const resp = await app.inject({ method: "GET", url: "/v1/models" });

    assert.equal(resp.statusCode, 200);
    assert.deepEqual(resp.json(), { object: "list", data: [] });
  });

  // ---------- 2 ----------
  it("2: one workspace → exact OpenAI model-item field shape", async (t) => {
    const workspace = makeWorkspace({
      id: "hw-test-gen-v1",
      display_name: "HW Test Gen",
      description: "Generates SystemVerilog stimuli.",
    });
    const app = await buildApp([workspace]);
    t.after(() => app.close());

    const resp = await app.inject({ method: "GET", url: "/v1/models" });

    assert.equal(resp.statusCode, 200);
    assert.deepEqual(resp.json(), {
      object: "list",
      data: [
        {
          id: "hw-test-gen-v1",
          object: "model",
          created: 0,
          owned_by: "cursor-as-a-service",
          display_name: "HW Test Gen",
          description: "Generates SystemVerilog stimuli.",
        },
      ],
    });
  });

  // ---------- 3 ----------
  it("3: multiple workspaces → caller-given order is preserved verbatim (route does not re-sort)", async (t) => {
    // Intentionally not alphabetical to prove the route does not sort.
    const workspaces = [
      makeWorkspace({ id: "zeta-v1", display_name: "Zeta", description: "z" }),
      makeWorkspace({ id: "alpha-v1", display_name: "Alpha", description: "a" }),
      makeWorkspace({ id: "mike-v1", display_name: "Mike", description: "m" }),
    ];
    const app = await buildApp(workspaces);
    t.after(() => app.close());

    const resp = await app.inject({ method: "GET", url: "/v1/models" });

    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { object: string; data: Array<{ id: string }> };
    assert.equal(body.object, "list");
    assert.equal(body.data.length, 3);
    assert.deepEqual(
      body.data.map((m) => m.id),
      ["zeta-v1", "alpha-v1", "mike-v1"],
      "order must match input array exactly",
    );
  });

  // ---------- 4 ----------
  it("4: Content-Type is application/json", async (t) => {
    const app = await buildApp([makeWorkspace()]);
    t.after(() => app.close());

    const resp = await app.inject({ method: "GET", url: "/v1/models" });

    assert.equal(resp.statusCode, 200);
    const contentType = resp.headers["content-type"];
    assert.ok(typeof contentType === "string", "content-type header must be set");
    assert.match(contentType, /^application\/json/);
  });

  // ---------- 5 ----------
  it("5: only contract fields are projected; Workspace-internal fields do not leak", async (t) => {
    // makeWorkspace() includes workspace_dir, workspace_dir_abs, manifest_path,
    // cursor_model, owner, mode, schema_version — none of these should
    // surface in the OpenAI response.
    const workspace = makeWorkspace({
      id: "secret-paths-v1",
      display_name: "Paths Test",
      description: "Verifies field projection.",
      workspace_dir_abs: "/private/should/not/leak",
      manifest_path: "/private/should/not/leak/manifest.json",
      owner: "internal-team",
    });
    const app = await buildApp([workspace]);
    t.after(() => app.close());

    const resp = await app.inject({ method: "GET", url: "/v1/models" });

    assert.equal(resp.statusCode, 200);
    const body = resp.json() as { data: Array<Record<string, unknown>> };
    const item = body.data[0];
    assert.deepEqual(
      Object.keys(item).sort(),
      ["created", "description", "display_name", "id", "object", "owned_by"],
      "exactly the six contract keys, nothing more",
    );
    // Sanity: leaky values are absent.
    for (const key of ["workspace_dir", "workspace_dir_abs", "manifest_path", "owner", "cursor_model", "mode", "schema_version"]) {
      assert.equal(item[key], undefined, `field ${key} must not be projected`);
    }
  });
});
