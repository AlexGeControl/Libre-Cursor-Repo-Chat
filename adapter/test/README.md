# adapter/test — testing conventions

## Feature specs (`.spec.md`) — the RED-phase artifact

Every meaningful feature gets a `<feature>.spec.md` next to its
implementation in `src/`. It is the **first** artifact written in
TDD — before the test file, before the implementation. It is the
human-readable design doc that the test file then mirrors row-by-row.

### Why this exists

Tests are the executable spec, but they're optimized for the
machine. A maintainer arriving on a feature wants the same overview
they'd get from a small markdown table — what cases exist, what each
one expects — without having to read the assertion bodies. The
spec.md is that overview. It also makes the smoke-test → "the unit
suite missed this" loop auditable: discoveries land in an
append-only log inside the spec.

### Where it lives

```
src/cursor/rehydration.ts       ← implementation
src/cursor/rehydration.spec.md  ← FEATURE SPEC
test/cursor/rehydration.test.ts ← executable spec, mirrors the table
```

Specs live in `src/` (with the implementation), not in `test/`. The
spec describes the *feature*, and the feature's canonical home is
the source module. When you grep for a feature name, code + spec
come back together.

### When to write one

- **Always** for new features that warrant unit-level tests.
- **Skip** for trivial code (one-line helpers, type-only modules).
- **Backfill retroactively** when you find yourself wanting an
  overview of what an existing module's behavior actually is.

### Template

The canonical example is
[`src/cursor/rehydration.spec.md`](../src/cursor/rehydration.spec.md).
The structure:

1. **Purpose** — one paragraph: what problem this solves.
2. **Contract** — signature, inputs, outputs, throws, invariants.
3. **Behavior** — table or numbered sections; one row per test case,
   same order as the test file.
4. **Edge cases discovered post-implementation** — append-only log
   of surprises found in smoke tests or production. This is where
   the "smoke caught what unit tests missed" lessons land.
5. **Related** — links to implementation, tests, callers, and the
   `docs/PHASE*.md` doc that originally scoped this feature.

### Cross-references

- The test file opens with a comment pointing at the spec:
  ```ts
  // Spec: ../../src/cursor/rehydration.spec.md
  ```
- The spec.md links to its test file and implementation in the
  Related section.
- PHASE docs link to the spec.md when narrating what shipped — the
  PHASE doc is the *narrative*, the spec.md is the *contract*.

### Format choice

- Markdown tables for short specs.
- Numbered `## A. Setup → Expected` sections when rows wrap awkwardly
  (typical for integration specs with multi-paragraph setups).
- ASCII box-drawing only inside `.ts` comment blocks where monospace
  context makes it look right.

## Layout

The `test/` tree mirrors `src/` one-to-one. To find the test for a
source file, replace the leading `src/` with `test/` and append
`.test.ts` to the filename.

```
src/cursor/rehydration.ts     ↔  test/cursor/rehydration.test.ts
src/routes/chat-completions.ts ↔  test/routes/chat-completions.test.ts
```

`test/support/` is for shared scaffolding (fakes, fixtures, helpers)
— it is **not** for tests. Nothing in `support/` runs on its own;
test files import from it.

## Runner

Node's built-in `node:test` + `node:assert/strict`. Zero extra deps.
TypeScript is loaded via `tsx`. Run all tests:

```bash
npm test
```

Run a single file:

```bash
node --import tsx --test test/cursor/rehydration.test.ts
```

## Three layers — pick the lightest one that proves what you need

### 1. Unit tests — pure functions, no I/O

Default home for new logic. Should be the bulk of the suite.

- No mocks, no fakes, no async other than what the function under
  test naturally does.
- File lives next to the source it mirrors.
- Example: `test/cursor/rehydration.test.ts` — the rehydration prompt
  builder is a pure `(messages) → string` function.

### 2. Integration tests — Fastify routes with fakes

For request-handler behavior that spans multiple modules (route +
SDK + SQLite). Use `fastify.inject()` so no port binds and the test
runs as fast as a unit test.

- Fake the **external** dependencies: `CursorAdapter` (so we don't
  hit Cursor's API). Real `ConvStore` with `:memory:` SQLite so the
  schema and statements are exercised genuinely.
- Live in `test/routes/` or `test/handlers/`.
- Example: `test/routes/chat-completions.test.ts`.

### 3. Smoke tests — running adapter, real or near-real deps

For verifying end-to-end behavior that integration tests can't (full
SSE round-trip, real LibreChat path, real Cursor agents). Done by
hand with `curl` against a running adapter; results captured in the
relevant `docs/PHASE*.md` finding rather than as test files.

Smoke tests are **not in `test/`**. They're documented decisions
about how we verified a slice — auditable, not automated.

## Writing a test

Use `describe`/`it` from `node:test` for grouping:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRehydrationPrompt } from "../../src/cursor/rehydration.ts";

describe("buildRehydrationPrompt", () => {
  it("returns just the latest text when there is no prior history", () => {
    const out = buildRehydrationPrompt([{ role: "user", content: "hi" }]);
    assert.equal(out, "hi");
  });
});
```

Assertions: prefer `assert.equal` / `assert.deepEqual` /
`assert.match` over `assert.ok(complex)`. Failure messages should
say what was expected.

## Fakes vs mocks

Prefer hand-rolled **fakes** in `test/support/` over per-test mocks:

- A fake is a real implementation of a real interface, with
  controllable / inspectable behavior. Easier to maintain, reusable
  across tests.
- A mock is a per-test override (`mock.method(...)`). Use sparingly,
  only when you need to assert that a specific call happened in
  isolation.

Example fakes:
- `test/support/fake-cursor.ts` — implements `CursorAdapter`.

## When to add a new test layer

You usually shouldn't. If a new kind of test feels necessary,
revisit whether the underlying code's seams are right — most
"hard to test" situations get easier with one well-placed
interface.
