# context-mgmt-eval-v1 — eval spec

> **Feature spec** for the synthetic workspace at
> [`./`](./).
> **Executable spec:** [`adapter/test/evals/context-mgmt-eval-v1.test.ts`](../../adapter/test/evals/context-mgmt-eval-v1.test.ts).
>
> These are **evals**, not unit tests. They drive the live adapter,
> hit real Cursor, and assert on **patterns** in the response (not
> exact text). They are tagged separately from `npm test` and run
> via `npm run test:evals`.

## Purpose

Validate end-to-end that the user-configurable Cursor context surface
— rules, skills, MCP — actually shapes the agent's responses when
served through our adapter. This is the Phase 1 product-hypothesis
test: "skill-as-service" is more than plumbing.

A single synthetic workspace exercises all three configuration
mechanisms with verifiable markers.

## Contract

These tests assume:
- The adapter is running at `http://127.0.0.1:8080` (override via
  `ADAPTER_URL`).
- The workspace is registered (manifest.json present, adapter
  restarted after it was added).
- `CURSOR_API_KEY` is in the adapter's env (already required for any
  call).
- `OREILLY_MCP_TOKEN` is in the env for the MCP slice — when absent,
  the MCP eval skips cleanly rather than fails.

Each eval:
1. Sends a single-turn `POST /v1/chat/completions` with a fresh
   `X-LibreChat-Conversation-Id` (no resume contamination).
2. Reads `choices[0].message.content`.
3. Asserts on a regex pattern that proves the configured context
   actually fired.

## Behavior

### Tier 1 — Phase 1 closure (rules + skills + MCP)

| # | Configuration | Probe prompt | Expected pattern |
|---|---|---|---|
| A1 | `.cursor/rules/always-sign.mdc` with `alwaysApply: true`, instructs the agent to end every response with the marker declared on an `EVAL_MARKER:` line in the file | "What does this repo contain? Reply in one short sentence." | response contains the marker extracted from the rule file at runtime |
| B1 | `.cursor/skills/find-easter-egg/SKILL.md` with frontmatter and an `EVAL_MARKER:` line, instructs the agent to emit the marker when invoked | "Invoke the find-easter-egg skill registered in this workspace and follow its instructions verbatim." | response contains the marker extracted from SKILL.md at runtime |
| C1 | `.cursor/mcp.json` configuring O'Reilly Books MCP server with `${OREILLY_MCP_TOKEN}`; SKIP if env var absent | Prompt embeds a fresh runtime nonce and asks the agent to echo it on a `NONCE=` line alongside a `URL=` line containing the first tool result's URL | response contains `NONCE=<runtime-nonce>` AND `URL=<oreilly URL>` — the nonce doesn't exist on disk so it can't be grep'd, the URL proves tool use |

**Anti-leak discipline:** marker literals MUST NOT appear in the test
file or this spec. They live only in the `.cursor/` files the agent
loads. The test reads those files at runtime to learn what to assert
on. For C1 (no `.cursor` carrier file), a runtime-generated nonce
serves the same purpose. See the post-implementation finding below
for why this matters.

A1 closes DOD #4 for rules. B1 closes DOD #4 for skills. C1 closes the
"workspace as a service includes MCP" gap inherited from CLAUDE.md §2.

### Tier 2 — selection-logic coverage (Phase 2)

Not in scope for Phase 1 closure. Documented here so the structure is
set up to accept these tests when we get there:

| # | Configuration | Probe | Expected |
|---|---|---|---|
| R2 | Rule with `globs: "docs/**"`, says "answer in haiku" | "Summarize docs/api.md" | response is haiku-like |
| R3 | Same rule, NO docs/ file referenced | "What is 2 + 2?" | response is NOT haiku — rule didn't attach |
| R4 | Rule with `description: "use when asked about pricing"`, says "always say $0.99" | "What does this cost?" | response contains `$0.99` |
| R5 | Same rule, off-topic prompt | "What is the capital of France?" | response does NOT contain `$0.99` — description didn't match |
| R6 | Manual rule (no triggers), says "respond in pirate" | "@pirate-rule what is this repo?" | response is pirate-toned |

### Edge cases discovered post-implementation

> Append-only. Each entry: date, what we found, what changed.

- **2026-05-17 (initial RED phase)** — First failing-tests run revealed
  that B1 and C1 were false-passes against an *unconfigured* workspace:
  the agent emitted `EGG-FOUND` because the prompt mentioned "easter
  egg" (inferred, not from a SKILL.md), and the C1 regex matched normal
  LLM general knowledge about O'Reilly books (no MCP call required).

