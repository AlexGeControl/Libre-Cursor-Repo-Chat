# Libre-Cursor-Repo-Chat

Cursor-as-a-Service for NVIDIA HW infra: turn Cursor workspaces
(`.cursor/` config + a target repo) into **agentic engineers** —
teammate personas inside LibreChat that engineers can delegate rote
farm work to. See [`docs/AGENTIC-ENGINEER.md`](docs/AGENTIC-ENGINEER.md)
for the one-page explainer.

**Status:** Phases 1 and 2 done; **Phase 3 Slice 1 (re-orientation
from "Cursor Skill Workspace" to "Agentic Engineer")** landed
2026-05-18 — code identifiers, workspace ids, and the user-facing
endpoint label all read in the agentic-engineer register. 94
deterministic adapter tests + 4/4 deterministic evals (2 MCP evals
gated on optional `OREILLY_MCP_TOKEN`). Phase 3 continues — next slice
TBD; see [`docs/PHASE3.md`](docs/PHASE3.md) for the inherited backlog.

## Where to read

- [`CLAUDE.md`](CLAUDE.md) — original project kickoff & rules of the road
- [`docs/AGENTIC-ENGINEER.md`](docs/AGENTIC-ENGINEER.md) — one-page product explainer
- [`docs/PLAN.md`](docs/PLAN.md) — multi-phase plan (live)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it runs today
- [`docs/PHASE0.md`](docs/PHASE0.md), [`PHASE1.md`](docs/PHASE1.md), [`PHASE2.md`](docs/PHASE2.md) — frozen phase narratives
- [`docs/PHASE3.md`](docs/PHASE3.md) — Phase 3 live doc (Slice 1 findings + inherited backlog)
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
#    "Agentic Engineers" from the endpoint dropdown, choose any
#    agentic engineer (engineer-genai-mentor-v1,
#    engineer-llm-systems-mentor-v1, engineer-cursor-sdk-guide-v1, …).
```

That's it. Adding a new workspace later is a manifest + `docker compose
restart adapter`; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#adding-a-workspace).

## Tests

```bash
cd adapter

npm test            # unit + integration   (94 tests, ~1.2s, no network)
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
