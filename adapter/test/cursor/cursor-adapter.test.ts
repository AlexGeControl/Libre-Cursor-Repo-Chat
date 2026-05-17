// Spec: ../../src/cursor/cursor-adapter.spec.md
// Each `it()` below maps 1:1 to a row in the spec's Behavior tables,
// in the same order. When you add a test, add the row first.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadMcpServers,
  expandEnv,
} from "../../src/cursor/cursor-adapter.ts";

/** Allocate a throwaway workspace dir; caller writes `.cursor/mcp.json` into it as needed. */
function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "cursor-adapter-test-"));
}

function writeMcpJson(workspaceDir: string, body: string): void {
  const cursorDir = join(workspaceDir, ".cursor");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, "mcp.json"), body, "utf8");
}

describe("loadMcpServers", () => {
  it("returns undefined when .cursor/mcp.json does not exist", (t) => {
    const ws = makeWorkspace();
    t.after(() => rmSync(ws, { recursive: true, force: true }));

    assert.equal(loadMcpServers(ws), undefined);
  });

  it("returns undefined when the file exists but has no mcpServers key", (t) => {
    const ws = makeWorkspace();
    t.after(() => rmSync(ws, { recursive: true, force: true }));
    writeMcpJson(ws, JSON.stringify({ somethingElse: { foo: "bar" } }));

    assert.equal(loadMcpServers(ws), undefined);
  });

  it("returns undefined when mcpServers is the empty object", (t) => {
    const ws = makeWorkspace();
    t.after(() => rmSync(ws, { recursive: true, force: true }));
    writeMcpJson(ws, JSON.stringify({ mcpServers: {} }));

    assert.equal(loadMcpServers(ws), undefined);
  });

  it("returns the parsed mcpServers object when present and non-empty (no placeholders)", (t) => {
    const ws = makeWorkspace();
    t.after(() => rmSync(ws, { recursive: true, force: true }));
    const config = {
      mcpServers: {
        oreilly: {
          url: "https://learning.oreilly.com/mcp",
          headers: { Authorization: "Bearer static-token" },
        },
      },
    };
    writeMcpJson(ws, JSON.stringify(config));

    const out = loadMcpServers(ws);
    assert.deepEqual(out, config.mcpServers);
  });

  it("expands ${ENV_VAR} placeholders in server values when loading", (t) => {
    const ws = makeWorkspace();
    const prev = process.env.OREILLY_MCP_TOKEN;
    process.env.OREILLY_MCP_TOKEN = "tok-abc123";
    t.after(() => {
      rmSync(ws, { recursive: true, force: true });
      if (prev === undefined) delete process.env.OREILLY_MCP_TOKEN;
      else process.env.OREILLY_MCP_TOKEN = prev;
    });

    writeMcpJson(
      ws,
      JSON.stringify({
        mcpServers: {
          oreilly: {
            url: "https://learning.oreilly.com/mcp",
            headers: { Authorization: "Bearer ${OREILLY_MCP_TOKEN}" },
          },
        },
      }),
    );

    const out = loadMcpServers(ws) as Record<string, any>;
    assert.equal(out.oreilly.headers.Authorization, "Bearer tok-abc123");
  });

  it("throws when .cursor/mcp.json exists but is not valid JSON (intentional — fail loudly)", (t) => {
    const ws = makeWorkspace();
    t.after(() => rmSync(ws, { recursive: true, force: true }));
    writeMcpJson(ws, "{ this is not json");

    assert.throws(() => loadMcpServers(ws), /JSON|Unexpected/i);
  });
});

