# Architecture — current state

> Manual for the system as it runs today. For why it's shaped this
> way, see [`PLAN.md`](PLAN.md) and the relevant `PHASE[N].md`. For
> how this doc is maintained, see [`CONTEXT.md`](CONTEXT.md).

## Pipeline

```
Browser
  │
  ▼  HTTP localhost:3080
LibreChat API  (docker container "librechat-api")
  │
  ▼  POST /v1/chat/completions   baseURL=http://adapter:8080/v1
  │  + headers: X-LibreChat-Conversation-Id, X-LibreChat-Message-Id,
  │             X-LibreChat-Parent-Message-Id
  │
Cursor adapter  (docker container "cursor-adapter", Fastify + @cursor/sdk@1.0.7)
  │  ├─ /v1/models      — driven by workspaces/*/manifest.json
  │  └─ /v1/chat/completions:
  │        SQLite lookup: convKey → cursorAgentId
  │        ├─ hit  → Agent.resume(agentId)  + agent.send(lastMsg)
  │        └─ miss → Agent.create()         + agent.send(rehydration|lastMsg)
  │
  ▼  @cursor/sdk@1.0.7 (pinned exact)
Cursor API
```

One LibreChat custom-endpoint entry = one adapter service. Today
that's `Cursor Workspaces` → `http://adapter:8080/v1`. The adapter
itself serves multiple workspaces ("skills") from a single process,
each discovered from `workspaces/<id>/manifest.json`.

## Services

| Service          | Where               | Port | Notes                                |
|------------------|---------------------|------|--------------------------------------|
| LibreChat API    | docker `librechat-api` | 3080 | The browser-facing UI                |
| Cursor adapter   | docker `cursor-adapter` | 8080 | OpenAI-compatible Cursor bridge      |
| MongoDB          | docker `librechat-mongo` | —    | LibreChat state; internal only       |

Defined in [`../docker-compose.yml`](../docker-compose.yml). All three
services live on the default compose network and reach each other by
service name (`adapter`, `mongodb`, etc.).

## Adapter surface

### `GET /health`

```json
{ "ok": true, "skills": 5, "workspacesDir": "/app/workspaces",
  "stateDir": "/app/.run/adapter" }
```

### `GET /v1/models`

OpenAI-shape list of skills, one per `workspaces/*/manifest.json`.
LibreChat auto-fetches this when `models.fetch: true` in
`librechat.yaml`, so adding a workspace doesn't require config edits
on the LibreChat side.

### `POST /v1/chat/completions`

OpenAI-compatible chat completions, both streaming (`stream: true`,
SSE) and non-streaming. Dispatch flow on every request:

1. Derive `convKey = ${body.user}:${X-LibreChat-Conversation-Id}`.
2. Look up convKey → cursorAgentId in SQLite.
3. If found and skill matches:
   - `Agent.resume(agentId)` → `agent.send(lastUserMessage)`.
   - On `UnknownAgentError` (resume- OR send-time): delete mapping,
     fall through to create.
4. Otherwise: `Agent.create()` → if `messages.length > 1`, send a
   rehydration prompt built from the LibreChat transcript; else send
   the latest message bare.
5. On success: `convStore.put` (create) or `convStore.touch` (resume).

Other errors (auth, network) propagate as `500` — never silently
masquerade as "agent expired."

## Workspace manifest schema

Each workspace lives at `workspaces/<id>/` with a `manifest.json`:

```json
{
  "schema_version": 1,
  "id": "cmu-genai-v1",
  "display_name": "Cursor (CMU GenAI)",
  "description": "...",
  "owner": "yaoge",
  "workspace_dir": "./repo",
  "cursor_model": "gpt-5.5-extra-high-fast",
  "mode": "ask"
}
```

`workspace_dir` is relative to the manifest file. The agent's cwd
when serving requests for this skill is the resolved path. The
manifest's directory may also contain `.cursor/rules/`,
`.cursor/skills/`, and `.cursor/mcp.json` — see "Workspace
configuration" below.

