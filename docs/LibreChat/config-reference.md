# LibreChat config reference

> Alphabetical reference for each `librechat.yaml` key and `.env`
> variable that affects the user-visible UI or wire behavior.
> Companion to [`widget-map.md`](./widget-map.md). Source citations
> point at `/home/yaoge/Workspace/LibreChat` (`v0.8.6-rc1`).
>
> Most-recently-touched canonical schema:
> `packages/data-provider/src/config.ts` (the `interfaceSchema` ~898-1029
> and `endpointSchema` ~600-680).

## Conventions

- **Type** column uses TypeScript-ish shorthand. `bool` = boolean,
  `{use, create}` = an object with sub-flags.
- **Default** column lists what happens if the key is omitted.
  *"omitted = permission-default"* means the loader keeps the field
  `undefined` and the runtime falls back to the role's permission
  grant in `roles.ts` — for a fresh install that's usually "enabled".
  **Set the field explicitly to `false` to actually turn it off.**
- **Where** column points at the field's schema definition or the
  consume site.

## `interface:` block — yaml UI toggles

### `interface.modelSelect`
- **Type:** `bool`
- **Default:** `true` (omitted = permission-default = grant)
- **Effect:** Shows / hides the top-bar model selector. Keep `true`
  for our MVP — without it the user can't pick a workspace.
- **Where:** `config.ts:903`

### `interface.customWelcome`
- **Type:** `string`
- **Default:** unset → time-of-day greeting + user name (e.g.
  "Good Evening, Yao") from `Landing.tsx:78-138`.
- **Effect:** Replaces the auto greeting on an empty thread.
  Supports the `{{user.name}}` template token (and *only* that —
  no markdown, no other tokens).
- **Where:** `config.ts:907`; render: `Landing.tsx:67-76`.

### `interface.parameters`
- **Type:** `bool`
- **Default:** permission-default (typically true)
- **Effect:** Sidebar **Parameters** panel (temperature / top-p /
  max-tokens sliders). **Hiding the panel does not strip the values
  from the request body** — use `endpoints.custom[].dropParams` for
  wire-level suppression. The two settings are orthogonal.
- **Where:** `config.ts:910`; consume: `useSideNavLinks.ts:182-194`.

### `interface.presets`
- **Type:** `bool`
- **Default:** permission-default
- **Effect:** Top-bar **Presets** menu — saved parameter/model
  bundles a user can reapply. For our project, models are defined
  server-side via workspace manifests, so presets duplicate that
  layer; safe to disable.
- **Where:** `config.ts:912`; consume: `Header.tsx:56-66`.

### `interface.bookmarks`
- **Type:** `bool`
- **Default:** permission-default
- **Effect:** Sidebar **Bookmarks** panel + top-bar bookmark menu
  (single toggle controls both). Bookmarks are user-curated
  conversation tags.
- **Where:** `config.ts:914`; consume: `useSideNavLinks.ts:173-181`,
  `Header.tsx:67-73`.

### `interface.memories`
- **Type:** `bool`
- **Default:** permission-default
- **Effect:** Sidebar **Memories** panel. Long-term cross-thread
  user facts a model can reference. Cursor agents have their own
  per-agent memory; LibreChat's memories layer is orthogonal and
  not wired to the Cursor adapter, so safe to disable.
- **Where:** `config.ts:916`.

### `interface.multiConvo`
- **Type:** `bool`
- **Default:** permission-default
- **Effect:** Top-bar "+ Multi-Conversation" button — spawns
  side-by-side threads driven by different models, useful for
  benchmarking. Hidden for MVP to avoid raising expectations.
- **Where:** `config.ts:918`; consume: `Header.tsx:74-76`.

### `interface.temporaryChat`
- **Type:** `bool`
- **Default:** permission-default
- **Effect:** Top-bar "Temporary Chat" toggle — like a browser
  incognito tab, the thread is not persisted to MongoDB. Useful for
  sensitive prompts; safe to hide.