describe("expandEnv", () => {
  it("returns a literal string with no placeholder unchanged", () => {
    assert.equal(expandEnv("plain string, nothing to expand"), "plain string, nothing to expand");
  });

  it("replaces ${KNOWN_VAR} with the env value", (t) => {
    const prev = process.env.CURSOR_ADAPTER_TEST_TOKEN;
    process.env.CURSOR_ADAPTER_TEST_TOKEN = "value-xyz";
    t.after(() => {
      if (prev === undefined) delete process.env.CURSOR_ADAPTER_TEST_TOKEN;
      else process.env.CURSOR_ADAPTER_TEST_TOKEN = prev;
    });

    assert.equal(
      expandEnv("Bearer ${CURSOR_ADAPTER_TEST_TOKEN}"),
      "Bearer value-xyz",
    );
  });

  it("leaves ${UNKNOWN_VAR} as a literal when the env var is unset (surfaces as 401 downstream)", (t) => {
    const prev = process.env.CURSOR_ADAPTER_NEVER_SET;
    delete process.env.CURSOR_ADAPTER_NEVER_SET;
    t.after(() => {
      if (prev !== undefined) process.env.CURSOR_ADAPTER_NEVER_SET = prev;
    });

    assert.equal(
      expandEnv("Bearer ${CURSOR_ADAPTER_NEVER_SET}"),
      "Bearer ${CURSOR_ADAPTER_NEVER_SET}",
    );
  });

  it("substitutes multiple placeholders in a single string independently", (t) => {
    const prevA = process.env.CURSOR_ADAPTER_A;
    const prevB = process.env.CURSOR_ADAPTER_B;
    process.env.CURSOR_ADAPTER_A = "aaa";
    process.env.CURSOR_ADAPTER_B = "bbb";
    t.after(() => {
      if (prevA === undefined) delete process.env.CURSOR_ADAPTER_A;
      else process.env.CURSOR_ADAPTER_A = prevA;
      if (prevB === undefined) delete process.env.CURSOR_ADAPTER_B;
      else process.env.CURSOR_ADAPTER_B = prevB;
    });

    assert.equal(
      expandEnv("${CURSOR_ADAPTER_A}-mid-${CURSOR_ADAPTER_B}"),
      "aaa-mid-bbb",
    );
  });

  it("recurses through nested object > array > object > string", (t) => {
    const prev = process.env.CURSOR_ADAPTER_DEEP;
    process.env.CURSOR_ADAPTER_DEEP = "deep-val";
    t.after(() => {
      if (prev === undefined) delete process.env.CURSOR_ADAPTER_DEEP;
      else process.env.CURSOR_ADAPTER_DEEP = prev;
    });

    const input = {
      outer: {
        list: [
          { token: "Bearer ${CURSOR_ADAPTER_DEEP}", note: "stays" },
          "raw ${CURSOR_ADAPTER_DEEP} too",
        ],
      },
    };
    const out = expandEnv(input) as typeof input;

    const first = out.outer.list[0] as { token: string; note: string };
    assert.equal(first.token, "Bearer deep-val");
    assert.equal(first.note, "stays");
    assert.equal(out.outer.list[1], "raw deep-val too");
  });

  it("passes non-string primitives (number, boolean, null) through unchanged", () => {
    assert.equal(expandEnv(42), 42);
    assert.equal(expandEnv(0), 0);
    assert.equal(expandEnv(true), true);
    assert.equal(expandEnv(false), false);
    assert.equal(expandEnv(null), null);
    assert.equal(expandEnv(undefined), undefined);
  });

  it("does NOT expand lowercase placeholders — regex requires [A-Z_][A-Z0-9_]*", (t) => {
    // Set both forms; only the uppercase one should be expanded.
    const prevLower = (process.env as Record<string, string | undefined>).lowercase;
    const prevUpper = process.env.UPPERCASE;
    (process.env as Record<string, string | undefined>).lowercase = "should-not-appear";
    process.env.UPPERCASE = "expanded";
    t.after(() => {
      if (prevLower === undefined) delete (process.env as Record<string, string | undefined>).lowercase;
      else (process.env as Record<string, string | undefined>).lowercase = prevLower;
      if (prevUpper === undefined) delete process.env.UPPERCASE;
      else process.env.UPPERCASE = prevUpper;
    });

    assert.equal(expandEnv("${lowercase}"), "${lowercase}");
    assert.equal(expandEnv("${UPPERCASE}"), "expanded");
    // A leading-digit name is also rejected by the regex.
    assert.equal(expandEnv("${1BAD}"), "${1BAD}");
  });
});