- **2026-05-17 (second RED phase)** — After tightening markers to
  more distinctive tokens, B1 *still* false-passed because **the
  Cursor agent grep'd the enclosing project tree** (the agent's own
  narration: *"I'm broadening the search to the enclosing repo and
  eval metadata"*) and found the literal token in the test source
  and this spec file. The agent's filesystem view extends beyond its
  declared cwd, so any marker hardcoded in test code or surrounding
  docs leaks. **Fix:** marker literals live only in `.cursor/` files;
  tests read those files at runtime to learn the expected value. For
  MCP (no carrier file), use a runtime-generated nonce that doesn't
  exist on disk. This is the eval-design discipline going forward,
  documented above. Phase-2 work to truly isolate the agent's view
  (per-eval temp dir, sandboxed cwd) is tracked in PHASE1.md's
  "Workspace data isolation" deferred-concern.

- **2026-05-17 (first GREEN attempt)** — After writing the `.cursor/`
  artifacts, A1 (always-rule) and C1 (MCP) still failed; B1 passed.
  The agent's response for C1 even ended with the *rule marker*
  intact, but reported "no MCP servers are available." Two distinct
  causes:

  1. **Rules and skills weren't auto-loading at all** from
     `.cursor/`. The SDK's local agent ignores workspace Cursor
     config unless `local.settingSources` includes `"project"`.
     Default is empty. Fix: `sdkCursorAdapter` now passes
     `settingSources: ["project"]` on both create and resume. After
     this, A1 went green. (Why did B1 already pass before the fix?
     The agent grep'd SKILL.md from disk and followed its instructions
     directly, bypassing Cursor's skill loader — the outcome was
     right, the mechanism wasn't. With `settingSources: ["project"]`
     the loader path is exercised properly.)

  2. **`.cursor/mcp.json` does NOT auto-load even with
     `settingSources: ["project"]`.** MCP config has to be read and
     passed explicitly via the `mcpServers` agent option. The SDK
     also does NOT expand `${ENV_VAR}` placeholders in MCP config
     values, so the adapter expands them against `process.env`
     before passing to the SDK. Both of these are now done in
     `sdkCursorAdapter.loadMcpServers`. After this, C1 went green.

  **Takeaway:** Cursor's "project context" surface is split.
  `.cursor/rules/` and `.cursor/skills/` ride `settingSources`;
  `.cursor/mcp.json` requires explicit programmatic load + env
  expansion. Documented at `adapter/src/cursor/cursor-adapter.ts`
  with the rationale.

- **2026-05-17 (Docker isolation + bare-workspace bracket)** —
  Dockerized the adapter (compose service, workspaces bind-mounted
  read-only, intra-compose DNS for LibreChat). Re-ran 3/3 evals
  against the containerized adapter: all green.

  Then added [`workspaces/context-mgmt-eval-bare-v1/`](../context-mgmt-eval-bare-v1/) —
  same repo content, no `.cursor/`. Parameterized this test file so
  every feature runs against both: configured asserts marker
  **present**, bare asserts marker **absent**. Six tests total, all
  pass. The bare-side passes prove two things at once:

  1. The configured-side presence assertions genuinely test what
     they claim — if rules/skills/MCP weren't actually firing, the
     bare side would still pass via accident but the configured
     side would fail. We see the opposite, so the configured
     assertions have teeth.
  2. The Cursor agent did not grep across workspace boundaries
     during these runs. Docker mounts both workspaces under
     `/app/workspaces/`, so a leaky agent COULD have grep'd
     `context-mgmt-eval-v1/.cursor/` from the bare workspace and
     emitted the configured marker. It didn't.

  If a future run produces a "marker is absent" failure on the bare
  side, the assertion message tells the diagnostic story directly:
  either the eval is wrong, or the agent leaked. Phase 2 work to
  per-agent containers / chrooted cwd would close any remaining
  leak window deterministically.

## Eval reliability notes

These tests run against a real LLM and are inherently softer than
unit tests:

- **Soft pass criterion.** Pattern match on a distinctive marker;
  don't assert on exact wording or tone.
- **Single-shot for now.** If a particular eval becomes flaky in
  practice, add a retry policy or vote-of-N. Don't pre-optimize.
- **Skip-on-missing-dep.** Evals with external dependencies
  (currently only MCP) skip when the dep isn't configured. They
  never fail-by-default for an environmental reason.
- **Not in `npm test`.** Evals are opt-in via `npm run test:evals`
  so the fast suite (`npm test`) stays deterministic and CI-friendly.

## Related

- **Workspace under test:** [`./`](./) (manifest, repo, .cursor/)
- **Test runner:** [`../../adapter/test/evals/context-mgmt-eval-v1.test.ts`](../../adapter/test/evals/context-mgmt-eval-v1.test.ts)
- **Eval utilities:** [`../../adapter/test/evals/_eval-utils.ts`](../../adapter/test/evals/_eval-utils.ts)
- **Test conventions:** [`../../adapter/test/README.md`](../../adapter/test/README.md)
- **MCP integration guide:** [`../../docs/mcp/oreilly.md`](../../docs/mcp/oreilly.md)
- **Background:** [`../../docs/PHASE1.md`](../../docs/PHASE1.md) — Phase 1 closure tier