- **Where:** `config.ts:920`; consume: `Header.tsx:77`.

### `interface.prompts`
- **Type:** `{ use: bool, create: bool }`
- **Default:** permission-default for each sub-flag
- **Effect:** Sidebar **Prompts** panel (saved prompt library).
  `use: false` hides the panel; `create: false` allows reading but
  not creating new prompts.
- **Where:** `config.ts:922-928`.

### `interface.agents`
- **Type:** `{ use: bool, create: bool }`
- **Default:** permission-default
- **Effect:** Sidebar **Agents builder** panel **and** the Agents
  endpoint in the model selector. Setting `use: false` revokes the
  AGENTS permission, which `useEndpoints.ts:60-76` reads to drop
  Agents from the dropdown — so it's belt-and-suspenders with
  `ENDPOINTS=custom`.
- **Where:** `config.ts:930-937`.

### `interface.skills`
- **Type:** `{ use: bool, create: bool }`
- **Default:** permission-default
- **Effect:** Sidebar **Skills** panel (LibreChat's own skill
  framework — distinct from `.cursor/skills/`, which the Cursor
  adapter handles internally). Safe to hide; we ship skills via the
  workspace manifest, not via LibreChat.
- **Where:** `config.ts:939-946`.

### `interface.mcpServers`
- **Type:** `{ use: bool, create: bool }`
- **Default:** permission-default
- **Effect:** Sidebar **MCP Builder** panel (per-user MCP server
  manager). Separate from the global `mcpServers:` top-level yaml
  block. The Cursor adapter loads `.cursor/mcp.json` per workspace
  internally, so this UI is moot for our pilot.
- **Where:** `config.ts:948-955`.

### `interface.runCode`
- **Type:** `bool`
- **Default:** permission-default
- **Effect:** Adds a "Code Interpreter" row to the composer
  **Tools** dropdown. Doesn't affect the Cursor adapter (it has its
  own tool layer); safe to hide.
- **Where:** `config.ts:957`.

### `interface.webSearch`
- **Type:** `bool`
- **Default:** permission-default
- **Effect:** Adds a "Web Search" row to the **Tools** dropdown.
  Hidden for MVP — workspaces don't need it today.
- **Where:** `config.ts:959`.

### `interface.fileSearch`
- **Type:** `bool`
- **Default:** permission-default
- **Effect:** Adds a "File Search" row to the **Tools** dropdown
  (corpus search across user-uploaded files). Distinct from the
  composer's per-message attach. Hidden for MVP.
- **Where:** `config.ts:961`.

### `interface.fileCitations`
- **Type:** `bool`
- **Default:** permission-default
- **Effect:** Renders **inline citations inside assistant messages**
  when the upstream model returns sourced file references. **Not**
  the attach button; not the Files panel. Cursor doesn't return
  this shape, so the flag is functionally a no-op for us.
- **Where:** `config.ts:963`.

### `interface.peoplePicker`
- **Type:** `{ users: bool, groups: bool, roles: bool }`
- **Default:** permission-default
- **Effect:** RBAC-style sharing UI — picker for granting access to
  specific users / groups / roles. Hidden for MVP; LibreChat's
  local auth doesn't have groups.
- **Where:** `config.ts:965-971`.

### `interface.marketplace`
- **Type:** `{ use: bool }`
- **Default:** **explicitly `false` in the schema default** (one of
  the few that ships off).
- **Effect:** Agent marketplace. Off by default; leave it.
- **Where:** `config.ts:1005-1010`.

### `interface.remoteAgents`
- **Type:** `{ use: bool }`
- **Default:** **explicitly `false` in the schema default**
- **Effect:** Off by default; leave it.
- **Where:** `config.ts:1019-1021`.

### `interface.privacyPolicy`
- **Type:** `{ externalUrl: string, openNewTab: bool }`
- **Default:** unset → no link rendered
- **Effect:** Footer link. Open-new-tab is cosmetic.
- **Where:** `config.ts:980-987`.

