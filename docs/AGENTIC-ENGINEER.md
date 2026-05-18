# Agentic Engineer — one-page explainer

> **Audience:** NVIDIA HW infra engineers, the operator's manager, anyone
> seeing the LibreChat dropdown for the first time. If you're a
> developer working on the adapter, the technical entry point is
> [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What an agentic engineer is

An **agentic engineer** is a teammate persona you can chat with in
this app and **delegate rote farm work to** — test command
generation, failure analysis, next-step action drafting. Each one is
backed by a real engineer's Cursor workspace: their rules, their
skills, their MCP tool integrations, and a repo full of their
context.

Same UX as ChatGPT, but instead of a generic LLM you get a teammate
with one HW engineer's distilled know-how on call 24/7.

The framing is **delegate, not replace**. The engineer who built the
workspace is still the source of truth; the agentic engineer just
handles the rote work on their behalf, at scale, across the org.

## How it maps to Cursor primitives

The product is a thin re-positioning of three Cursor surfaces an
engineer is already curating in their `.cursor/` directory:

| Cursor primitive | What it does | What the agentic engineer inherits |
|---|---|---|
| `.cursor/rules/*.mdc` | Domain guidance — "always X", "when asked about Y, Z" | The teammate's judgment calls and house style |
| `.cursor/skills/<name>/SKILL.md` | Distilled procedures — "to do X, run these steps" | The teammate's playbooks for recurring tasks |
| `.cursor/mcp.json` | Tool integrations — lab gear, internal services, search | The teammate's hands and eyes outside the chat |
| The target `repo/` | Code, data, golden references | The teammate's working memory |

Add one of these and the agentic engineer can do that work for the
team. The originating engineer keeps editing `.cursor/` to keep the
teammate's behavior fresh.

## Why role-shaped ids

Workspaces live under `workspaces/<id>/manifest.json` and surface in
the LibreChat dropdown by `id`. We name them in a **role + persona +
version** shape:

| Pattern | Example | What it signals |
|---|---|---|
| `engineer-<persona>-v<n>` | `engineer-genai-mentor-v1` | A delegatable teammate — the *primary* product surface |
| `eval-<topic>-v<n>` | `eval-context-mgmt-configured-v1` | A synthetic fixture used by the eval suite — not for end-user chat (cosmetically visible in the dropdown until a `hidden: true` flag lands) |

The `-v1` suffix lets a maintainer ship a v2 alongside v1 — same
persona, new rules/skills — without disturbing in-flight conversations
keyed against v1. Bump the version when behavior changes deliberately;
edit in place when the change is a refinement of the same persona.

The naming is a soft convention enforced by no validator. The
adapter doesn't care what the id looks like — but the dropdown
audience does, and "agentic engineer" reads on first sight.

## Where it lands in the UI

- **Endpoint label** (top of model selector): "Agentic Engineers"
- **Model id** in the dropdown: `engineer-<persona>-v<n>`
- **Display name** (rendered alongside the id):
  human-readable persona — "GenAI Fundamentals Mentor",
  "LLM Systems Mentor", "Cursor SDK Guide", …

Picking one in the dropdown opens a chat thread against that
agentic engineer. Each subsequent turn resumes the same underlying
Cursor agent (server-side memory survives across turns), so the
conversation feels continuous — just like messaging a coworker.

## Cross-references

- [`CLAUDE.md`](../CLAUDE.md) — project mission (top of file)
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — how the system actually runs
- [`PHASE3.md`](PHASE3.md) — Slice 1 scope that introduced this framing
- [`LibreChat/`](LibreChat/) — UI configuration reference
