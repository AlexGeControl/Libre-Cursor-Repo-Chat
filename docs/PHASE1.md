# Phase 1 — SDK-based adapter, MVP

> **Status:** done, frozen 2026-05-17. Future phases reference this
> doc but do not edit it. Operational facts that survive Phase 1
> live in [`ARCHITECTURE.md`](ARCHITECTURE.md); inherited open
> questions live in [`PHASE2.md`](PHASE2.md).

## Goal

Replace the borrowed `cursor-api-proxy` with our own thin adapter built
on `@cursor/sdk`. Match the OpenAI-compatible surface that LibreChat
already talks to, but own enough of the lifecycle that:

- conversation continuity is real `Agent.resume`, not LibreChat-side
  history replay;
- one adapter process can serve multiple workspaces;
- adding a workspace doesn't require editing `librechat.yaml` and
  restarting LibreChat.

Definition of done is roughly CLAUDE.md §5's MVP definition, de-NVIDIA'd
for this exploration repo: one engineer opens LibreChat, picks one of
several skills from the model dropdown, asks a question, sees a streamed
reply that demonstrably used the workspace's `.cursor/` config, and
continues the conversation across 3+ turns with continuity that
survives a fresh adapter request.

## Outcome

A Fastify-based adapter on `@cursor/sdk@1.0.7`, Dockerized as a
sibling compose service to LibreChat, owns the OpenAI-compatible
surface and translates incoming requests to Cursor SDK calls. Real
`Agent.resume` continuity is backed by a SQLite mapping; rehydration
takes over when the mapping is stale. Five workspaces register from
one process — three real ones (CMU GenAI, CMU LLM Systems, Cursor
Cookbook) plus a configured + bare eval pair that exercises the full
context-management surface (rules, skills, MCP) via TDD with a true
RED/GREEN bracket. The Phase 0 proxy is retired.

## Inherited from Phase 0 — resolved

| # | Inherited problem | Resolution |
|---|---|---|
| 1 | Real conv-state mapping | SQLite store at `.run/adapter/conv-state.sqlite`; `Agent.resume` on hit, `Agent.create` + rehydration on miss; `UnknownAgentError` recovery. Shipped via TDD in slice 2b. |
| 2 | Multi-workspace from one process | `SkillRegistry` scans `workspaces/*/manifest.json`; `models.fetch: true` in `librechat.yaml` so adding a workspace doesn't edit LibreChat config. |
| 3 | Skill-driven UX unverified | `workspaces/context-mgmt-eval-v1/` ships rules + skills + MCP with passing evals; bare-workspace twin proves the assertions have teeth. |
| 4 | Workspace trust handling | SDK's `local: { cwd, settingSources: ["project"] }` is what the adapter passes. No `--trust` equivalent needed — the SDK trusts what it's given. The proxy's `--trust` patch is moot. |

## Decisions (locked at start of phase; preserved here for the audit trail)

| # | Decision | Locked answer | Why |
|---|---|---|---|
| 1 | SDK vs continued CLI | **SDK**, pinned to exact `1.0.7` | Spiked all four primitives (`Agent.create/resume/send/run.stream`) end-to-end on 1.0.7; caret-pinning silently resolves to 1.0.13 which has the catalog-entitlement bug. CLI fallback path was prepared but never needed. |
| 2 | Conv-state store | **SQLite** (`better-sqlite3`) | One host, low concurrency, file-backed debuggability. Redis is a future-scale concern when multiple adapter processes exist. |
| 3 | LibreChat surface | **OpenAI-compat** | Phase 0 already proved the path. Anthropic shape would have been an unmotivated rewrite. |
| 4 | Manifest schema | **7-field JSON** with `cursor_model` defaulting to `gpt-5.5-extra-high-fast` | Minimum viable, matches CLAUDE.md §7 sketch (renamed `modelName` → `id` for honesty); see [`ARCHITECTURE.md`](ARCHITECTURE.md) for the live schema. |

## Out of scope for Phase 1

- Auth beyond LibreChat local username/password.
- Per-user / per-skill Cursor API keys.
- Self-hosted Cursor runtime (data residency story).
- Worker pool / concurrent agents per workspace.
- Engineer-facing manifest upload UI — that's Phase 3 per CLAUDE.md §11.

All of these are inherited by [`PHASE2.md`](PHASE2.md).

## Out of scope for Phase 1

- Auth beyond LibreChat local username/password.
- Per-user / per-skill Cursor API keys.
- Self-hosted Cursor runtime (data residency story).
- Worker pool / concurrent agents per workspace.
- Engineer-facing manifest upload UI — that's Phase 3 per CLAUDE.md §11.

## Definition of done

All ✅ closed.

