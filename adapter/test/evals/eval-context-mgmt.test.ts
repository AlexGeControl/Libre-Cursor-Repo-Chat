// Spec: ../../../workspaces/eval-context-mgmt-configured-v1/eval.spec.md
//
// IMPORTANT: marker literals MUST NOT appear in this file.
//
// Cursor agents can grep the enclosing project tree, so any marker
// hardcoded in test source leaks to the agent and produces false
// passes. Markers live in `.cursor/` files; this test reads those
// files at runtime to learn what to assert on. For C1 (MCP) where
// no .cursor file carries a marker, we generate a runtime nonce in
// the prompt — by definition it doesn't exist anywhere on disk.
//
// Bare-workspace bracket: each feature runs against BOTH a
// configured workspace and an identical-content bare twin without
// `.cursor/`. The configured run asserts the marker is PRESENT; the
// bare run asserts the same marker is ABSENT. If the bare run shows
// the marker anyway, either the eval is wrong OR the agent leaked
// across workspaces — both worth knowing about.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { adapterAvailable, askEval, preview } from "./_eval-utils.ts";

const EVAL_TIMEOUT_MS = 180_000;

const __dirname = dirname(fileURLToPath(import.meta.url));

// All markers are sourced from the *configured* workspace's .cursor/
// files. The bare workspace, by definition, has no .cursor/ — it
// inherits the same marker values for the absence assertion.
const CONFIGURED_REPO = join(
  __dirname,
  "..",
  "..",
  "..",
  "workspaces",
  "eval-context-mgmt-configured-v1",
  "repo",
);
const RULE_PATH = join(CONFIGURED_REPO, ".cursor", "rules", "always-sign.mdc");
const SKILL_PATH = join(
  CONFIGURED_REPO,
  ".cursor",
  "skills",
  "find-easter-egg",
  "SKILL.md",
);

interface Scenario {
  /** Adapter-side workspace id; the eval addresses this in the OpenAI body's `model` field. */
  workspaceId: string;
  /** Human-readable scenario label used in test descriptions. */
  label: string;
  /**
   * `present` → assert the configured marker / nonce IS in the response
   * (this workspace is supposed to react to .cursor/).
   * `absent` → assert it is NOT (this workspace has no .cursor/, so
   * the marker has no source).
   */
  expectation: "present" | "absent";
}

const SCENARIOS: Scenario[] = [
  {
    workspaceId: "eval-context-mgmt-configured-v1",
    label: "configured workspace",
    expectation: "present",
  },
  {
    workspaceId: "eval-context-mgmt-bare-v1",
    label: "bare workspace (no .cursor/)",
    expectation: "absent",
  },
];

function readEvalMarker(filePath: string): string {
  const text = readFileSync(filePath, "utf8");
  const m = text.match(/^EVAL_MARKER:\s*(.+?)\s*$/m);
  if (!m) {
    throw new Error(
      `EVAL_MARKER line not found in ${filePath}. The .cursor file must contain a line of the form 'EVAL_MARKER: <value>'.`,
    );
  }
  return m[1];
}

function randomNonce(): string {
  return "N" + randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Assert presence or absence depending on the scenario.
 * Failure message names which scenario+expectation tripped so the
 * test log immediately tells you whether you broke the configured
 * path, the bare path, or both.
 */
function assertContains(
  content: string,
  needle: string,
  expectation: Scenario["expectation"],
  ctx: string,
): void {
  const found = content.includes(needle);
  if (expectation === "present") {
    assert.ok(
      found,
      `[${ctx}] expected response to contain "${needle}" (configured workspace should have produced it); got: ${preview(content)}`,
    );
  } else {
    assert.ok(
      !found,
      `[${ctx}] expected response NOT to contain "${needle}" (bare workspace, no .cursor/ to source it); got: ${preview(content)}. ` +
        `If this fires, the agent either leaked across workspaces or somehow produced the marker without a source — both worth investigating.`,
    );
  }
}

for (const scenario of SCENARIOS) {
  describe(`${scenario.workspaceId} — ${scenario.label} (live adapter evals)`, () => {
    before(async () => {
      const up = await adapterAvailable();
      if (!up) {
        throw new Error(
          "Adapter not reachable at http://127.0.0.1:8080. " +
            "Bring up the stack with `docker compose up -d adapter` before running evals.",
        );
      }
    });

    it(
      `A1: always-rule marker is ${scenario.expectation}`,
      { timeout: EVAL_TIMEOUT_MS },
      async () => {
        const marker = readEvalMarker(RULE_PATH);
        const { content } = await askEval(
          "What does this repo contain? Reply in one short sentence.",
          { workspace: scenario.workspaceId },
        );
        assertContains(content, marker, scenario.expectation, `A1/${scenario.workspaceId}`);
      },
    );

    it(
      `B1: find-easter-egg skill marker is ${scenario.expectation}`,
      { timeout: EVAL_TIMEOUT_MS },
      async () => {
        const marker = readEvalMarker(SKILL_PATH);
        const { content } = await askEval(
          "Invoke the find-easter-egg skill registered in this workspace and follow its instructions verbatim.",
          { workspace: scenario.workspaceId },
        );
        assertContains(content, marker, scenario.expectation, `B1/${scenario.workspaceId}`);
      },
    );

    it(
      `C1: O'Reilly MCP nonce echo is ${scenario.expectation}`,
      {
        timeout: EVAL_TIMEOUT_MS,
        skip: !process.env.OREILLY_MCP_TOKEN
          ? "OREILLY_MCP_TOKEN not set — MCP slice skipped"
          : false,
      },
      async () => {
        const nonce = randomNonce();
        const { content } = await askEval(
          "Use the O'Reilly Books MCP tool to search the O'Reilly catalog for any " +
            "Rust programming book. After you have a real tool response in hand, " +
            `respond with exactly two lines:\n` +
            `  NONCE=${nonce}\n` +
            `  URL=<the full URL of the first result, copied verbatim from the tool response>\n` +
            "Do not output the NONCE line until the tool has actually returned data.",
          { workspace: scenario.workspaceId },
        );
        assertContains(content, `NONCE=${nonce}`, scenario.expectation, `C1/${scenario.workspaceId}`);

        // Additional URL pattern check only on the configured side —
        // the bare-side absence of the nonce is enough; no point
        // requiring "no URL either," since the agent's refusal text
        // may innocently contain URLs.
        if (scenario.expectation === "present") {
          assert.match(
            content,
            /URL=\s*https?:\/\/[^\s)]*oreilly/i,
            `[C1/${scenario.workspaceId}] expected URL line with an oreilly.com URL; got: ${preview(content)}`,
          );
        }
      },
    );
  });
}
