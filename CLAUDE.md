# Cursor-as-a-Service — Project Bootstrap

> **Audience:** This is the kickoff document for a Claude Code session working on
> this project. Read this first. It is the source of truth for scope, design,
> and the next actions.

## 1. Mission

Build an internal web service that lets NVIDIA HW infra engineers deploy
their **Cursor workspaces** (distilled know-how for test generation and
result analysis) as **multi-user chat services**, so the team can scale
per-engineer expertise across the org.

Each deployed workspace becomes a "skill" that any authorized engineer can
chat with through a browser — same UX as ChatGPT, backed by a Cursor agent
running with the original engineer's `.cursor/` config and target repo.

## 2. Background

HW engineers have organically encoded daily workflows into Cursor workspaces:

- `.cursor/skills/`  — distilled procedures (test gen, result analysis, …)
- `.cursor/rules/`   — domain guidance and constraints
- `.cursor/mcp.json` — tool integrations (lab gear, internal services, …)
- The target repo    — code, data, golden references

Today these workspaces live on one engineer's laptop. We want each workspace
to be a deployable, web-accessible service.

## 3. Architecture

```
[ Engineer's browser + NVIDIA SSO ]
              │
              ▼  HTTPS
[ LibreChat — multi-user chat UI ]
              │
              ▼  POST /v1/chat/completions   model="hw-test-gen-v1"
[ Cursor Adapter Service  (Node/TS)  ◄── this is what we build ]
              │
              ▼  @cursor/sdk
[ Cursor Agent Worker Pool ]
              │
              ▼  cwd = /workspaces/hw-test-gen-v1
[ .cursor/skills + .cursor/rules + .cursor/mcp.json + RO repo mount ]
              │
              ▼
[ Cursor runtime  →  Cursor API ]
```

**Key mapping:** one deployed skill = one workspace directory = one "custom
model" entry in LibreChat's model selector.

## 4. Tech Stack (decisions made)

| Component        | Choice                                   | Why                                                                                       |
|------------------|------------------------------------------|-------------------------------------------------------------------------------------------|
| Chat UI          | **LibreChat**                            | Multi-user, SSO/LDAP/OIDC, RBAC, native custom OpenAI endpoint support, MCP, MIT license. |
| Adapter language | TypeScript on Node 22+                   | Cursor SDK is TS-native.                                                                  |
| Cursor SDK       | `@cursor/sdk` (public beta, Apr 29 2026) | Cleaner than the CLI for programmatic conv control (`Agent.create` / `Agent.resume`).     |
| Conv state store | Redis (MVP) / SQLite (single-node)       | Map LibreChat conversation IDs → Cursor agent IDs.                                        |
| Container        | Docker Compose (MVP), k8s later          | Fast iteration first.                                                                     |
| Reference code   | `anyrobert/cursor-api-proxy`             | Borrow SSE translation logic. **Rebuild on the SDK, not the CLI.**                        |

**Explicitly rejected:**

- *OpenHands Agent Canvas* — 9 stars, README warns "sandbox phase, may be
  vibecoded," and its file-explorer / terminal / browser-panel UX is the
  wrong shape for "ask a skill a question" chat.
- *Cursor cloud runtime* — data residency risk for NVIDIA HW IP. MVP uses
  local runtime; production target is self-hosted runtime on internal infra.

## 5. Phase 1 (MVP) — target: 2 weeks

**Definition of done:** one engineer opens LibreChat in a browser, picks
`hw-test-gen-v1` from the model dropdown, asks a question, sees a streamed
reply that demonstrably used the Cursor workspace's skills and repo context,
and can continue the conversation across 3+ turns.

Concrete deliverables:

1. Docker-Composed LibreChat + adapter + Redis, runnable with one command.
2. `librechat.yaml` registers one custom endpoint pointing at the adapter.
3. Adapter exposes:
   - `GET  /v1/models`             — lists deployed skills.
   - `POST /v1/chat/completions`   — OpenAI-compatible, supports `stream: true`.
4. One sample skill `hw-test-gen-v1` with a trivial `.cursor/` config and a
   placeholder repo, used purely for plumbing validation.
5. Conversation continuity via `Agent.resume`.