### `interface.termsOfService`
- **Type:** `{ externalUrl: string, openNewTab: bool, modalAcceptance: bool, ... }`
- **Default:** unset → no link rendered
- **Effect:** Footer link, optionally gated by a "click to accept"
  modal on first login.
- **Where:** `config.ts:988-1003`.

## `endpoints.custom[]` — wire-level

These shape what the Cursor adapter receives. We already use
`apiKey`, `baseURL`, `headers`, `models`, `titleConvo`, `titleModel`.

### `dropParams`
- **Type:** `string[]`
- **Default:** unset → all sampling params land on the wire
- **Effect:** Removes named fields from the outbound request body
  *after* defaults are applied but *before* the HTTP call is built.
  Unit-tested upstream against `temperature` specifically.
- **Required for our setup:** `gpt-5.5-extra-high-fast` rejects
  `temperature` — list it here.
- **Where:** `config.ts:620`; consume: `transform.ts:114-127`.

### `addParams`
- **Type:** `Record<string, unknown>`
- **Default:** unset
- **Effect:** Injects named fields into the outbound body. Runs
  before `dropParams`, so the latter wins on conflicts. Useful if a
  future model needs a hard-coded `reasoning_effort: "high"` or
  similar.
- **Where:** `config.ts` (sibling field to `dropParams`); consume:
  `transform.ts:94-127`.

### `models.fetch`
- **Type:** `bool`
- **Default:** false
- **Effect:** If `true`, LibreChat hits `<baseURL>/v1/models` on
  boot and merges the response into the user-visible model list, so
  adding a workspace doesn't need a yaml edit + LibreChat restart.
  We already use this.
- **Where:** `config.ts` (endpoint schema); consume:
  `api/server/services/Config/loadCustomConfig.js`.

### `models.default`
- **Type:** `string[]`
- **Default:** unset
- **Effect:** Static fallback list when `fetch: false` or fetch
  fails. Worth keeping at least one valid model id here so a broken
  adapter doesn't leave the selector empty on boot.
- **Where:** same as above.

### `titleConvo` + `titleModel`
- **Type:** `bool`, `string` (model id)
- **Default:** `titleConvo: false`
- **Effect:** When `true`, after the first user/assistant exchange
  LibreChat sends a hidden "summarize this thread in 5 words"
  prompt to `titleModel` for thread auto-titling. This prompt
  enters the Cursor agent's history (known mild contamination —
  see [`../PHASE1.md`](../PHASE1.md) "title-gen contamination").
- **Where:** `config.ts` (endpoint schema); consume:
  `packages/api/src/agents/run.ts` and the title flow.

### `headers`
- **Type:** `Record<string, string>`
- **Default:** unset
- **Effect:** Custom HTTP headers forwarded to the upstream
  baseURL. Values support `{{LIBRECHAT_BODY_<FIELD>}}` substitution
  where `<FIELD>` is uppercase of an allowlisted body field
  (`conversationId`, `messageId`, `parentMessageId`). We use this to
  forward `X-LibreChat-Conversation-Id` so the adapter can build its
  convKey → cursorAgentId mapping. See PHASE1.md "Slice 2c — LibreChat
  probe".
- **Where:** `packages/api/src/utils/env.ts → resolveHeaders()`;
  allowlist: `ALLOWED_BODY_FIELDS = ['conversationId', 'parentMessageId', 'messageId']`.

## Env vars (`.env` / docker-compose)

These are env-only — no yaml equivalent.

### `APP_TITLE`
- **Default:** `'LibreChat'`
- **Effect:** Browser tab title (set dynamically by
  `useAppStartup.ts:52-57` after React mounts; the pre-mount flash
  shows the hardcoded `client/index.html:11` value).
- **Where:** `routes/config.js:45`.

### `CUSTOM_FOOTER`
- **Default:** unset → `[LibreChat <version>](https://librechat.ai) - <i18n com_ui_latest_footer>`
  (the "Every AI for Everyone" tagline).
