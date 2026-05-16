# Architecture — current state

> Manual for the system as it runs today. For why it's shaped this way,
> see [`PLAN.md`](PLAN.md) and the relevant `PHASE[N].md`. For how this
> doc is maintained, see [`CONTEXT.md`](CONTEXT.md).

## Pipeline

```
Browser
  │
  ▼  HTTP localhost:3080
LibreChat API  (docker container "librechat-api")
   │
   ▼  POST /v1/chat/completions   baseURL=http://host.docker.internal:8765/v1
cursor-api-proxy  (host process on :8765, bound 0.0.0.0)
   │  spawns: agent --print --trust --mode ask --workspace <abs> --model <id>
   ▼
Cursor agent CLI  (host)
   │  cwd = workspaces/cmu-genai-v1/repo
   ▼
Cursor API
```

One LibreChat "custom endpoint" entry = one workspace = one proxy
process (today). Currently exactly one: `Cursor (CMU GenAI)` →
`workspaces/cmu-genai-v1/repo`.

## Services

| Service       | Where               | Port | Notes                              |
|---------------|---------------------|------|------------------------------------|
| LibreChat API | docker container    | 3080 | `librechat-api`                    |
| MongoDB       | docker container    | —    | `librechat-mongo`, internal only   |
| cursor-api-proxy | host node process | 8765 | bound `0.0.0.0`, see below         |
| cursor agent CLI | host              | —    | spawned per request by the proxy   |

Bring everything up:

```bash
# host: start the proxy (kept running)
env PATH="$HOME/.local/bin:$PATH" \
    CURSOR_API_KEY=$(grep CURSOR_API_KEY .env | cut -d= -f2) \
    CURSOR_BRIDGE_HOST=0.0.0.0 \
    CURSOR_BRIDGE_PORT=8765 \
    CURSOR_BRIDGE_WORKSPACE=$PWD/workspaces/cmu-genai-v1/repo \
    CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=false \
    CURSOR_BRIDGE_MODE=ask \
    CURSOR_BRIDGE_VERBOSE=true \
    node ../cursor-api-proxy/dist/cli.js

# host: bring up LibreChat (in another terminal)
docker compose up -d
# UI: http://localhost:3080
```

## Operational gotchas

These are required configurations. Removing any of them breaks the
system in non-obvious ways. The rationale for each lives in
[`PHASE0.md`](PHASE0.md).

### `cursor-api-proxy` is patched in place

`cursor-api-proxy/src/lib/agent-cmd-args.ts` is patched to **always**
pass `--trust` to the agent CLI, not only in chat-only mode. The
upstream proxy assumes `--force` will cover real-workspace mode, but
`--force` is admin-disabled on this Cursor account. Re-apply this patch
after any `npm install` in the proxy directory.

The change is one line — replace `if (effectiveChatOnly) args.push("--trust");`
with `args.push("--trust");`.

### `CURSOR_BRIDGE_HOST=0.0.0.0` is required

The default `127.0.0.1` is unreachable from the LibreChat container via
`host.docker.internal`. Bind `0.0.0.0` and rely on host firewall rules
if you don't want the proxy on your LAN.

### `CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=false` is required

Otherwise the agent runs in an empty tempdir and can't see the
workspace. With this set to `false`, the proxy passes
`--workspace <abs path>` to the CLI.

### `CURSOR_BRIDGE_MODE=ask`

Read-only. The CLI can grep/index the repo but cannot edit it. If a
future phase wants the agent to *write* into a workspace, this becomes
`agent` mode, and the workspace should be a scratch dir, not the source
repo.

### Cursor CLI authentication

The proxy spawns `agent` with `CURSOR_API_KEY` from the env. The key
lives in `.env` (gitignored). The same key is used for all sessions —
no per-user attribution yet.

### LibreChat secrets

`JWT_SECRET`, `JWT_REFRESH_SECRET`, `CREDS_KEY`, `CREDS_IV` in `.env`
are this deployment's secrets. `.env.example` documents the shape with
placeholders; regenerate real values for any new deployment.

## Conversation continuity

There isn't any, in the strict sense. The proxy spawns a fresh `agent`
per request and re-receives the full conversation history from
LibreChat each turn. From the user's point of view it feels continuous;
from the agent's point of view every turn is a new agent that happens
to have read the prior transcript.

Phase 1 will replace this with real `Agent.resume` semantics in a
custom adapter — see [`PHASE0.md`](PHASE0.md#continuity-is-librechat-replaying-full-history-not-agent---resume)
and [`PHASE1.md`](PHASE1.md).

## Repo layout

```
.
├── CLAUDE.md             # project kickoff doc (historical task list in §9–§11)
├── README.md             # human-facing entry point
├── docker-compose.yml    # LibreChat + Mongo
├── librechat.yaml        # one custom endpoint per workspace
├── .env                  # secrets (gitignored)
├── .env.example          # schema of .env
├── docs/
│   ├── CONTEXT.md        # doc lifecycle (read before editing other docs)
│   ├── PLAN.md           # multi-phase plan
│   ├── PHASE0.md         # Phase 0 narrative (frozen)
│   ├── PHASE1.md         # Phase 1 scaffold (current)
│   └── ARCHITECTURE.md   # this file
├── workspaces/
│   └── cmu-genai-v1/
│       └── repo/         # CMU 10-X23 GenAI, as a git submodule
└── .run/                 # gitignored runtime state (proxy log, mongo data)
```

`adapter/` is in CLAUDE.md §6 but does not exist yet — Phase 1
deliverable.

## Limits known today

- One workspace per proxy process.
- Single shared Cursor account; no per-user cost attribution.
- No SSO; LibreChat local auth only.
- `usage.*` token counts in the OpenAI-shape responses are heuristics
  (chars ÷ 4), not real billing data.
- Workspace must be marked trusted by the proxy patch — adding new
  workspaces will need the same trust handling.
