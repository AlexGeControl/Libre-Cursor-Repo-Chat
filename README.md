# Libre-Cursor-Repo-Chat

Cursor-as-a-Service exploration: expose Cursor workspaces (`.cursor/`
config + a target repo) as multi-user chat skills inside LibreChat.

Phase 0 plumbing is up: `LibreChat ↔ cursor-api-proxy ↔ Cursor CLI ↔
workspace`. Phase 1 (own adapter on `@cursor/sdk`) is the next milestone.

## Where to read

- [`CLAUDE.md`](CLAUDE.md) — original project kickoff & rules of the road
- [`docs/PLAN.md`](docs/PLAN.md) — multi-phase plan (live)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it runs today
- [`docs/PHASE0.md`](docs/PHASE0.md) — Phase 0 narrative & lessons
- [`docs/PHASE1.md`](docs/PHASE1.md) — Phase 1 scaffold
- [`docs/CONTEXT.md`](docs/CONTEXT.md) — doc lifecycle (read before
  editing PLAN.md / PHASE\*.md / ARCHITECTURE.md)

## Prerequisites

- Node 22+
- Docker + `docker compose`
- Cursor agent CLI: `curl https://cursor.com/install -fsS | bash`
- A `CURSOR_API_KEY` (the proxy and the spawned CLI both read this from `.env`)
- A clone of [`anyrobert/cursor-api-proxy`](https://github.com/anyrobert/cursor-api-proxy)
  as a sibling directory, with the one-line patch from
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#cursor-api-proxy-is-patched-in-place)
  applied

## Run it

```bash
cp .env.example .env   # then fill in CURSOR_API_KEY and regenerate the LibreChat secrets

git submodule update --init --recursive    # fetches workspaces/cmu-genai-v1/repo

# build the proxy once, in the sibling cursor-api-proxy/ checkout
( cd ../cursor-api-proxy && npm install && npm run build )

# start the proxy on the host (kept running in its own terminal)
env PATH="$HOME/.local/bin:$PATH" \
    CURSOR_API_KEY=$(grep CURSOR_API_KEY .env | cut -d= -f2) \
    CURSOR_BRIDGE_HOST=0.0.0.0 \
    CURSOR_BRIDGE_PORT=8765 \
    CURSOR_BRIDGE_WORKSPACE=$PWD/workspaces/cmu-genai-v1/repo \
    CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=false \
    CURSOR_BRIDGE_MODE=ask \
    node ../cursor-api-proxy/dist/cli.js

# bring up LibreChat
docker compose up -d

# open http://localhost:3080, register an account, pick the
# "Cursor (CMU GenAI)" endpoint, and chat.
```

## Project conventions

This repo uses a phase-based documentation lifecycle. Before you edit
`docs/PLAN.md`, `docs/PHASE*.md`, or `docs/ARCHITECTURE.md`, read
[`docs/CONTEXT.md`](docs/CONTEXT.md) — it explains why each doc exists,
which is live vs frozen, and the order in which they update at phase
boundaries.