- **Effect:** Replaces the entire footer text. Supports markdown
  links and `|` separators (each `|`-segment renders as a separate
  inline element with a vertical-bar separator between them).
- **Where:** `routes/config.js:96-97`; render: `Footer.tsx:28-93`.

### `HELP_AND_FAQ_URL`
- **Default:** `'https://librechat.ai'`
- **Effect:** URL behind the in-app "Help & FAQ" link.
- **Where:** `routes/config.js:76`.

### `ENDPOINTS`
- **Default:** unset → all built-in endpoints with API keys
  configured appear in the selector.
- **Effect:** Comma-separated allow-list of endpoint types. Set
  `ENDPOINTS=custom` for our MVP — hides OpenAI, Anthropic, Google,
  Bedrock, Plugins, and the built-in Agents catalog from the
  selector regardless of whether their keys are set.
- **Where:** `parsers.ts:70-92`.

### `ALLOW_SHARED_LINKS`
- **Default:** `true`
- **Effect:** Gates both the *Share* item in the Export menu and
  the `/share/...` route mount server-side. The Export menu *shell*
  still renders (with non-share export options); only the Share
  item disappears when `false`.
- **Where:** `routes/share.js:18-25`, `routes/config.js:15-18`.

### `SEARCH`
- **Default:** unset
- **Effect:** Gates the conversation-search bar (left sidebar) and
  the `/api/search` route. Requires Meilisearch when `true`. Set to
  `false` (or omit) for MVP to skip the search-engine dependency.
- **Where:** `routes/search.js:11`.

### `ALLOW_REGISTRATION`, `ALLOW_EMAIL_LOGIN`, `ALLOW_SOCIAL_LOGIN`
- **Default:** varies
- **Effect:** Out of scope for the UI map. Auth-layer toggles — see
  upstream `.env.example` if/when SSO becomes Phase-3 work.

## Asset overlays (docker bind-mount)

No yaml or env; replace the file at the path inside the container.

### Auth-screen logo
- **Path:** `/app/client/dist/assets/logo.svg`
- **Source ref:** `AuthLayout.tsx:65`.
- **Notes:** This is the *only* logo in the React tree — the main
  chat shell has no header logo.

### Favicons
- **Paths:** `/app/client/dist/assets/favicon-{16,32}x{16,32}.png`,
  `/app/client/dist/assets/apple-touch-icon-180x180.png`.
- **Source ref:** `client/index.html:11-14`.

The serve-from path is `dist/`, not `public/`. The upstream
`ghcr.io/danny-avila/librechat:latest` image is built with
`publicDir` effectively on, baking `client/public/assets/` into
`client/dist/assets/` at image-build time. The static handler
(`api/server/index.js:138-140`) then serves from `dist` first.
Mounting at `public/assets/` is silently ineffective — bind onto
`dist/assets/`. See [`../PHASE2.md`](../PHASE2.md) → Slice 2
"asset overlay path" finding.

**Single-file mounts pin to host inodes.** Atomic-rename writes
break the link; the container keeps serving the old file. After
editing anything under `brand/`, run `docker compose restart api`.

## Theme (fork-only in v0.8.6-rc1)

There is no `interface.customCSS`, no `branding`, no `theme`, no
CSS-injection env var. To restyle to NVIDIA green / dark:

- Edit `client/src/style.css:69-191` — CSS variable ramps for light
  and dark modes.
- Edit `client/tailwind.config.cjs:75-87` — `green:` palette
  feeding `--surface-submit` (send button).
- Rebuild the LibreChat image, push under your own tag, swap
  `image:` in `docker-compose.yml`.

Estimated diff: ~20-30 lines across 2 files, no logic changes.

## Cross-references

- [`widget-map.md`](./widget-map.md) — same content organized by
  visual location instead of alphabetical.
- [`mockup.html`](./mockup.html) — interactive mock with toggle
  panel.
- Upstream schema source of truth:
  `packages/data-provider/src/config.ts`.
- Upstream config docs (web):
  <https://www.librechat.ai/docs/configuration/librechat_yaml>.
