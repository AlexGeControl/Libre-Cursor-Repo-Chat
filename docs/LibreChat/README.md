# LibreChat configuration — reference for this project

> Distilled from the upstream LibreChat source at sibling clone
> `../LibreChat` (version `v0.8.6-rc1`, exact match to the container
> we run). Findings are source-grounded; every claim cites a
> `file:line` in the sibling repo.

This folder is the curated map between LibreChat's `librechat.yaml`
(+ a small set of env vars) and the widgets a user actually sees in
the browser. The goal is to let the operator pick a UI surface
deliberately — enable one widget at a time, verify it works
end-to-end with the Cursor adapter, then expose it to NVIDIA users.

## Files

- **[`widget-map.md`](./widget-map.md)** — the visual walk-through.
  Sidebar / top bar / central view / footer, with each widget tagged
  by its config key. Read this first.
- **[`config-reference.md`](./config-reference.md)** — alphabetical
  reference for each yaml key + env var: type, default, source
  citation, and a one-paragraph description of what it does.
- **[`mockup.html`](./mockup.html)** — single-file interactive
  mock-up. Open in a browser; toggle each key on/off in the right-
  side panel and watch the corresponding widget appear/disappear.
  Widgets are labeled with their config key name (not their
  user-facing label) so you can map config to UI at a glance.

## How this maps to our project

The MVP we're shipping to NVIDIA HW infra engineers needs only:
model dropdown (a custom endpoint exposing our workspaces), the
chat thread, the input box, and conversation history. Everything
else hides on day one and gets re-enabled deliberately as we vet
each surface.

The proposed Phase-2 config that hides everything outside MVP lives
in [`../PHASE2.md`](../PHASE2.md) (LibreChat config hardening slice,
when scheduled). This folder is the *reference* for that work — it
explains what each toggle does without committing to any particular
configuration.

## Source provenance

All `file:line` references in this folder point at
`/home/yaoge/Workspace/LibreChat` (the sibling read-only clone).
The container in `docker-compose.yml` runs the same upstream tag
(`v0.8.6-rc1`), so references are live for the running system. When
LibreChat is bumped, re-verify these citations before trusting them.

Key load-bearing files in the upstream codebase:

- `packages/data-provider/src/config.ts` — the zod schema for
  `librechat.yaml`. The `interfaceSchema` (lines ~898-1029) is the
  source of truth for what yaml keys exist.
- `packages/data-schemas/src/app/interface.ts` — how the yaml
  `interface:` block is merged with permission defaults at boot.
- `client/src/hooks/Nav/useSideNavLinks.ts` — sidebar panels.
- `client/src/components/Chat/Header.tsx` — top bar.
- `client/src/components/Chat/Landing.tsx` — central greeting.
- `client/src/components/Chat/Footer.tsx` — footer.
- `client/src/components/Chat/Input/ToolsDropdown.tsx` — composer
  tools menu.
- `api/server/routes/config.js` — the `/api/config` endpoint that
  serves env-var-derived fields like `appTitle` and `customFooter`
  to the frontend.

## Quick verdict per area

| Area | Configurability |
|---|---|
| Sidebar panels (Bookmarks / Prompts / Memories / Agents / Skills / MCP / Parameters) | yaml `interface:` keys, all togglable |
| Sidebar Files panel | **No toggle** — unconditional in source (fork-only) |
| Top-bar buttons (Presets / Multi-Convo / Temporary Chat) | yaml `interface:` keys |
| Composer tools dropdown | aggregated from `runCode` / `webSearch` / `fileSearch` / `skills` / `mcpServers` |
| Composer attach-file button | endpoint capability, not yaml |
| Welcome greeting | yaml `interface.customWelcome` |
| App title (browser tab + header) | env var `APP_TITLE` |
| Footer text | env var `CUSTOM_FOOTER` |
| Logo / favicon | docker bind-mount, no yaml |
| Theme colors (e.g. NVIDIA green) | **Fork-only** — no `customCSS` hook exists |
| Endpoint allow-list (hide non-Cursor endpoints) | env var `ENDPOINTS` |
| Share button | env var `ALLOW_SHARED_LINKS` |
| Conversation search bar | env var `SEARCH` |
| Per-request param suppression (e.g. drop `temperature`) | yaml `endpoints.custom[].dropParams` |

See [`widget-map.md`](./widget-map.md) for the full breakdown and
[`config-reference.md`](./config-reference.md) for individual
option details.
