# Libre-Cursor-Repo-Chat

Cursor-as-a-Service: expose Cursor workspaces (`.cursor/` config + a
target repo) as multi-user chat skills inside LibreChat.

**Status:** Phase 1 done (feature-complete workspace-as-a-service:
rules, skills, MCP, with TDD coverage and bracketed evals). Phase 2
not yet scoped — see [`docs/PHASE2.md`](docs/PHASE2.md) for the
inherited backlog.

## Where to read

- [`CLAUDE.md`](CLAUDE.md) — original project kickoff & rules of the road
- [`docs/PLAN.md`](docs/PLAN.md) — multi-phase plan (live)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it runs today
- [`docs/PHASE1.md`](docs/PHASE1.md) — Phase 1 narrative (frozen)
- [`docs/PHASE2.md`](docs/PHASE2.md) — Phase 2 scaffold + handoff
- [`docs/CONTEXT.md`](docs/CONTEXT.md) — doc lifecycle (read before
  editing PLAN.md / PHASE\*.md / ARCHITECTURE.md)
- [`adapter/test/README.md`](adapter/test/README.md) — testing conventions
  (`.spec.md` discipline, unit / integration / eval layers)

## Prerequisites

- Docker + `docker compose`
- Node 22+ (only for running the eval suite from the host;
  the adapter itself ships in a container)
- A `CURSOR_API_KEY` (the adapter reads this from `.env`)
- *Optional:* an `OREILLY_MCP_TOKEN` if you want the O'Reilly Books
  MCP eval (`C1`) to run; it skips cleanly when absent

## Run it

```bash
# 1. one-time
cp .env.example .env
#    - paste your CURSOR_API_KEY
#    - (optional) paste your OREILLY_MCP_TOKEN
#    - regenerate the four LibreChat secrets:
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "CREDS_KEY=$(openssl rand -hex 32)"
echo "CREDS_IV=$(openssl rand -hex 16)"

git submodule update --init --recursive    # fetches the three real workspace repos

# 2. bring up the stack (LibreChat + adapter + Mongo)
docker compose up -d

# 3. open http://localhost:3080, register an account, pick
#    "Cursor Workspaces" from the endpoint dropdown, choose any
#    skill (cmu-genai-v1, cmu-llm-systems-v1, cursor-cookbook-v1, …).
```

That's it. Adding a new workspace later is a manifest + `docker compose
restart adapter`; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#adding-a-workspace).

## Tests

```bash
cd adapter

npm test            # unit + integration   (27 tests, ~1.2s, no network)
npm run test:evals  # live evals           (6 tests, ~80s, hits Cursor + optional MCP)
npm run typecheck   # tsc --noEmit
```

Eval suite requires the adapter container running and the env vars
sourced (`source ../.env` before invoking, or use `--env-file`).

## Project conventions

This repo uses a **phase-based documentation lifecycle**. Before you edit
`docs/PLAN.md`, `docs/PHASE*.md`, or `docs/ARCHITECTURE.md`, read
[`docs/CONTEXT.md`](docs/CONTEXT.md) — it explains why each doc exists,
which is live vs frozen, and the order in which they update at phase
boundaries.

This repo also uses a **TDD discipline with feature spec docs**. Every
non-trivial feature gets a `<feature>.spec.md` next to its
implementation (the RED-phase artifact, written before failing tests).
See [`adapter/test/README.md`](adapter/test/README.md) for the full
convention.
