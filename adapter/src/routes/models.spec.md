# GET /v1/models route

> **Feature spec** for [`src/routes/models.ts`](./models.ts).
> **Executable spec:** [`test/routes/models.test.ts`](../../test/routes/models.test.ts).
>
> This is the RED-phase artifact: read it first to understand the
> feature, read the tests for exhaustive cases, read the
> implementation only when you need to know *how* the contract is met.

## Purpose

LibreChat (and any OpenAI-compatible chat client) populates its model
dropdown by hitting `GET /v1/models` on the configured endpoint. The
adapter has to advertise its deployed skills as if they were models so
each skill appears as a selectable entry in the UI.

This route is a thin projection over the `Skill[]` array passed at
plugin-registration time — the registry loader (`src/skills/registry.ts`)
already discovered, validated, and sorted the skills. The route does
not re-read the filesystem and does not re-sort.

## Contract

```ts
export const models: FastifyPluginAsync<{ skills: Skill[] }>
```

**Plugin options:**
- `skills` — array of `Skill` (validated, in caller-determined order).
  Treated as the source of truth for the duration of the plugin's life;
  the route does not refresh it.

**Route:** `GET /v1/models`

**Response (200, `application/json`):** OpenAI list envelope.

```json
{
  "object": "list",
  "data": [
    {
      "id": "<skill.id>",
      "object": "model",
      "created": 0,
      "owned_by": "cursor-as-a-service",
      "display_name": "<skill.display_name>",
      "description": "<skill.description>"
    }
  ]
}
```

**Invariants:**
- Envelope shape is always `{ object: "list", data: <array> }` — even
  for zero skills (then `data: []`).
- Each `data[i]` has `object: "model"` (literal string) and
  `created: 0` (we don't track upload time per skill).
- `owned_by` is the literal `"cursor-as-a-service"` for every entry.
- Order of `data` matches order of `opts.skills` exactly — no sort
  here; sorting is the registry loader's job.
- The route does not authenticate; LibreChat's custom-endpoint config
  may send a bearer header but we accept anything.

## Behavior

Each row corresponds 1:1 to a test case in the test file, in the same
order. **When you add a behavior, append a row here AND add the
matching test.**

| # | Scenario | Expected |
|---|----------|----------|
| 1 | `skills: []` | `200`, body `{ object: "list", data: [] }` |
| 2 | one skill | `200`, body has one item with exact field shape: `id`, `object: "model"`, `created: 0`, `owned_by: "cursor-as-a-service"`, `display_name`, `description` |
| 3 | multiple skills | `data` length equals input length; order preserved verbatim (route does not re-sort) |
| 4 | response `Content-Type` | `application/json` (Fastify default for object returns) |
| 5 | only the fields in the contract are projected | route maps from `Skill` → OpenAI model item; extra `Skill` fields like `workspace_dir`, `cursor_model`, `owner`, `manifest_path` do NOT leak |

## Edge cases discovered post-implementation

> Append-only log of behaviors learned after the test suite first went
> green — usually during smoke tests or in production. Each entry:
> date, what we found, what changed (if anything).

_(none yet)_

## Related

- **Implementation:** [`src/routes/models.ts`](./models.ts)
- **Tests:** [`test/routes/models.test.ts`](../../test/routes/models.test.ts)
- **Upstream of order guarantee:** [`src/skills/registry.ts`](../skills/registry.ts) — sorts skills by id ascending before they reach this route
- **Consumer:** LibreChat custom-endpoint model picker (see `librechat.yaml`)
- **Background:** [`docs/PHASE1.md`](../../../docs/PHASE1.md)