## 6. Repository Layout (to create)

```
cursor-as-a-service/
├── docker-compose.yml
├── librechat.yaml                # custom endpoint config
├── .env.example
├── adapter/
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── src/
│       ├── index.ts              # HTTP entry
│       ├── routes/
│       │   ├── chat-completions.ts
│       │   └── models.ts
│       ├── cursor/
│       │   ├── agent-pool.ts     # Cursor agent lifecycle
│       │   └── sse-translator.ts # Cursor events → OpenAI SSE
│       ├── skills/
│       │   └── registry.ts       # model-name → workspace-dir resolver
│       └── state/
│           └── conv-store.ts     # convId ↔ cursorAgentId (Redis)
├── workspaces/
│   └── hw-test-gen-v1/           # sample skill for MVP
│       ├── manifest.json
│       ├── .cursor/
│       │   ├── skills/
│       │   ├── rules/
│       │   └── mcp.json
│       └── repo/                 # read-only mount target
├── docs/
│   ├── ARCHITECTURE.md           # keep updated as we learn
│   └── SKILL_MANIFEST.md         # spec for how engineers ship workspaces
└── README.md
```

## 7. Adapter Surface (initial sketch — adjust as you learn)

```typescript
// POST /v1/chat/completions
//
// Pipeline per request:
//   1. Resolve `body.model` → SkillEntry via SkillRegistry. 404 if unknown.
//   2. Derive a stable conversation key (LibreChat passes one; fall back to
//      hashing the message array's first user message + user id).
//   3. agent = await agentPool.getOrResume(convKey, skill)
//   4. run   = await agent.send(lastUserMessage.content)
//   5. If stream=true: for await (event of run.stream()) → OpenAI SSE chunk.
//      Else: collect and return a single OpenAI Chat Completion object.
//   6. Persist convKey ↔ agent.id mapping on completion.

interface SkillEntry {
  modelName: string;        // "hw-test-gen-v1"
  workspaceDir: string;     // absolute path
  description: string;
  owner: string;
  cursorModel?: string;     // default: "composer-2"
}

interface SkillRegistry {
  list(): SkillEntry[];                       // backs GET /v1/models
  resolve(modelName: string): SkillEntry | null;
}

interface AgentPool {
  getOrResume(convKey: string, skill: SkillEntry): Promise<Agent>;
  release(convKey: string): Promise<void>;
  // Idle eviction: 24h TTL on inactive agents.
}
```

OpenAI SSE chunk shape to emit:

```
data: {"id":"...","object":"chat.completion.chunk","created":<ts>,
       "model":"hw-test-gen-v1",
       "choices":[{"index":0,"delta":{"content":"..."},"finish_reason":null}]}

...

data: [DONE]
```

## 8. Conversation Continuity

On every chat turn:

- **Known convKey** → `Agent.resume({ apiKey, agentId })` + `agent.send(latest)`.
- **New convKey**   → `Agent.create({ apiKey, local: { cwd: skill.workspaceDir },
                                   model: { id: skill.cursorModel ?? "composer-2" } })`
  then `agent.send(latest)`, then persist mapping.

`agentId` is whatever `Agent.create` returns (check the SDK — read the types
in `node_modules/@cursor/sdk` after install).

## 9. Bootstrap Tasks — execute in order

> Do these one at a time. After each, pause and report status before moving on.

1. **Environment check.** Print versions of: `node`, `npm`, `docker`, `docker
   compose`, `git`. If `node` < 22 or Docker is missing, stop and report.
2. **Verify Cursor credentials.** Confirm `CURSOR_API_KEY` is present in the
   environment (or in a `.env` file you can read). If not, stop and ask.
3. **Create the repo skeleton** from §6. Initialize git. First commit:
   "chore: scaffold repo".
4. **Pull LibreChat reference config.** Clone
   `https://github.com/danny-avila/LibreChat` into a sibling dir (not inside
   our repo). Read its `librechat.example.yaml` to understand custom-endpoint
   syntax. Do **not** copy the whole repo in.
5. **Write our `librechat.yaml`** with one custom endpoint targeting
   `http://adapter:8080/v1`, exposing model `hw-test-gen-v1`. No real API
   key needed — the adapter ignores it for now.
