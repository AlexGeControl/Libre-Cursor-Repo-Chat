# LibreChat widget → config-key map

> Visual walk-through of the LibreChat UI, tagged by config key.
> Every widget on screen is one of: **yaml-toggle** (set in
> `librechat.yaml`), **env-toggle** (set in `.env` / docker-compose),
> **asset-overlay** (replace a file at a known path), **capability**
> (gated by endpoint configuration, not by `interface:`), or
> **unconditional** (no toggle — needs a fork to hide). Source
> citations are paths under `/home/yaoge/Workspace/LibreChat`.

Companion: [`mockup.html`](./mockup.html) — open in a browser to
play with the same widgets interactively.

## Layout map

```
┌───────────────────────────────┬───────────────────────────────────────────────────────┐
│  Left sidebar                 │  Top bar                                              │
│                               ├───────────────────────────────────────────────────────┤
│  • New Chat                   │  Center (Landing or Thread)                           │
│  • Search (env: SEARCH)       │                                                       │
│  • Chat history list          │    • Greeting (interface.customWelcome)               │
│                               │    • Thread / messages                                │
│  • Bookmarks   bookmarks      │                                                       │
│  • Prompts     prompts.use    │  Composer                                             │
│  • Memories    memories       │    • Attach (capability, no key)                      │
│  • Agents      agents.use     │    • Tools dropdown  (aggregator — see below)         │
│  • Skills      skills.use     │    • Send                                             │
│  • MCP         mcpServers.use │                                                       │
│  • Files       (unconditional)│  Footer (env: CUSTOM_FOOTER)                          │
│  • Parameters  parameters     │                                                       │
└───────────────────────────────┴───────────────────────────────────────────────────────┘
```

## Sidebar (left)

| # | Widget | Config key | Source | Notes |
|---|---|---|---|---|
| 1 | "+ New Chat" button | none — MVP-permanent | `client/src/components/Nav/NewChat.tsx` | No toggle exists. |
| 2 | Conversation search bar | env: `SEARCH` (also requires Meilisearch reachable) | `api/server/routes/search.js:11` | Env-only. Set `SEARCH=false` to remove and skip Meilisearch dep. |
| 3 | Chat history list | none — MVP-permanent | `client/src/components/Nav/Nav.tsx` | No toggle. |
| 4 | Bookmarks panel | yaml: `interface.bookmarks` | `useSideNavLinks.ts:173-181` | Boolean. |
| 5 | Prompts panel | yaml: `interface.prompts.use` | `useSideNavLinks.ts` (permission gate via `hasAccessToPrompts`) | `{use, create}` sub-flags. |
| 6 | Memories panel | yaml: `interface.memories` | `useSideNavLinks.ts` (`hasAccessToMemories`) | Boolean. |
| 7 | Agents panel (builder) | yaml: `interface.agents.use` | `useSideNavLinks.ts` (`hasAccessToAgents`) | Also removes Agents endpoint from the model selector when `false`. |
| 8 | Skills panel | yaml: `interface.skills.use` | `useSideNavLinks.ts` (`hasAccessToSkills`) | `{use, create}`. |
| 9 | MCP Builder panel | yaml: `interface.mcpServers.{use,create}` | `useSideNavLinks.ts` | The per-user MCP server manager. Separate from global `mcpServers:` block. |
| 10 | **Files panel** | **none — unconditional** | `useSideNavLinks.ts:173-180` (the `links.push({...id:'files'...})` block runs unconditionally) | **Cannot be hidden via config.** A fork would remove the `links.push` call. |
| 11 | Parameters panel (sliders) | yaml: `interface.parameters` + endpoint must be `isParamEndpoint` and have a key | `useSideNavLinks.ts:182-194` | Hides the *panel* but not the values on the wire — see `dropParams` for wire-level suppression. |

## Top bar