## Workspace configuration (`.cursor/`)

Per CLAUDE.md §2, a deployed workspace can bring three flavors of
user-configurable context:

| Surface | Loaded via | Owner config |
|---|---|---|
| Rules — `<repo>/.cursor/rules/*.mdc` | `local.settingSources: ["project"]` (passed by the adapter) | Frontmatter `description`, `globs`, `alwaysApply` |
| Skills — `<repo>/.cursor/skills/<name>/SKILL.md` | same | Frontmatter `name`, `description` |
| MCP — `<repo>/.cursor/mcp.json` | **adapter loads explicitly** (see "Operational gotchas") | `mcpServers` map; HTTP or stdio servers |

The adapter exposes these to the Cursor agent on every `Agent.create`
or `Agent.resume`. `${ENV_VAR}` placeholders in `mcp.json` headers
are expanded against `process.env` before handoff — that's how the
O'Reilly MCP server gets its token without committing it.

## LibreChat UI configuration

The user-facing chat UI is locked down to the MVP surface via
`librechat.yaml` and a small set of env vars. For the full catalog
of options (and what each widget maps to), see
[`LibreChat/`](LibreChat/). Below is the operational summary —
what's wired today, why, and how to extend it.

### `interface:` block (yaml-driven UI lockdown)

`librechat.yaml` declares an explicit `interface:` block that turns
off every sidebar panel and top-bar control outside the MVP. Only
`modelSelect: true` and `bookmarks: true` remain on, plus the
chat-history sidebar and input composer (which have no toggles).
All five composer "Tools" rows (`runCode`, `webSearch`,
`fileSearch`, `skills.use`, `mcpServers.use`) are `false`, so the
Tools dropdown itself disappears.

Two widgets are fork-only and still visible: the **Files** sidebar
panel and the **Export menu** shell. Both are tracked in
[`PHASE3.md`](PHASE3.md) for the eventual UI fork.

### `dropParams` (wire-level param suppression)

The Cursor adapter's upstream model (default
`gpt-5.5-extra-high-fast`) rejects sampling params with a 4xx. The
custom endpoint in `librechat.yaml` lists them in `dropParams`:

```yaml
dropParams:
  - "temperature"
  - "top_p"
  - "presence_penalty"
  - "frequency_penalty"
  - "max_tokens"
  - "stop"
  - "user"
```

Upstream consume site:
`packages/api/src/endpoints/openai/transform.ts:114-127` deletes
each named field from the outbound body after defaults are applied
but before the HTTP call is built. This is orthogonal to
`interface.parameters: false` — that key hides the slider UI but
does **not** strip the values from the request. Both keys are
required: `dropParams` for correctness, `interface.parameters:
false` so the user doesn't see sliders that have no effect.

### Branding env vars

| Env var | Value | What it controls |
|---|---|---|
| `APP_TITLE` | `AIOF Agentic Engineer` | Browser tab title (dynamic, post-mount) |
| `CUSTOM_FOOTER` | `Agentic Engineer for SCG Efficiency - Applied AI Team` | Footer text (replaces upstream `[LibreChat <ver>] - Every AI for Everyone`) |
| `HELP_AND_FAQ_URL` | `https://nvidia.glean.com` | In-app Help & FAQ link target |
| `ALLOW_SHARED_LINKS` | `true` | Share-link UI in the Export menu + `/share/...` route |
| `SEARCH` | `false` | Conversation-search bar in the sidebar + `/api/search` route (avoids the Meilisearch dep) |

### Brand asset overlay

`docker-compose.yml` mounts four files from `./brand/` into the api
container's **`dist/assets/`** (NOT `public/assets/`):