6. **Scaffold the adapter.** In `adapter/`:
   ```
   npm init -y
   npm i @cursor/sdk express ioredis zod pino
   npm i -D typescript @types/node @types/express tsx vitest
   npx tsc --init
   ```
   Pin `@cursor/sdk` to an exact version in `package.json` — it's beta.
7. **Read the reference proxy.** Skim
   `https://github.com/anyrobert/cursor-api-proxy`, especially the SSE
   handling. Note the patterns. We will *not* depend on it — we re-implement
   on `@cursor/sdk` for programmatic control.
8. **Implement `GET /v1/models`** against a file-system-backed
   `SkillRegistry` that reads `workspaces/*/manifest.json`. Return the
   OpenAI Models list shape.
9. **Build the sample workspace** at `workspaces/hw-test-gen-v1/`. The
   `.cursor/rules` can be a short string ("You are a HW test generation
   expert. When asked, draft SystemVerilog stimuli with clear assertions
   …"). The `repo/` can be a tiny placeholder with one README. This is
   *only* for plumbing; real engineers will replace it.
10. **Non-streaming completion first.** Implement `POST /v1/chat/completions`
    without `stream`: create agent, await full run, return one OpenAI
    response. Smoke test with `curl`.
11. **Add streaming.** Translate `run.stream()` events into OpenAI SSE chunks.
    Terminate with `data: [DONE]`. Smoke test with `curl --no-buffer`.
12. **Add Redis-backed conv mapping.** Use `Agent.resume` on subsequent turns.
    Test continuity across 3 turns.
13. **Compose it.** `docker-compose up` brings up LibreChat + adapter + Redis.
    End-to-end test from the browser.
14. **Document surprises** in `docs/ARCHITECTURE.md` — anything the SDK,
    LibreChat, or the reference proxy did differently than this doc assumed.
    These notes feed Phase 2.

## 10. Constraints & Things To Flag Early

- **Data residency.** Cursor cloud runtime is OUT for NVIDIA HW IP. MVP
  uses local runtime on the dev host. Production target is *self-hosted
  Cursor runtime* (Enterprise SKU — confirm we have it) or local runtime
  on internal infra. Block Phase 2 on this decision.
- **Cursor API key model.** MVP uses a single shared `CURSOR_API_KEY`.
  Production needs per-skill or per-user keys for cost attribution.
- **`@cursor/sdk` is public beta** (released Apr 29 2026). API may shift.
  Pin the version. If something in this doc contradicts the actual SDK
  types you see after install, **trust the SDK and update this doc.**
- **Read-only repo mount.** MVP can `chmod -R a-w workspaces/*/repo/`.
  Production uses Docker `:ro` volumes.
- **MCP servers.** Cursor SDK auto-loads `.cursor/mcp.json` from `cwd`.
  Adapter does not need to handle MCP routing.
- **Mobile note.** The operator is on mobile while supervising. Keep status
  reports short; lead with the answer.

## 11. Out of Scope (Phase 1)

- SSO. LibreChat local auth is fine for the MVP.
- Multi-tenancy, per-user quotas.
- Self-hosted Cursor runtime.
- Worker pool / concurrent-agent scaling — single-process is fine for pilot.
- Audit logging beyond structured `pino` logs.
- Engineer-facing UI for uploading their own workspaces — that's Phase 3
  (workspace-manifest CI pipeline).

## 12. Key References

- **LibreChat repo:** https://github.com/danny-avila/LibreChat
- **LibreChat config docs:** https://www.librechat.ai/docs/configuration/librechat_yaml
- **Cursor SDK docs:** https://cursor.com/docs/api/sdk/typescript
- **Cursor SDK announcement:** https://cursor.com/blog/typescript-sdk
- **Cursor cookbook (examples):** https://github.com/cursor/cookbook
- **Reference proxy:** https://github.com/anyrobert/cursor-api-proxy
- **Inspiration only, do not use:** https://github.com/OpenHands/agent-canvas

## 13. First Action

Start with **Task #1: environment check**. Do not begin writing code until
tasks 1 and 2 both pass. If either fails, report and wait.