- [x] Adapter under `adapter/` (Node + TS), implements `GET /v1/models`
      and `POST /v1/chat/completions` (with `stream: true`).
- [x] At least two workspaces from one adapter process (5 today).
- [x] Multi-turn chat in LibreChat demonstrably uses `Agent.resume`.
- [x] At least one workspace has real `.cursor/skills` +
      `.cursor/rules` that visibly shape responses
      (`context-mgmt-eval-v1`).
- [x] **MCP integration** verified end-to-end (O'Reilly Books MCP).
      Added to the DOD list mid-phase per CLAUDE.md §2; closing this
      makes "workspace-as-a-service" feature-complete.
- [x] **Dockerized adapter** (CLAUDE.md §5). One-command boot via
      `docker compose up -d`.
- [x] `cursor-api-proxy` is no longer in the runtime path.
- [x] Phase 0's operational gotchas no longer apply OR are documented
      in [`ARCHITECTURE.md`](ARCHITECTURE.md) for the new world.

## Critical design choices

Distilled from the findings log. The decisions below are load-bearing
— changing any of them requires re-spiking, not refactoring.

### `@cursor/sdk` pinned to exact `1.0.7`

Caret-pinning resolves to 1.0.13 on a fresh install, which fails with
HTTP 403 `feature_unavailable` on `GET /v1/models` from inside
`Agent.create` for this team's NVIDIA Cursor account. `1.0.7` works
end-to-end. The pin lives in `adapter/package.json` and is reinforced
by [`feedback_cursor_sdk_pin`](/home/yaoge/.claude/projects/-home-yaoge-Workspace-Libre-Cursor-Repo-Chat/memory/feedback_cursor_sdk_pin.md)
memory so future agent sessions don't re-discover the trap.

### SQLite over Redis for the convKey → agentId mapping

Single host, low concurrency, file-backed debuggability. Schema is
five columns: `conv_key PRIMARY KEY, cursor_agent_id, skill_id,
created_at, last_used_at`. WAL mode + `synchronous=NORMAL`. Idle
sweep deletes rows older than 24h (configurable) on a 30-minute
timer.

### LibreChat conversationId comes via headers, no LibreChat fork

LibreChat's `resolveHeaders()` already supports body-field
substitution via `{{LIBRECHAT_BODY_<UPPERCASE>}}` placeholders, with
an allowlist of `conversationId`, `messageId`, `parentMessageId`.
`librechat.yaml` declares the headers; the adapter reads them and
computes `convKey = ${body.user}:${X-LibreChat-Conversation-Id}`.

### Dispatcher handles `UnknownAgentError` on BOTH resume and send

The SDK's `Agent.resume` returns a stub synchronously and only
validates against the server on the first `send()`. So "agent gone"
surfaces during `send`, not `resume`. The dispatcher's `dispatch` +
`tryResumeAndSend` in
[`adapter/src/routes/chat-completions.ts`](../adapter/src/routes/chat-completions.ts)
catches both cases via an `isAgentMissingError` helper that handles
both `UnknownAgentError` class instances AND message-pattern
matches.

### Project `settingSources` + explicit MCP loading

`local.settingSources: ["project"]` covers `.cursor/rules/` and
`.cursor/skills/`. `.cursor/mcp.json` does NOT ride that toggle — the
adapter parses it explicitly, expands `${ENV_VAR}` placeholders
against `process.env`, and passes the result via the `mcpServers`
SDK option. Both pieces are in
[`adapter/src/cursor/cursor-adapter.ts`](../adapter/src/cursor/cursor-adapter.ts).

### `.spec.md` convention next to each TDD feature

Every meaningful feature has a `<feature>.spec.md` co-located with
its implementation, mirroring the executable spec in `test/`. The
spec.md is the RED-phase artifact: written before the failing test,
before the implementation. Documented in
[`adapter/test/README.md`](../adapter/test/README.md). First
exemplar is
[`adapter/src/cursor/rehydration.spec.md`](../adapter/src/cursor/rehydration.spec.md).

### Bare-workspace negative control

Every context-management eval runs against BOTH a configured
workspace (asserts marker present) AND a bare twin without
`.cursor/` (asserts marker absent). The bare side proves the
assertions have teeth AND detects cross-workspace agent leakage —
if the bare-side assertion ever fires, either the eval is wrong OR
the agent grep'd across workspaces.

## Lessons learned

In rough order of "would save the most time if shipped as part of the
team's TDD playbook."

### Smoke tests catch what unit tests can't

The integration tests for slice 2b assumed `Agent.resume` would throw
on a stale agentId. The unit suite went green. The smoke test
(synthetic bogus agentId planted in SQLite, real request driven
through) revealed the SDK's *actual* behavior — resume returns a
stub, send is where the error surfaces. Fed back as test `D'` in the
integration suite, plus the `isAgentMissingError` helper. The
discipline: *every TDD slice gets a post-green smoke test before
"done."*

### Eval markers must NOT appear in test source

Cursor agents grep the enclosing project tree, not just their
declared cwd. A marker hardcoded in test code or surrounding docs
leaks via filesystem grep and produces false-passes. Two rounds of
RED phase trapped this:
- Round 1: marker `EGG-FOUND` was inferable from the prompt.
- Round 2: marker `NUTMEG-7K2M` was non-inferable from the prompt
  but lived in the test file — the agent narrated grep'ing the
  enclosing repo, found it, used it.

Fix: marker literals live only in `.cursor/` files; tests read those
files at runtime. For features without a carrier file (MCP), use a
runtime-generated nonce that doesn't exist on disk anywhere.

### SDK contract != type contract

The SDK's `.d.ts` says `Agent.create(): SDKAgent` (sync return). At
runtime it's async — the cookbook quickstart awaits it. The cookbook
also showed that explicit `apiKey` in options is needed, not just
the env var. Trust the **runtime behavior** verified by working
reference code (the cookbook) over what the types claim.

### Cursor's project-context surface is split

It's tempting to assume one `settingSources` switch covers
everything in `.cursor/`. It doesn't. Rules and skills ride the
toggle; MCP requires explicit programmatic loading. Document the
split prominently — `adapter/src/cursor/cursor-adapter.ts` has an
extended comment for the next maintainer.

### The `.spec.md` discipline pays for itself by slice 2

Three TDD slices shipped using the convention (`rehydration`,
`sweeper`, `context-mgmt-eval-v1`). Each one re-used the template,
ratcheted the README. The discipline turns "test coverage" into
"feature contracts": a maintainer can read the spec table for a
30-second mental model before reading any code.

### Docker isolation is a test-fidelity tool, not just a deployment artifact

The bare-vs-configured eval bracket only became a strict negative
control once the adapter ran in Docker. With the workspaces mount
limited to the compose service's view and the test code outside the
container, the agent has fewer paths to leak. We knew Docker was
"Phase 1 deployment work" — what we learned is that it's also "Phase
1 test rigor work."

## Findings log

> Append to this section during the phase. Distill into headings at the
> end of the phase per [`CONTEXT.md`](CONTEXT.md).

### 2026-05-16 — SDK 1.0.7 capability spike (decision #1 gate)

Set up `spike/` (gitignored, throwaway) with `@cursor/sdk@1.0.7` and
exercised the four primitives the adapter design depends on against
`workspaces/cmu-genai-v1/repo`. Spike source: `spike/spike.mjs`.

**Type-level (no network):** all four primitives exist in 1.0.7 with
the shapes CLAUDE.md §7 assumed.

- `Agent.create(options: AgentOptions): SDKAgent` ✓
- `Agent.resume(agentId, options?): SDKAgent` ✓
- `agent.send(message, options?): Promise<Run>` ✓
- `run.stream(): AsyncGenerator<SDKMessage>` ✓

Also nice-to-haves: `Cursor.models.list()`, `Agent.list()`,
`Agent.messages.list(agentId)`, `run.wait()`, `run.onDidChangeStatus()`.

**Runtime-level (with our NVIDIA API key): blocked.** Three concrete
failures, in order:

1. `Cursor.models.list()` → `[feature_unavailable] This feature is not
   available for your account`. The cloud catalog endpoint
   (`GET https://api.cursor.com/v1/models`) is entitlement-gated. The
   adapter can route around this by trusting manifest-declared model
   ids, so this alone wouldn't block.

2. `Agent.create({ local: { cwd } })` → returns a synthesized
   `agent-<uuid>` without a network call. Passes, but only because it's
   pure local id allocation; nothing has been validated yet.

3. `agent.send(...)` → `ConnectError: [unknown] Invalid API key. Please
   check your Cursor API key and try again.` Thrown from the
   ConnectRPC dashboard client the local-executor spins up to fetch
   team admin settings / user privacy mode. The same key works fine
   for the Cursor CLI (Phase 0 proves it end-to-end), so this is not a
   bad key — it's an entitlement gap between the CLI's auth surface
   and the SDK's dashboard ConnectRPC surface.

**Cross-check: cookbook quickstart unmodified, same workspace and key.**
After adding `workspaces/cursor-cookbook-v1/repo` as a submodule (the
reference the user used to get the SDK working two days ago), ran
`sdk/quickstart/src/index.ts` verbatim with cwd = `cmu-genai-v1/repo`
and `CURSOR_MODEL=gpt-5.5-extra-high-fast`. Failed identically:

```
{
  isRetryable: false,
  code: 'feature_unavailable',
  status: 403,
  endpoint: 'GET /v1/models',
  operation: 'Agent.create'
}
```

`Agent.create` internally calls `GET /v1/models` (for model validation
/ feature gating); the failure mode I saw on `agent.send` is the same
gate, just hit one level deeper because my spike didn't `await
Agent.create` so the rejection surfaced later. The SDK's runtime
behavior contradicts its `d.ts` here — `Agent.create` is actually
async, even though the type signature says `(options) => SDKAgent`.

**Root cause:** `GET /v1/models` entitlement on the
`svccursor-sdk-poc@nvidia.com` account changed between the user's
working test two days ago and now. The Cursor CLI uses a different
auth path (its own login state in `~/.cursor/agent-cli-state.json`),
which is why `agent` still works on the host while `@cursor/sdk`
doesn't. Action: escalate to whoever provisions Cursor entitlements
for this team and ask for `GET /v1/models` access.

**Secondary finding:** SDK requires a real `rg` on `PATH` and rejects
shell-function shims with an "Ripgrep path not configured" runtime
error. The Cursor agent CLI bundles its own `rg` at
`~/.local/share/cursor-agent/versions/<ver>/rg`; prepending that to
`PATH` fixes the spike but is a deployment requirement to track for the
adapter regardless of SDK vs CLI.

**Initial verdict (wrong): SDK path is blocked.** Recorded above for
the audit trail. The follow-up below reverses it.

### 2026-05-16 — Verdict reversed: SDK 1.0.7 works, 1.0.13 doesn't

User flagged that 1.0.13 is the known-broken version. Both the cookbook
quickstart `package.json` (`"@cursor/sdk": "^1.0.7"`) and our spike
were resolving the caret to 1.0.13 on a fresh install, which is where
all the `feature_unavailable` / `Invalid API key` errors came from.
Re-pinning to exact `"@cursor/sdk": "1.0.7"` in both places (with
`npm install --save-exact` and a clean `node_modules`) flipped every
failure to success:

- Cookbook quickstart unmodified, cwd = `cmu-genai-v1/repo` →
  grounded streamed answer about the CMU course materials.
- Spike `Agent.create` + `agent.send` + `run.stream` + `Agent.resume`
  on the CMU workspace → all four primitives pass; 137 stream chunks
  on the first turn, resume returns the same `agentId`, second turn
  finishes cleanly.

**Decision: SDK path is unblocked. Phase 1 builds on `@cursor/sdk` as
originally planned in CLAUDE.md §4.**

**Hard requirement: pin to `"1.0.7"` exactly, not `"^1.0.7"`.**
1.0.x is not honoring semver compatibility for our key — at least
1.0.13 fails with HTTP 403 `feature_unavailable` on `GET /v1/models`
from inside `Agent.create`. The adapter's `package.json` must use the
exact-pin form, and CI / Docker builds must not run `npm update` on
this dependency without an explicit version re-spike.

**Secondary requirement still applies:** the SDK needs a real `rg`
binary on `PATH`. The Cursor agent CLI bundles one at
`~/.local/share/cursor-agent/versions/<ver>/rg`; the adapter must
prepend that to `PATH` at startup (or ship its own `rg`). Without it
the SDK throws `Ripgrep path not configured` from inside the tool-call
machinery.

**Catalog probe (`Cursor.models.list()`) is still gated** with
`feature_unavailable` on this key. Doesn't matter — the manifest
declares model ids, `Agent.create` does not require a successful
catalog call, and the proxy's `/v1/models` (CLI auth path) keeps
working if we ever want a sanity check.

**Cross-check: Phase 0 CLI path still healthy.** Probed
`http://127.0.0.1:8765/{health,/v1/models,/v1/chat/completions}` —
all green, including `gpt-5.5-extra-high-fast` round-trip. Phase 0
keeps working alongside Phase 1 development; not pulling it down
until the new adapter is real.

### 2026-05-16 — Adapter scaffold + LibreChat probe

Scaffolded `adapter/` on Fastify + `@cursor/sdk@1.0.7` (exact pin) +
`fastify-sse-v2` (deferred until streaming slice). Endpoints today:

- `GET  /health`                → `{ ok, skills, workspacesDir }`
- `GET  /v1/models`             → driven by `loadSkills()` scanning
  `workspaces/*/manifest.json`. Returns three skills today
  (`cmu-genai-v1`, `cmu-llm-systems-v1`, `cursor-cookbook-v1`).
- `POST /v1/chat/completions`   → **slice-1 stub**: logs the incoming
  request shape and returns a non-streaming placeholder. Cursor SDK
  wiring lands in slice 2.

Registered as the second LibreChat custom endpoint
(`"Cursor Adapter (Phase 1)"` → `http://host.docker.internal:8080/v1`)
alongside the still-running Phase 0 proxy, then drove a chat through
the LibreChat API to capture the outbound request shape.

**Finding: LibreChat does not forward conversationId in the
OpenAI-compat outbound request.** The MongoDB record knows
`conversationId` and shows it in `GET /api/convos`, but the
langchain-js OpenAI client that calls our `/v1/chat/completions`
sends only a standard body:

```json
{
  "model": "cmu-genai-v1",
  "user": "<LibreChat userId, stable per user>",
  "stream": true,
  "messages": [...]
}
```

with headers `user-agent: langchainjs-openai/1.0.0`, `x-stainless-*`
(Stainless-generated OpenAI client lineage), `authorization` carrying
the `"unused"` placeholder from `librechat.yaml`. No custom header,
no conversation id, no `metadata` field on the body.

**Decision (initial): patch LibreChat to forward conversationId.**
Recorded for the audit trail. The follow-up below replaces it — no
patch is needed.

### 2026-05-16 — LibreChat already supports body-field header injection

Before writing a patch, scouted LibreChat v0.8.6-rc1 source (sibling
clone at `../LibreChat`, matching the running container's reported
version). Found that LibreChat's `resolveHeaders()` (in
`packages/api/src/utils/env.ts`) already supports placeholder
substitution from the request body, with an allowlist:

```ts
const ALLOWED_BODY_FIELDS = ['conversationId', 'parentMessageId', 'messageId'];
```

Placeholder syntax: `{{LIBRECHAT_BODY_<FIELD_UPPERCASE>}}`. Per-endpoint
`headers:` config in `librechat.yaml` is run through this resolver on
every outbound `/v1/chat/completions` call. The check is also wired
into the main agent run path (`packages/api/src/agents/run.ts:836-842`),
not just summarization.

**No code patch, no fork, no Dockerfile overlay needed.** Updated
`librechat.yaml` with:

```yaml
- name: "Cursor Adapter (Phase 1)"
  baseURL: "http://host.docker.internal:8080/v1"
  headers:
    X-LibreChat-Conversation-Id: "{{LIBRECHAT_BODY_CONVERSATIONID}}"
    X-LibreChat-Message-Id: "{{LIBRECHAT_BODY_MESSAGEID}}"
    X-LibreChat-Parent-Message-Id: "{{LIBRECHAT_BODY_PARENTMESSAGEID}}"
```

Restart `api`, re-probe: all three headers arrive at the adapter
lowercased per HTTP/Fastify conventions, with values matching the
request body verbatim. The `body.user` field still carries the
LibreChat userId.

**Adapter's convKey is now:** `${body.user}:${req.headers["x-librechat-conversation-id"]}` —
compound to defuse cross-user collisions even if conv ids ever
duplicate. Plain composition, no hashing, no LibreChat fork.