| # | Widget | Config key | Source | Notes |
|---|---|---|---|---|
| 1 | Model selector | yaml: `interface.modelSelect` (keep `true` for MVP) | `client/src/components/Chat/Menus/Endpoints/EndpointsMenu.tsx` | Two-level menu (endpoint → model id) when more than one model exists. Endpoint allow-list comes from env `ENDPOINTS`. |
| 2 | Presets menu | yaml: `interface.presets` | `Header.tsx:56-66` | Saved parameter / model bundles a user can pick. Useless for us — we control models server-side via manifests. |
| 3 | Bookmark menu (chat-level) | yaml: `interface.bookmarks` (same key as the sidebar panel) | `Header.tsx:67-73` | Bookmark current thread. |
| 4 | "+ Multi-Conversation" | yaml: `interface.multiConvo` | `Header.tsx:74-76` | Spawns side-by-side threads with different models for comparison. Useful for benchmarking; off by default for our MVP. |
| 5 | Temporary Chat toggle | yaml: `interface.temporaryChat` | `Header.tsx:77` | "Incognito" chat — not persisted to MongoDB. Useful for sensitive prompts; safe to hide. |
| 6 | Export & Share menu | partly env: `ALLOW_SHARED_LINKS` | `Header.tsx:62`, `routes/share.js:18-25` | The menu shell always renders; only the *Share-link* item inside is env-gated. Plain JSON/markdown export remains. **No yaml or env hides the whole menu.** |

## Central view — Landing (empty thread)

| # | Widget | Config key | Source | Notes |
|---|---|---|---|---|
| 1 | Greeting (large headline) | yaml: `interface.customWelcome` (otherwise auto time-of-day greeting + user name) | `Landing.tsx:67-138` | Plain text + `{{user.name}}` substitution. No markdown. |
| 2 | Endpoint icon / sub-header | none | `Landing.tsx` | Auto-derived from the selected endpoint. |
| 3 | "Privacy Policy" link | yaml: `interface.privacyPolicy.externalUrl` | `Footer.tsx` | Appears in the footer when set. |
| 4 | "Terms of Service" link | yaml: `interface.termsOfService.externalUrl` | `Footer.tsx` | Same. |

## Central view — Composer (input area)

| # | Widget | Config key | Source | Notes |
|---|---|---|---|---|
| 1 | Text input box | none — MVP-permanent | `ChatForm.tsx` | |
| 2 | Attach-file button (paperclip) | **capability**, not `interface:` — gated by endpoint's `capabilities` array | `ChatForm.tsx:348`, `AttachFileChat.tsx` | This is the *upload* button, distinct from the sidebar Files panel and from `fileCitations`. To hide, set endpoint capabilities so file upload is not advertised; for our custom endpoint we don't declare upload capability, so it stays grayed-out / hidden. |
| 3 | "Tools" dropdown | aggregator — see breakdown below | `ToolsDropdown.tsx:28-58` | Dropdown only renders if at least one tool is accessible. |
| 3a |  ↳ Code Interpreter row | yaml: `interface.runCode` | `ToolsDropdown.tsx` (`canRunCode`) | |
| 3b |  ↳ Web Search row | yaml: `interface.webSearch` | `ToolsDropdown.tsx` (`canUseWebSearch`) | |
| 3c |  ↳ File Search row | yaml: `interface.fileSearch` | `ToolsDropdown.tsx` (`canUseFileSearch`) | |
| 3d |  ↳ Skills row | yaml: `interface.skills.use` | `ToolsDropdown.tsx` (`canUseSkills`) | |
| 3e |  ↳ MCP Servers row | yaml: `interface.mcpServers.use` | `ToolsDropdown.tsx` (`canUseMcp`) | |
| 3f |  ↳ Artifacts row | none — Cursor adapter doesn't emit artifacts | `ToolsDropdown.tsx` (`artifactsEnabled`) | The row appears for agent endpoints that have artifacts capability; our custom endpoint doesn't. |
| 4 | Send / Stop button | none — MVP-permanent | `ChatForm.tsx` | |

## Footer (bottom strip)

| # | Widget | Config key | Source | Notes |
|---|---|---|---|---|
| 1 | Footer text ("LibreChat v0.8.6-rc1 - Every AI for Everyone") | env: `CUSTOM_FOOTER` | `Footer.tsx:28-33`, `routes/config.js:96-97` | Default is `[LibreChat <version>](https://librechat.ai) - <i18n 'com_ui_latest_footer'>`. The slogan "Every AI for Everyone" is the localized i18n string. Set `CUSTOM_FOOTER="..."` to replace; supports markdown links and `\|` separators. |
| 2 | Privacy Policy link | yaml: `interface.privacyPolicy.externalUrl` | `Footer.tsx` | |
| 3 | Terms of Service link | yaml: `interface.termsOfService.externalUrl` | `Footer.tsx` | |
| 4 | Browser tab title | env: `APP_TITLE` | `routes/config.js:45`, `useAppStartup.ts:52-57` | Default `'LibreChat'`. Pre-hydration flash visible briefly because `client/index.html:11` hardcodes `<title>LibreChat</title>`. |