```yaml
- ./brand/logo.svg:/app/client/dist/assets/logo.svg:ro
- ./brand/favicon-16x16.png:/app/client/dist/assets/favicon-16x16.png:ro
- ./brand/favicon-32x32.png:/app/client/dist/assets/favicon-32x32.png:ro
- ./brand/apple-touch-icon-180x180.png:/app/client/dist/assets/apple-touch-icon-180x180.png:ro
```

The upstream `ghcr.io/danny-avila/librechat:latest` image bakes
`public/assets/` into `dist/assets/` at image-build time, and the
static handler serves `dist` first
(`api/server/index.js:138-140`). Mounting at `public/assets/`
alone is **silently ineffective** — see PHASE2.md → "Slice 2 — asset
overlay path" finding. The active path is `dist/assets/`.

`brand/logo.svg` is a Simple Icons NVIDIA glyph (MIT-licensed)
recolored to NVIDIA green `#76B900` on transparent. The three PNG
favicons are rasterized from it.

### Refreshing a brand asset

If you edit anything under `brand/`, **restart the api container**:

```bash
docker compose restart api
```

Docker bind-mounts on single files pin to the host inode.
Atomic-rename writes (which `Edit`/`Write`/most editors use) create
a new inode, breaking the mount — the container keeps serving the
old file until the next restart. Directory mounts don't have this
problem; single-file mounts do. To regenerate the PNGs from a
recolored SVG, use the running container's bundled `sharp` 0.33.5:

```bash
docker cp brand/logo.svg librechat-api:/tmp/logo.svg
docker exec librechat-api node -e "
const sharp = require('sharp'), fs = require('fs');
const svg = fs.readFileSync('/tmp/logo.svg');
for (const { size, out } of [
  { size: 16,  out: '/tmp/favicon-16x16.png' },
  { size: 32,  out: '/tmp/favicon-32x32.png' },
  { size: 180, out: '/tmp/apple-touch-icon-180x180.png' },
]) {
  const pad = Math.round(size * 0.12), inner = size - pad * 2;
  sharp(svg).resize(inner, inner, { fit:'contain', background:{r:0,g:0,b:0,alpha:0} })
    .extend({ top:pad, bottom:pad, left:pad, right:pad, background:{r:0,g:0,b:0,alpha:0} })
    .png().toFile(out);
}"
for f in favicon-16x16 favicon-32x32 apple-touch-icon-180x180; do
  docker cp librechat-api:/tmp/$f.png brand/$f.png
done
docker compose restart api
```

## Operating it

### First-run setup

Run these once per machine. None of them are repeated on daily startup.

```bash
# 1. clone this repo and fetch workspace submodules
git clone git@github.com:AlexGeControl/Libre-Cursor-Repo-Chat.git
cd Libre-Cursor-Repo-Chat
git submodule update --init --recursive

# 2. create .env from the template, then fill in real values
cp .env.example .env
#    - paste your Cursor API key into CURSOR_API_KEY
#    - paste OREILLY_MCP_TOKEN if you want the MCP eval to run
#    - regenerate the four LibreChat secrets:
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "CREDS_KEY=$(openssl rand -hex 32)"
echo "CREDS_IV=$(openssl rand -hex 16)"
# paste each output line over the placeholder in .env

# 3. (Linux only) confirm your shell session can talk to Docker
docker ps   # if "permission denied", you're in the docker group but
            # the current login hasn't picked it up — see Troubleshooting
```

### Daily startup

```bash
docker compose up -d
```

Three containers come up: `librechat-api` (UI on `:3080`),
`librechat-mongo` (internal), `cursor-adapter` (`:8080`).

Open <http://localhost:3080>, register a local account on first run,
then pick `Cursor Workspaces` from the model dropdown and choose any
listed workspace (`cmu-genai-v1`, `cmu-llm-systems-v1`,
`cursor-cookbook-v1`, …).

### Health checks