**The sibling `../LibreChat` clone** stays as a read-only reference
for future LibreChat-side investigations. It is not a submodule and
is not built or shipped.

### 2026-05-16 — Slice 2: Cursor SDK wiring + SQLite resume

**Slice 2a (Agent.create + send + stream → OpenAI SSE).** Adapter now
calls real Cursor SDK on every turn. Both branches verified:

- Non-streaming (`stream: false`) — collects the full assistant text
  via `textDeltas(run)` then returns a single OpenAI completion
  object with heuristic `usage` counts.
- Streaming (`stream: true`) — emits OpenAI chunks per text delta
  yielded by `run.stream()`, prepended by a role-only chunk so
  langchainjs's client sees the role at start, terminated with a
  `finish_reason: "stop"` chunk and `data: [DONE]`.

LibreChat → adapter → Cursor → grounded streamed answer all wired
through the new `phase1-adapter` endpoint. The Phase 0 proxy stays
running in parallel; nothing in the existing setup broke.

**Slice 2b (SQLite-backed convKey → cursorAgentId + Agent.resume).**
Added `better-sqlite3` (pinned) and `state/conv-store.ts`. Schema:

```sql
CREATE TABLE conv_agents (
  conv_key TEXT PRIMARY KEY,
  cursor_agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX idx_conv_agents_last_used ON conv_agents(last_used_at);
```