## Branding assets

| # | Asset | How to override | Source |
|---|---|---|---|
| 1 | Auth-screen logo | bind-mount over `client/dist/assets/logo.svg` from host | `AuthLayout.tsx:65` — only logo in the React tree (chat shell is wordmark-free). |
| 2 | Favicons | bind-mount over `client/dist/assets/favicon-{16,32}x{16,32}.png` and `apple-touch-icon-180x180.png` | `client/index.html:11-14` — hardcoded `<link>` tags pointing at `/assets/`. |
| 3 | Theme colors | **No `customCSS` hook in v0.8.6-rc1** — fork-only. Edit `client/src/style.css:69-191` (CSS variables) and `client/tailwind.config.cjs:75-87` (green ramp). Rebuild image. | ~20-30 lines across 2 files. |

**Correction (2026-05-17, end-of-Phase-2 ratchet):** an earlier
draft of this table pointed at `client/public/assets/` based on
`client/vite.config.ts:131` (`publicDir: false` at build time).
That's misleading for the upstream
`ghcr.io/danny-avila/librechat:latest` image — it bakes
`public/assets/` into `dist/assets/` at image-build time, and the
static handler (`api/server/index.js:138-140`) serves `dist`
first. The active mount path is **`dist/assets/`**, verified live.
See [`../PHASE2.md`](../PHASE2.md) → Slice 2 finding.

## Per-request behavior (wire-level)

These are not widgets; they shape what the adapter receives.

| Config | Effect | Source |
|---|---|---|
| yaml: `endpoints.custom[].dropParams: ["temperature", ...]` | Strips named fields from the outbound request body before it leaves LibreChat. | `transform.ts:114-127` |
| yaml: `endpoints.custom[].addParams: {...}` | Adds named fields. Runs *before* `dropParams`, so `dropParams` wins if there's overlap. | `transform.ts:94-127` |
| yaml: `endpoints.custom[].headers: {...}` | Custom HTTP headers (we already use this for `X-LibreChat-Conversation-Id`). Supports `{{LIBRECHAT_BODY_<FIELD>}}` substitution for `conversationId`, `messageId`, `parentMessageId`. | `packages/api/src/utils/env.ts` |
| yaml: `endpoints.custom[].models.fetch` | LibreChat polls `/v1/models` on the upstream and uses the result as the model list — so adding a workspace doesn't need a yaml edit. | `EndpointService.js` |
| yaml: `endpoints.custom[].titleConvo` + `titleModel` | After the first user/assistant exchange, LibreChat sends a "summarize this in 5 words" prompt to `titleModel` to title the thread. The resulting completion lands back in the same Cursor agent's history (known mild contamination — see PHASE1.md "title-gen contamination"). | |

## Endpoint allow-list (which providers appear in the selector)

| Config | Effect | Source |
|---|---|---|
| env: `ENDPOINTS=custom` | Restricts the selector to custom endpoints only (hides OpenAI, Anthropic, Google, Bedrock, Agents catalog, Plugins). | `parsers.ts:70-92` |
| yaml: `interface.agents.use: false` | Belt-and-suspenders: removes Agents endpoint from the selector even if `ENDPOINTS` isn't set. | `useEndpoints.ts:60-76` |

## Known immovable surfaces (fork-only)

These widgets appear regardless of config. Hiding them needs a code
change to the LibreChat image.

- **Sidebar Files panel** — `useSideNavLinks.ts:173-180`.
- **Export & Share menu shell** — always rendered by
  `Header.tsx:62-79`. Individual items (notably *Share*) are
  env-gated, but the menu itself is not.
- **Per-message Edit / Continue / Regenerate buttons** — no
  `interface:` keys exist for these.
- **Pre-hydration browser tab title** ("LibreChat" flash before
  React mounts) — `client/index.html:11` hardcodes it.

## Schema version note

Our `librechat.yaml` declares `version: 1.3.5`; upstream example is
on `1.3.11`. The version string is unenforced
(`config.ts:1339` — `version: z.string()`), so every key referenced
here is accepted at 1.3.5. The cosmetic startup warning ("Outdated
Config version") is fixed by bumping the string; bump when
convenient, not required for any feature in this map.
