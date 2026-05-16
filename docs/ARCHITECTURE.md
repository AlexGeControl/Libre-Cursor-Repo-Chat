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

## Operating it

### First-run setup

Run these once per machine. None of them are repeated on daily startup.

```bash
# 1. clone this repo and fetch the workspace submodule
git clone git@github.com:AlexGeControl/Libre-Cursor-Repo-Chat.git
cd Libre-Cursor-Repo-Chat
git submodule update --init --recursive

# 2. install the Cursor agent CLI (puts `agent` in ~/.local/bin)
curl -fsS https://cursor.com/install | bash

# 3. clone cursor-api-proxy as a SIBLING directory (not inside this repo)
( cd .. && git clone https://github.com/anyrobert/cursor-api-proxy.git )

# 4. apply the in-place patch (see "cursor-api-proxy is patched in
#    place" below for rationale). The change is one line:
sed -i 's|if (effectiveChatOnly) args.push("--trust");|args.push("--trust");|' \
    ../cursor-api-proxy/src/lib/agent-cmd-args.ts

# 5. build the proxy
( cd ../cursor-api-proxy && npm install && npm run build )

# 6. create .env from the template, then fill in real values
cp .env.example .env
# - paste your Cursor API key into CURSOR_API_KEY
# - regenerate the four LibreChat secrets:
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "CREDS_KEY=$(openssl rand -hex 32)"
echo "CREDS_IV=$(openssl rand -hex 16)"
# paste each output line over the placeholder in .env

# 7. (Linux only) confirm your shell session can talk to Docker
docker ps   # if "permission denied", you're in the docker group but
            # the current login hasn't picked it up — see Troubleshooting
```

### Daily startup

Two long-running processes: the proxy on the host, and the LibreChat
compose stack. Order doesn't matter, but the proxy must be reachable
before you start a chat in the browser.

```bash
# terminal 1 — proxy, kept in foreground for the verbose log
env PATH="$HOME/.local/bin:$PATH" \
    CURSOR_API_KEY=$(grep CURSOR_API_KEY .env | cut -d= -f2) \
    CURSOR_BRIDGE_HOST=0.0.0.0 \
    CURSOR_BRIDGE_PORT=8765 \
    CURSOR_BRIDGE_WORKSPACE=$PWD/workspaces/cmu-genai-v1/repo \
    CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=false \
    CURSOR_BRIDGE_MODE=ask \
    CURSOR_BRIDGE_VERBOSE=true \
    node ../cursor-api-proxy/dist/cli.js

# terminal 2 — LibreChat (detached)
docker compose up -d
```

Open <http://localhost:3080>, register a local account on first run,
then pick `Cursor (CMU GenAI)` from the model dropdown.

### Health checks

Before chatting, verify each hop:

```bash
# proxy is up and pointed at the right workspace
curl -fsS http://127.0.0.1:8765/health | jq .

# proxy can reach Cursor and list models
curl -fsS http://127.0.0.1:8765/v1/models | jq '.data | length'

# LibreChat is up
curl -sS -o /dev/null -w "librechat=%{http_code}\n" http://localhost:3080/

# LibreChat container can reach the proxy (the most common failure)
docker exec librechat-api sh -c \
  "wget -qO- --timeout=5 http://host.docker.internal:8765/health"
```

A one-shot chat round-trip (no browser needed) confirms the full path:

```bash
curl -sS -X POST http://127.0.0.1:8765/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"composer-2-fast","messages":[{"role":"user","content":"In one sentence, what is this repo about?"}]}'
```

### Stop and restart

```bash
# stop the proxy: Ctrl-C in its terminal, or:
pkill -f "cursor-api-proxy/dist/cli.js"

# stop LibreChat
docker compose down            # containers down, data preserved in .run/
docker compose down -v         # also drops anonymous volumes (rare)

# wipe local state and start over (destructive!)
rm -rf .run/                   # mongo data, LibreChat uploads, proxy log
```

Persistent state lives in `.run/`:

- `.run/mongo-data/` — LibreChat users, conversations, settings.
- `.run/librechat-uploads/` — file uploads from chats.
- `.run/librechat-logs/` — LibreChat application logs.
- `.run/proxy.log` — only present if you've redirected the proxy with `>`.

### Troubleshooting

Failure modes hit during Phase 0, with the actual fix:

**Proxy log says `Workspace Trust Required`.** The patch isn't applied,
or `npm install` in the proxy checkout reverted `dist/`. Re-run step 4
of First-run setup, then `npm run build`.

**Proxy log says `Your team administrator has disabled the 'Run
Everything' option`.** `CURSOR_BRIDGE_FORCE=true` is set somewhere in
your env. Unset it — `--force` is blocked for this account and you
don't need it; `--trust` is sufficient.

**Container says `FAILED` against `host.docker.internal:8765/health`,
but `curl 127.0.0.1:8765/health` works on the host.** The proxy is
bound to loopback. Restart it with `CURSOR_BRIDGE_HOST=0.0.0.0`.

**`curl http://127.0.0.1:8765/health` returns from the *old* proxy
after you restart, and `force:` / workspace path still look stale.**
Two processes own port 8765 — the new one logged `Port 8765 is already
in use` and exited. `pkill -f cursor-api-proxy/dist/cli.js`, confirm
with `ss -ltn | grep 8765`, then start again.

**`docker ps` says `permission denied while trying to connect to the
Docker daemon socket`.** Your user is in the `docker` group
(`getent group docker`) but the current login shell predates that
membership. Either log out and back in, or for a single-shell
workaround run docker via `sg docker -c '<cmd>'`.

**LibreChat returns `{"message":"Illegal request"}` on `/api/agents/chat`.**
This is the `uaParser` middleware rejecting a non-browser User-Agent.
Browsers are fine; for `curl` smoke tests, pass
`-H 'User-Agent: Mozilla/5.0 ...'`.

**LibreChat startup warns `Outdated Config version`.** Cosmetic.
`librechat.yaml` declares `version: 1.3.5` and upstream is on 1.3.11.
The config still loads. Bump when convenient.

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