Database file lives at `.run/adapter/conv-state.sqlite` (gitignored
via the parent `.run/` rule). WAL mode + `synchronous=NORMAL` for the
usual concurrent-read perf.

Request flow per turn:

1. Compute `convKey = userId:conversationId` from `body.user` + the
   `X-LibreChat-Conversation-Id` header.
2. Look up in SQLite. If the row exists AND the stored `skill_id`
   matches the request's model, try `Agent.resume(agentId, ...)`.
3. On `UnknownAgentError`: delete the stale row and fall through to
   create. (Catch is class-narrowed; any other error propagates so
   we don't silently mask auth/network failures as "agent expired".)
4. On miss or mismatched skill: `Agent.create(...)`, then `put()`
   the mapping. If `messages.length > 1` on this path, log a
   warning — the user perceives an ongoing conversation but Cursor
   has no context. Rehydration from `messages[]` is queued as a
   slice 2c TODO; not blocking.
5. Lifecycle: `agent[Symbol.asyncDispose]()` at end of every
   request. The in-process `SDKAgent` object releases its resources;
   the Cursor-side agent persists and is reachable via `Agent.resume`
   on the next turn.

Verified with three back-to-back curl probes:

- Turn 1 (new convKey, content "remember PINEAPPLE") → log `cursor
  agent created`, SQLite row inserted.
- Turn 2 (same convKey, ask for the secret) → log `cursor agent
  resumed`, response is just the literal `` `PINEAPPLE` `` in 3
  completion tokens — that's Cursor's server-side context recalling
  the secret, not a workspace grep finding it.
- Turn 3 (different convKey, same skill) → log `cursor agent
  created`, fresh agent (see filesystem side-channel note below).
- Turn 4 (new convKey, 3-message synthesized history) →
  rehydration-not-yet-implemented warning fires correctly.

**Side-channel finding (not a regression — also true in Phase 0):**
The Cursor CLI/runtime stores per-host chat transcripts at
`~/.cursor/chats/<hash>/`. A fresh agent in a *different* convKey on
the *same workspace* can, and during the probe did, grep those local
transcripts via its file-search tools and surface another
conversation's secret. So workspace-level isolation across LibreChat
users sharing one host is leaky-by-default. Production deployments
will need either per-user runtime sandboxes (containers / namespaces
per user) or an upstream Cursor option to disable chat-history
disk-persistence. Tracking as a Phase 2 concern.

**Known TODOs deferred out of slice 2:**

- Rehydration on `(miss, priorMessages > 0)` — **shipped in slice 2c
  via TDD** (see next finding).
- Idle-agent sweeper — `last_used_at` is indexed; a periodic job can
  enumerate stale rows and call `Cursor.agents.delete` (or whatever
  the SDK exposes) to free server-side state. Not urgent for Phase 1.
- Title-gen contamination — LibreChat's titleConvo flow calls
  `/v1/chat/completions` a second time with the same conversationId,
  and we currently resume the same agent. The title prompt enters
  the agent's history. Not visibly broken yet, but worth tracking.

### 2026-05-17 — Dockerized adapter + bare-workspace negative control

Completed two related Phase-1 hardening items in one slice:

**1. Dockerize the adapter.** Closes the original CLAUDE.md §5 item
("Docker-Composed LibreChat + adapter, runnable with one command")
that had been deferred all phase. New artifacts:

- [`adapter/Dockerfile`](../adapter/Dockerfile) — `node:22-bookworm-slim`
  base with `ripgrep` apt-installed (SDK runtime requirement), runs
  `tsx src/index.ts` directly. Tests are NOT copied into the image
  by intent — the container should never see test markers.
- [`adapter/.dockerignore`](../adapter/.dockerignore) — keeps
  `node_modules`, `.run`, `test`, `spike` out of the build context.
- [`docker-compose.yml`](../docker-compose.yml) gains an `adapter`
  service with `./workspaces` bind-mounted read-only and
  `./.run/adapter` writable for SQLite persistence. Exposes `:8080`
  on the host so eval tests can keep running from outside the
  container.
- [`librechat.yaml`](../librechat.yaml) `Cursor Adapter (Phase 1)`
  endpoint now uses intra-compose DNS (`http://adapter:8080/v1`)
  instead of `host.docker.internal`. LibreChat → adapter still
  works; verified via `docker exec librechat-api wget`.

All 3 evals pass against the containerized adapter (51s end-to-end).

**2. Bare-workspace negative control.** Added
[`workspaces/context-mgmt-eval-bare-v1/`](../workspaces/context-mgmt-eval-bare-v1/) —
identical repo content to the configured eval workspace, deliberately
**no `.cursor/` directory**. Parameterized the eval test file so each
feature runs against both workspaces:

- Configured workspace → assert marker **present** (proves `.cursor/`
  shapes the response).
- Bare workspace → assert marker **absent** (proves the assertion
  has teeth — if `.cursor/` weren't doing the work, both sides would
  pass-by-accident; we see the opposite).

6/6 evals pass (3 features × 2 workspaces). The bare side passing
also catches cross-workspace agent leakage — if the agent ever grep'd
the sibling configured workspace's `.cursor/` to fake markers, the
bare-side assertion would fail with a clear diagnostic message.

**Updated test inventory:**

```
test/cursor/rehydration.test.ts            8 unit         ✓
test/routes/chat-completions.test.ts       7 integration  ✓
test/state/sweeper.test.ts                12 mixed        ✓
test/evals/context-mgmt-eval-v1.test.ts    6 evals        ✓ (3 features × 2 workspaces, live adapter)
                                          ─────────────────
                                          33 total        ✓
```

### 2026-05-17 — Tier-1 context-management evals (Phase 1 closure)

Shipped a dedicated synthetic workspace,
[`workspaces/context-mgmt-eval-v1/`](../workspaces/context-mgmt-eval-v1/),
that exercises all three user-configurable Cursor context surfaces
end-to-end through the adapter:

- **A1 — `.cursor/rules/always-sign.mdc`** with `alwaysApply: true`.
  Proves rules attach to every response. (DOD #4 — rules)
- **B1 — `.cursor/skills/find-easter-egg/SKILL.md`**. Proves skill
  loading and procedure execution. (DOD #4 — skills)
- **C1 — `.cursor/mcp.json`** wired to the O'Reilly Books MCP server
  via `${OREILLY_MCP_TOKEN}` placeholder. Proves the MCP extension
  point works through the adapter. (Closes the CLAUDE.md §2 gap that
  was missing from the original DOD list — "workspace as a service"
  is incomplete without MCP.)

All three eval tests pass against the live adapter. Suite tagged as
`npm run test:evals` (separate from `npm test`) because evals are
slow (real LLM, real external services) and softer than unit tests.

**Two non-obvious findings that cost real time to nail down:**

1. **`local.settingSources: ["project"]` is required** for the SDK
   to load `.cursor/rules/` and `.cursor/skills/`. Default is empty
   → bare local agent, no project context. The adapter's
   `sdkCursorAdapter` now passes it on both create and resume.

2. **`.cursor/mcp.json` does NOT auto-load even with
   `settingSources: ["project"]`.** It has to be parsed and passed
   via the `mcpServers` AgentOption explicitly. The SDK also doesn't
   expand `${ENV_VAR}` placeholders, so the adapter does that against
   `process.env` before handing off. Implementation in
   `adapter/src/cursor/cursor-adapter.ts → loadMcpServers`.

**Eval-design discipline established** during this slice (now the
convention for any future eval workspace):

- Marker literals MUST live only in `.cursor/` files, never in test
  source. Cursor agents grep the enclosing project tree, so any
  marker hardcoded in test code is found via filesystem grep and
  produces false-passes.
- Tests read the `.cursor/` file at runtime to learn what to assert
  on. The file is the source of truth for both the agent and the
  test.
- For features without a carrier file (MCP), use a runtime-generated
  nonce that doesn't exist on disk anywhere.
- Eval tests are tagged separately (`test:evals`) and assert on
  patterns/structure, not exact text.

**Test inventory after this slice:**

```
test/cursor/rehydration.test.ts        8 unit         ✓
test/routes/chat-completions.test.ts   7 integration  ✓
test/state/sweeper.test.ts             12 mixed       ✓
test/evals/context-mgmt-eval-v1.test.ts  3 evals      ✓ (live adapter)
                                       ─────────────────
                                       30 total       ✓
```

Run unit + integration: `npm test`. Run evals: `npm run test:evals`.

Phase 1 DOD #4 ✓ closed.

### 2026-05-17 — TDD foundation + `.spec.md` convention

Adopted a project-wide convention so every TDD feature has both an
executable spec (`test/<thing>.test.ts`) and a human-readable feature
spec (`src/<thing>.spec.md`) co-located with the implementation. The
spec.md is the RED-phase artifact: written before the failing test,
before the implementation. Documented in
[`adapter/test/README.md`](../adapter/test/README.md). First exemplar:
[`adapter/src/cursor/rehydration.spec.md`](../adapter/src/cursor/rehydration.spec.md).

### 2026-05-17 — Slice 2d: idle-agent sweeper (TDD)

Built the sweeper using the new convention end-to-end: wrote
[`src/state/sweeper.spec.md`](../adapter/src/state/sweeper.spec.md)
first, then failing tests for `ConvStore.deleteStale` (S1-S6) and
`startIdleSweeper` (W1-W6), then the implementation. Wired into
`src/index.ts` with env-tunable TTL / interval and graceful
shutdown.

Smoke-tested by setting `ADAPTER_IDLE_TTL_HOURS=0.001`
(`ADAPTER_SWEEPER_INTERVAL_MIN=0.05`), inserting a row with
`last_used_at = 1`, and observing the next tick log
`"removed stale conv mappings"` followed by the row vanishing from
the table. Restarted with production defaults (24h / 30min) for
normal operation.

**Test inventory after slice 2d:**

```
test/cursor/rehydration.test.ts        8 unit tests   ✓
test/routes/chat-completions.test.ts   7 integration  ✓
test/state/sweeper.test.ts             12 mixed       ✓
                                       ────────────
                                       27 total       ✓
```

### 2026-05-17 — Slice 2c: rehydration (TDD)

Shipped the rehydration branch with full TDD coverage. The branch
fires when the adapter has to spin up a fresh Cursor agent for a
conversation LibreChat thinks is ongoing — either because the convKey
was never mapped (e.g. SQLite was wiped, or a different user picked
up the conversation after a re-key) or because the mapped Cursor
agent was GC'd server-side.

**Test foundation.** Laid down a reusable test layout in `adapter/test/`:

- Mirror tree (`test/` mirrors `src/` one-to-one).
- Three layers: unit (pure functions, no deps), integration (Fastify
  via `app.inject()` with fakes + in-memory SQLite), smoke (manual
  `curl` against the running adapter, documented in PHASE docs not
  in `test/`).
- Conventions documented in `adapter/test/README.md`.
- Runner: `node:test` + `node:assert/strict`, zero new deps. Run via
  `npm test`.
- First reusable test double: `test/support/fake-cursor.ts`
  implementing the `CursorAdapter` interface introduced for this
  slice.

**Architecture refactor.** Extracted `CursorAdapter` interface
(`src/cursor/cursor-adapter.ts`). Production uses `sdkCursorAdapter`
which wraps `Agent.create`/`Agent.resume`. The chat-completions
plugin takes the adapter via options, so tests inject `FakeCursor`
trivially. Pure win — also makes future migrations (different SDK
version, or a CLI-wrapper backup) a one-module swap.

**Rehydration prompt design** (`src/cursor/rehydration.ts`,
`test/cursor/rehydration.test.ts`). Single function
`buildRehydrationPrompt(messages) → string`:

- Validates: non-empty array, last message must be `role: "user"`.
- If only one effective message (length 1, or all prior turns are
  empty), returns just the latest text — no ceremony for the
  happy-path first turn.
- Otherwise, formats prior turns as labeled lines inside a fenced
  block, then sets up the latest user message in a clearly demarcated
  "respond only to this" section.
- Preserves `role: "system"` turns in the prior block so persona
  survives a hard rehydrate.
- Skips empty-content turns rather than emitting blank `USER: ` lines.

**Dispatcher logic** (`src/routes/chat-completions.ts`, `dispatch`
+ `tryResumeAndSend`):

- Existing mapping for same skill → try `resume + send(bare-latest)`.
- On `UnknownAgentError` from EITHER `resume()` OR the first `send()`
  → log, delete mapping, fall through to create with rehydration.
- On any other error → propagate (so transient network/auth issues
  don't masquerade as "agent expired" and silently lose continuity).
- Skill mismatch → delete and create + rehydrate (user perceives
  conversation continuity regardless of which skill answers).

**Crucial real-world finding the unit tests missed.** The integration
tests originally assumed `resume()` itself would throw on a stale
agentId. In reality `@cursor/sdk@1.0.7` `Agent.resume` returns a stub
synchronously and only validates against the server on the first
`send()` — so "agent not found" surfaces *during* `send()`. Caught
by the post-implementation smoke test (synthetic bogus agentId
inserted directly into SQLite, then a real request driven through);
fed back into the integration suite as test `D'` and into the
implementation as `isAgentMissingError(err)` which handles BOTH
class-instance and message-pattern shapes. The integration suite is
how we'd have caught this earlier if the test came first; the value
of running the smoke after green tests is exactly this kind of
contract-vs-reality gap.

**Test inventory after slice 2c:**

```
test/cursor/rehydration.test.ts        8 unit tests
test/routes/chat-completions.test.ts   7 integration tests (A, B, C, D, D', E, F)
```

All 15 pass. Run with `npm test` from `adapter/`.

**Smoke test evidence.** With a bogus agentId planted in
`conv-state.sqlite` and a 3-turn synthetic history sent as the
request body:

- Log sequence: `cursor agent resumed` → `cursor agent missing
  upstream; will fall back to create + rehydration` → `cursor agent
  created` → `run finished`.
- Response: literal `BANANAFISH` in 3 completion tokens — recalled
  from turn 1 of the rehydration prompt (the codename never
  appeared anywhere else).
- SQLite mapping replaced cleanly; new agentId saved.

The synthetic-expired-agent injection is also the most useful
production debugging tool we have for this branch. Documented in
this section so any future on-call session can rerun it without
re-deriving the SQL.

**Side note:** LibreChat asks for `stream: true` and our slice-1 stub
returns a non-streaming JSON, so LibreChat doesn't record the
assistant reply on the probe turn. Slice 2 (Cursor SDK wiring) brings
proper SSE; the stub is intentionally minimal.