```bash
# adapter is up and pointed at the workspaces dir
curl -fsS http://127.0.0.1:8080/health | jq .

# adapter lists workspaces
curl -fsS http://127.0.0.1:8080/v1/models | jq '.data[].id'

# LibreChat is up
curl -sS -o /dev/null -w "librechat=%{http_code}\n" http://localhost:3080/

# LibreChat container can reach the adapter via compose DNS
docker exec librechat-api wget -qO- --timeout=5 http://adapter:8080/health
```

A one-shot chat round-trip against the adapter (no browser needed):

```bash
curl -sS -X POST http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"cmu-genai-v1","stream":false,
       "messages":[{"role":"user","content":"What is this repo about?"}]}'
```

### Stop and restart

```bash
docker compose down            # containers down, data preserved in .run/
docker compose down -v         # also drops anonymous volumes (rare)
docker compose restart adapter # rebuild not needed for adapter source changes —
                               # they're inside the image. Rebuild after deps
                               # or workspace manifest layout changes.
```

Rebuild the adapter image (after `package.json` edits, Dockerfile
edits, or source changes that need to ship inside the container):

```bash
docker compose build adapter
docker compose up -d adapter
```

Persistent state lives in `.run/`:

- `.run/mongo-data/` — LibreChat users, conversations, settings.
- `.run/librechat-uploads/` — file uploads from chats.
- `.run/librechat-logs/` — LibreChat application logs.
- `.run/adapter/conv-state.sqlite` — convKey → cursorAgentId mapping.

### Adding a workspace

```bash
# 1. add the repo (as a submodule or any other content)
mkdir -p workspaces/my-skill-v1/repo
# (populate workspaces/my-skill-v1/repo with content + optionally
#  .cursor/rules/, .cursor/skills/, .cursor/mcp.json)

# 2. write the manifest
cat > workspaces/my-skill-v1/manifest.json <<'JSON'
{
  "schema_version": 1,
  "id": "my-skill-v1",
  "display_name": "Cursor (My Skill)",
  "description": "...",
  "owner": "you",
  "workspace_dir": "./repo",
  "cursor_model": "gpt-5.5-extra-high-fast",
  "mode": "ask"
}
JSON

# 3. restart the adapter container so it rescans workspaces/
docker compose restart adapter

# 4. LibreChat picks it up automatically (models.fetch: true)
```

### Troubleshooting

**Adapter logs say `Ripgrep path not configured`.** Inside the
container this should never happen — the Dockerfile installs
`ripgrep` via apt. If you're running host-mode dev (`cd adapter && npm
start`), the SDK requires `rg` on PATH. The adapter auto-detects
the bundled `rg` from `~/.local/share/cursor-agent/versions/<v>/rg`
if cursor-agent CLI is installed.

**Adapter returns `404 unknown model: …`.** The model id in your
request doesn't match any `workspaces/*/manifest.json` → `id`. List
what the adapter sees: `curl -fsS http://127.0.0.1:8080/v1/models`.
Restart the adapter container if you just added a manifest.

**Adapter returns `500 Agent agent-... not found`.** A Cursor-side
agent was reaped while the SQLite mapping pointed at it. The adapter
catches this on retry — try the same request again, you'll hit the
create-path-with-rehydration. If it persists, inspect
`.run/adapter/conv-state.sqlite` for stale rows.

**LibreChat returns `{"message":"Illegal request"}` on `/api/agents/chat`.**
This is the `uaParser` middleware rejecting a non-browser User-Agent.
Browsers are fine; for `curl` smoke tests, pass a Chrome-shaped UA.

**LibreChat startup warns `Outdated Config version`.** Cosmetic.
`librechat.yaml` declares `version: 1.3.5` and upstream is on a
later schema. The config still loads. Bump when convenient.

**`docker ps` says `permission denied while trying to connect to the
Docker daemon socket`.** Your user is in the `docker` group
(`getent group docker`) but the current login predates that
membership. Log out and back in, or run docker via `sg docker -c
'<cmd>'`.

## Operational gotchas

Things that are required configurations. Removing any breaks the
system in non-obvious ways. The rationale for each lives in
[`PHASE1.md`](PHASE1.md).

### `@cursor/sdk` pinned to exact `1.0.7`

`package.json` declares `"@cursor/sdk": "1.0.7"` (no caret, no
range). Caret-pinning silently resolves to 1.0.13 which hits
`feature_unavailable` on `GET /v1/models` from inside `Agent.create`.
CI must use `npm ci` against a lockfile that resolves to 1.0.7
exactly; never run `npm update` against this dep without a re-spike.

### `local.settingSources: ["project"]`

The adapter passes this on every `Agent.create` / `Agent.resume`.
Without it the SDK boots a bare agent that doesn't load
`.cursor/rules/` or `.cursor/skills/` from the workspace —
**rules and skills silently no-op**.

### `.cursor/mcp.json` is loaded by the adapter explicitly

The `settingSources` toggle does NOT cover `mcp.json`. The adapter
reads the file, expands `${ENV_VAR}` placeholders against
`process.env`, and passes the result via the `mcpServers` SDK
option. Implementation in
[`../adapter/src/cursor/cursor-adapter.ts`](../adapter/src/cursor/cursor-adapter.ts)
→ `loadMcpServers`.

### `ripgrep` must be available

The SDK requires `rg` on PATH. The Docker image installs it via apt;
host-mode dev relies on the auto-detection helper in
[`../adapter/src/cursor/runtime.ts`](../adapter/src/cursor/runtime.ts).

### LibreChat body-field headers

The custom-endpoint config in `librechat.yaml` includes:

```yaml
headers:
  X-LibreChat-Conversation-Id: "{{LIBRECHAT_BODY_CONVERSATIONID}}"
  X-LibreChat-Message-Id:      "{{LIBRECHAT_BODY_MESSAGEID}}"
  X-LibreChat-Parent-Message-Id: "{{LIBRECHAT_BODY_PARENTMESSAGEID}}"
```

The `{{LIBRECHAT_BODY_<UPPERCASE>}}` placeholders are LibreChat's
built-in substitution. Without these, the adapter has no stable
conversationId to key its SQLite mapping on, and `Agent.resume`
becomes guesswork. See PHASE1.md "Slice 2c — LibreChat probe" for
the discovery story.

### Idle-agent sweeper

The adapter runs an in-process timer that drops `conv_agents` rows
older than `ADAPTER_IDLE_TTL_HOURS` (default 24) every
`ADAPTER_SWEEPER_INTERVAL_MIN` minutes (default 30). Tune via env
vars in `docker-compose.yml` if needed. Lazy GC: only the SQLite row
is dropped; Cursor reclaims server-side agent state on its own
schedule.

### Workspace data isolation is leaky-by-default

A Cursor agent's filesystem view extends beyond its declared cwd —
it can read the enclosing project tree, including `~/.cursor/chats/`
(per-host chat history) and sibling workspaces inside
`/app/workspaces/`. Tracked in [`PHASE3.md`](PHASE3.md) for
production hardening. For pilot use with one operator, acceptable;
for multi-user production, plan on per-agent containers or
namespaced cwds.

### `dropParams` is required for `gpt-5.5-extra-high-fast`

The custom-endpoint `dropParams` list in `librechat.yaml` strips
seven sampling fields (`temperature`, `top_p`,
`presence_penalty`, `frequency_penalty`, `max_tokens`, `stop`,
`user`) from outbound requests. The default model rejects these
with a 4xx — removing the `dropParams` block breaks every chat
turn. See "LibreChat UI configuration" above for the full
rationale.

### Brand assets mount at `dist/assets/`, not `public/assets/`

The upstream LibreChat image bakes `public/assets/` into
`dist/assets/` at build time, and the static handler serves `dist`
first. Bind-mounting at `public/assets/` is silently ineffective.
See "LibreChat UI configuration → Brand asset overlay" above.

### Single-file bind-mounts pin to inodes — restart on asset edit

Docker bind-mounts on individual files pin to host inodes. Any edit
that uses atomic rename (which `Edit`/`Write`/most editors do)
creates a new inode and breaks the mount; the container serves the
old file until restarted. After editing anything under `brand/`,
run `docker compose restart api`. Directory mounts don't have this
problem.

## Repo layout

```
.
├── CLAUDE.md                # project kickoff doc + agent rules of the road
├── README.md                # human-facing entry point
├── docker-compose.yml       # LibreChat + Mongo + adapter
├── librechat.yaml           # live LibreChat config (interface + custom endpoint)
├── librechat.yaml.example   # annotated reference (every researched key)
├── .env                     # secrets (gitignored)
├── .env.example             # schema of .env (annotated)
├── brand/                   # NVIDIA logo + favicons mounted into LibreChat (see "LibreChat UI configuration")
├── docs/
│   ├── CONTEXT.md           # doc lifecycle (read before editing other docs)
│   ├── PLAN.md              # multi-phase plan
│   ├── PHASE0.md            # Phase 0 narrative (frozen)
│   ├── PHASE1.md            # Phase 1 narrative (frozen)
│   ├── PHASE2.md            # Phase 2 narrative (frozen — MVP hardening)
│   ├── PHASE3.md            # Phase 3 scaffold (inherited open questions)
│   ├── ARCHITECTURE.md      # this file
│   ├── LibreChat/           # widget-map + config-reference + interactive mockup
│   └── mcp/oreilly.md       # MCP integration guide
├── adapter/                 # the Cursor adapter (Fastify + @cursor/sdk@1.0.7)
│   ├── Dockerfile
│   ├── package.json
│   ├── src/                 # production code (each module ships a .spec.md)
│   │   ├── index.ts
│   │   ├── routes/
│   │   ├── cursor/          # SDK boundary + rehydration + MCP loader
│   │   ├── skills/          # manifest registry
│   │   └── state/           # SQLite conv store + sweeper
│   └── test/                # 94 tests (cursor + routes + state + skills + evals)
│       ├── README.md        # TDD conventions (.spec.md + 3-layer pyramid)
│       ├── cursor/          # unit tests
│       ├── routes/          # integration tests
│       ├── state/           # mixed
│       ├── skills/          # integration (real-fs fixtures)
│       ├── evals/           # eval tests (live adapter)
│       └── support/         # fakes, fixtures
├── workspaces/
│   ├── cmu-genai-v1/             # CMU 10-X23 GenAI (submodule + manifest)
│   ├── cmu-llm-systems-v1/       # CMU 11868 LLM Systems (submodule + manifest)
│   ├── cursor-cookbook-v1/       # Cursor SDK cookbook (submodule + manifest)
│   ├── context-mgmt-eval-v1/     # configured eval workspace (rules+skills+MCP)
│   └── context-mgmt-eval-bare-v1/ # bare eval twin (no .cursor/)
└── .run/                    # gitignored runtime state
    ├── mongo-data/
    ├── librechat-{uploads,logs,images}/
    └── adapter/conv-state.sqlite
```

## Limits known today

- Single shared Cursor account; no per-user cost attribution.
- No SSO; LibreChat local auth only.
- `usage.*` token counts in adapter responses are heuristics
  (`completion_chars ÷ 4`); real attribution will come from Cursor's
  usage API when we wire it.
- Cross-workspace agent visibility — see "Workspace data isolation"
  in operational gotchas.
- Title-gen contamination — LibreChat's titleConvo flow resumes the
  same Cursor agent with a "summarize for title" prompt, which
  enters the agent's history. Not visibly broken but worth tracking.

## See also

- [`PHASE1.md`](PHASE1.md) — narrative for everything that's
  load-bearing above.
- [`../adapter/test/README.md`](../adapter/test/README.md) — testing
  conventions, including the `.spec.md` discipline.
- [`mcp/oreilly.md`](mcp/oreilly.md) — O'Reilly MCP integration
  reference.
