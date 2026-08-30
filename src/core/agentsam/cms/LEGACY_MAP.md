# CMS screen map (legacy → `src/core/agentsam/cms`)

**Historical reconstruction lane:** `feat/src/core/agentsam/cms` (retired after merge; canonical state is now on `main`)
**Scope:** files that put these two URLs on screen — not the full `src/core/cms-*.js` sprawl.
**Product:** incubating CMS (`docs/products/PRODUCT_REGISTRY.md` · `/dashboard/cms/*`)

| Live URL | What you see |
|----------|----------------|
| [`/dashboard/cms`](https://inneranimalmedia.com/dashboard/cms) | Cream hub (site overview). Bare path has no `?site=`; operator hub may still pick a featured slug. |
| [`/dashboard/cms/theme-editor?site=inneranimalmedia`](https://inneranimalmedia.com/dashboard/cms/theme-editor?site=inneranimalmedia) | Isolated Studio iframe with inspector tab **theme**. |

Auth: both paths are session-gated. Unauthenticated HTML → `/auth/login?next=…` (`src/index.js` ~1124).

---

## 1. Shared request path (Worker → SPA)

Neither URL is an `ASSET_ROUTES` HTML page. Both are dashboard SPA shells.

```
GET /dashboard/cms[…]
  src/index.js
    session required  (needsDashAuth)
    isDashboardSpaShellPath()          src/core/dashboard-early-hints.js
    getDashboardSpaHtmlShell()         src/core/dashboard-r2-assets.js
      R2 key: static/dashboard/app.html  (fallbacks: app/index.html, legacy agent.html)
  dashboard SPA boots
    app/App.tsx
      isCmsRoute / isCmsFullscreen / isCmsStudioEditor
      parseCmsRoute()                  app/pages/cms/cmsRoute.ts
    app/DashboardAppRoutes.tsx
      /dashboard/cms        → CmsPage
      /dashboard/cms/*      → CmsPage
      /dashboard/cms/sites  → Navigate /dashboard/cms
    app/lazyDashboardPages.tsx
      lazy import app/pages/cms/CmsPage.tsx
```

**Chrome around the canvas (not the page body):**

| File | Role on these URLs |
|------|--------------------|
| `app/App.tsx` | Fullscreen CMS shell; Agent Sam rail on editor routes |
| `app/hooks/useAppAgentPanelChrome.ts` | Collapses Agent by default on studio editor |
| `app/config/shellNav.ts` | `CMS_SUITE_NAV` — Sites `/dashboard/cms`, Theme editor `/dashboard/cms/theme-editor` |
| `app/components/shell/DashboardSidebar.tsx` | CMS suite active when path starts with `/dashboard/cms` |
| `app/components/shell/AppShellFrame.tsx` | Workbench deep-link to `/dashboard/cms/pages?site=` |
| `app/lib/dashboardRouteContext.ts` | Agent `route_key=cms_edit` for `/dashboard/cms*` |
| `app/hooks/useCmsWorkspaceContext.ts` | `GET /api/cms/workspace-context` (also fetched from `App.tsx`) |

**API dispatch for everything `/api/cms*`:**

`src/core/production-dispatch.js` → `src/api/cms.js` (`handleCmsApi`)

---

## 2. Hub — `/dashboard/cms`

`CmsPage` parses an empty rest segment → `view: 'sites'` (no `?site=`) or `view: 'hub'` (explicit `?site=`). Hub **does not** inherit localStorage site; only the query param counts.

```
CmsPage.tsx
  parseCmsRoute → hub | sites
  GET /api/cms/workspace-context     useCmsWorkspaceContext.ts
  if hubSiteSlug:
    CmsShellLayout (hubMinimal)      CmsShellLayout.tsx + cmsShell.css
      CmsHubPage.tsx
        CmsGuidedChatHero.tsx
        CmsSiteSwitcher.tsx
        CmsDashboard.tsx
  else (no resolved site):
    CmsHubPage without shell  (pick / deploy empty states)
  needsSitePick:
    CmsSiteLauncherGrid.tsx
  overlay:
    SiteDeployWizard.tsx
```

**Hub body (`CmsDashboard.tsx`) pulls:**

| Call | From |
|------|------|
| `GET /api/cms/bootstrap?project_slug=` | `CmsDashboard` |
| `GET /api/cms/activity?project_slug=` | `CmsDashboard` |
| `GET /api/integrations/summary` | `useCmsConnectedIntegrations.ts` |
| `GET /api/projects/overview?scope=tenant` | `useCmsLinkedProject.ts` |
| storefront URL | `src/dashboard/cms/cmsStorefrontUrl.ts` → `src/core/cms-storefront-url.ts` |
| Open CMS CTA | `buildCmsPath({ panel: 'theme-editor', siteSlug })` → `/dashboard/cms/theme-editor?site=` |
| Edit site | `buildCmsPath({ panel: 'pages', siteSlug })` |

**Hub children (on-screen, not studio):**

- `CmsIntegrationsStrip.tsx`
- `CmsHubImportStrip.tsx` → `POST /api/cms/liquid-imports/upload`, inventory poll
- `CmsSiteStructurePanel.tsx`
- `resolveCmsBranding.ts`

**Worker truth for the hub site list:**

| File | Role |
|------|------|
| `src/api/cms.js` | `GET/POST /api/cms/workspace-context`, `GET /api/cms/bootstrap`, `GET /api/cms/activity` |
| `src/core/cms-hub-sites.js` | Operator launcher rows (`agentsam_project_context` `hub_launcher=1` + `cms_tenants`) |
| `src/core/cms-site-config.js` | Hosting mode, studio URL, public domain |
| `src/core/cms-workspace-resolve.js` | Registered `cms_site` context |
| `src/core/cms-site-spine.js` | `buildAgentSiteContext` |
| `src/types/cms.ts` | Host DTO snapshot (`CmsBootstrapData`, hosting, publish phases) — not product SSOT |

**D1 (hub read path):** `agentsam_project_context`, `cms_tenants`, `cms_pages`, `cms_page_sections`, `agentsam_bootstrap.ui_preferences_json.cms_project_slug`

---

## 3. Theme editor — `/dashboard/cms/theme-editor?site=inneranimalmedia`

Same `CmsPage` catch-all. `parseCmsRoute` → `view: 'theme-editor'`, `panel: 'theme-editor'`. That maps to Studio panel **`theme`** (not a separate React page).

```
CmsPage.tsx
  nativeStudioPanel = 'theme'
  StudioCmsHost.tsx
    iframe src =
      /static/dashboard/app/cms/studio-cms-shell.html
        ?site=inneranimalmedia&panel=theme&workspace=…&parent_origin=…
    postMessage:
      iam-studio-cms-site      → parent site change
      iam-studio-cms-navigate  → parent React Router (Overview → /dashboard/cms)

R2 (after dashboard build):
  app/public/cms/studio-cms-shell.html
    <script type="module" src="/static/dashboard/app/cms/studio-cms.js">

  app/studio-cms/vite.config.ts
    input:  app/studio-cms/main.tsx
    out:    app/dist/cms/studio-cms.js   (React inlined — do not share vendor-react.js)

  app/studio-cms/main.tsx
    reads ?site=&panel=&page=&workspace=
    mounts src/dashboard/cms/editor/CmsEditor.tsx
    mounts package-owned editor styles via packages/client-cms-editor/frontend/src/mount.tsx

  CmsEditor (panel theme)
    inspector tab ThemeInspector
    getBootstrap() / saveThemeVars()   src/dashboard/cms/api/cmsClient.ts (iamApi.ts is a re-export)
```

**Theme-editor APIs (via `iamApi.ts`):**

| Client | Worker |
|--------|--------|
| `GET /api/cms/bootstrap?project_slug=&site=` | `src/api/cms.js` bootstrap (~2257) |
| `PATCH /api/cms/theme-vars` `{ project_slug, vars }` | `src/api/cms.js` (~3343) → `cms_site_theme_overrides` |
| `GET /api/cms/themes` | `cms_themes` + `cms_theme_preferences` |
| `POST /api/cms/themes/activate` | activate row |
| pages/sections/templates/assets | same Studio bundle (sibling rails; not unique to this URL) |

**Theme payload helpers the bootstrap/editor already import:**

| File | Why it is on this screen |
|------|--------------------------|
| `src/core/cms-theme-active.js` | **FACADE:** canonical merge/payload logic is `src/core/agentsam/cms/theme/active.js` |
| `src/core/cms-theme-bootstrap-payload.js` | **FACADE:** canonical payload logic is `src/core/agentsam/cms/theme/payload.js` |
| `src/core/cms-theme-resolve.js` | **FACADE:** canonical resolution/preferences are under `src/core/agentsam/cms/theme/` |
| `src/core/cms-theme-tokens.js` | **FACADE:** canonical token buckets are `src/core/agentsam/cms/theme/tokens.js` |
| `src/core/cms-theme-kv-cache.js` | **FACADE:** canonical active-theme cache is `src/core/agentsam/cms/theme/cache.js` |
| `src/core/cms-kv-cache.js` | Bootstrap cache key + invalidate on theme-vars PATCH |

**Build:** `app/package.json` `"build": "vite build && vite build --config studio-cms/vite.config.ts"`
Isolation is intentional (Mac vs CF Builds racing shared `vendor-react.js`). Do not re-import Studio into the dashboard vendor chunk.

---

## 4. Route parser (both URLs)

`src/core/agentsam/cms/routing/cms-route.js` is now the canonical CMS route SSOT. `app/pages/cms/cmsRoute.ts` is a compatibility facade plus dashboard-only localStorage helpers:

| Path | `view` | Studio `initialPanel` |
|------|--------|------------------------|
| `/dashboard/cms` | `sites` (or `hub` if `?site=`) | — (native hub) |
| `/dashboard/cms/theme-editor` | `theme-editor` | `theme` |
| `/dashboard/cms/pages` | `pages` | `pages` |
| `/dashboard/cms/online-store` | `online-store` | `sections` |
| `/dashboard/cms/templates` | `pages` + panel templates | `templates` |
| `/dashboard/cms/imports` | `pages` + panel imports | `imports` |

Legacy redirects (same parser, `legacy: true`):

- `/dashboard/cms/editor?project=&page=` → `/dashboard/cms/pages/…`
- `/dashboard/cms/{slug}/pages/…` → canonical `?site=`

Worker-side aliases (not the live dashboard URL, but they land on these screens):

`src/core/cms-studio-lane.js` — `studio.inneranimalmedia.com` and `/studio/theme-editor` → `/dashboard/cms/theme-editor`. Wired from `src/index.js` ~1236.

---

## 5. Reconstruction peel (this lane)

Target home: **`src/core/agentsam/cms/`**. Dashboard React stays in `app/` until a later UI peel. Worker `src/api/cms.js` stays the HTTP facade until handlers are extracted.

| Move first (shared by both screens) | Legacy today | Intended |
|-------------------------------------|--------------|----------|
| Route parse / `buildCmsPath` / `buildCmsHubPath` | `app/pages/cms/cmsRoute.ts` | **MOVED:** `src/core/agentsam/cms/routing/`; dashboard facade delegates to core |
| Workspace + hub site list | `cms-hub-sites.js`, `cms-site-config.js`, workspace-context in `cms.js` | `src/core/agentsam/cms/workspace-context.*` |
| Bootstrap payload | `cms.js` GET bootstrap + legacy helper adapters | **MOVED:** `src/core/agentsam/cms/bootstrap/`; `/api/cms/bootstrap` now delegates inward |
| Theme vars/read/write/active state | legacy API/theme facades | **MOVED:** `src/core/agentsam/cms/theme/`; Cloudflare-only behavior stays in `cms-theme-host-adapters.js` |
| Typed contracts | `src/types/cms.ts` (host DTOs) | `src/core/agentsam/cms/contracts/` + domain modules |

**Stay in dashboard (screen chrome, not core):** `CmsPage`, `CmsHubPage`, `CmsDashboard`, `CmsShellLayout`, `StudioCmsHost`, `app/studio-cms/main.tsx`, `iamApi.ts` (re-export).

**Stay Worker HTTP:** `src/api/cms.js` dispatch table; peel bodies, do not duplicate routes.

---

## 6. Do not revive / not these screens

| Path | Status |
|------|--------|
| `cms-editor/` Python iframe, `cms-studio-shell.html`, `cms-editor.js` | Removed / `cms-studio-lane.js` refuses to serve |
| `vendor/inneranimalmedia-cms/` | Removed from this monolith (`cms/README.md`) |
| `ClientWorkerCmsStudio` embed | Do not revive (`docs/products/cms/ARCHITECTURE.md`) |
| Former donor `studio.jsx` / `tweaks-panel.jsx` public copies | Removed — not the live iframe; do not revive |
| `app/pages/cms/ThemeEditorImportStrip.tsx` | **Dead** — defined, never imported (hub uses `CmsHubImportStrip`) |
| `src/core/cms-*.js` hydrate/publish/pipeline modules | Storefront / agent / import — not required to paint these two URLs |
| Separate repo `inneranimalmedia-cms` pipeline worker | Deploy from that repo; not the dashboard canvas |

Sibling studio URLs (`/pages`, `/online-store`, `/templates`, `/imports`) share the **same** iframe bundle. Reconstructing theme-editor reconstructs that host; do not fork a second editor.

---

## 7. Debt to kill on this lane (not new features)

1. **`app/studio-cms/main.tsx`** silent fallback `projectSlug = … || 'inneranimalmedia'`. Fail loud if `?site=` is missing — do not invent a slug.
2. **`CmsPage.tsx` hubSiteSlug** still ranks a literal `'inneranimalmedia'` among operator-hub candidates. Hub launcher rows in D1 (`cms-hub-sites.js`) are the SSOT; drop the string default.
3. **`src/api/cms.js`** is now the thin HTTP composition root (~253 lines). Workspace context, bootstrap, theme, lifecycle, preview, templates, and storage ownership have been peeled into canonical CMS domains/adapters; do not reintroduce business logic into the facade.
4. Studio `page.tsx` still seeds mock `initialSites` / `makeSections()` then overwrites from bootstrap. Reconstruction should boot from API or an explicit empty state — never paint mock Inner Animal sections as if they were live.

---

## 8. Proof commands (re-run, do not narrate)

```bash
rg -n "path=\"/dashboard/cms" app/DashboardAppRoutes.tsx
rg -n "theme-editor|view: 'hub'|StudioCmsHost" app/pages/cms/CmsPage.tsx app/pages/cms/cmsRoute.ts
rg -n "studio-cms-shell|studio-cms.js" app/pages/cms/studio/StudioCmsHost.tsx app/public/cms/studio-cms-shell.html
rg -n "handleCmsApi|/api/cms/workspace-context|/api/cms/theme-vars" src/core/production-dispatch.js src/api/cms.js
```

## Host/runtime + package/import peel

Canonical portable ownership now lives in:

- `src/core/agentsam/cms/runtime/` — site/runtime descriptor + client-app inventory normalization
- `src/core/agentsam/cms/packages/` — archive/hash/template/inventory/theme-package mechanics
- `src/core/agentsam/cms/adapters/cloudflare/` — R2, theme hydration/realtime, pipeline service, package audit and deployment registry

The former `cms-site-spine.js` customer map is retired; it no longer supplies hardcoded site runtime identity. Root `cms-theme-*`, `cms-r2-binding.js`, `cms-pipeline-service-proxy.js`, and `cms-client-app-resolve.js` paths are migration facades where retained.

## Pages peel

Canonical page identity/metadata/status behavior now lives in `src/core/agentsam/cms/pages/`, with D1 persistence in `adapters/cloudflare/d1-page-store.js`.

Homepage identity is canonical route `/`; `page_type: home` is semantic classification. The new page contract does not expose `is_homepage`. The physical legacy column remains migration debt until all old writers/readers are retired.

`src/api/cms.js` now delegates page listing, scoped lookup, generic page-record creation, metadata updates, archive and restore to the Pages domain. R2 content writes, initial section insertion, draft editing and publish promotion remain separate transitional responsibilities for later peels.

## Sections + Blocks peel

Canonical content structure now continues from Pages into `sections/` and `blocks/`, backed by `adapters/cloudflare/d1-section-store.js` and `d1-block-store.js`. `cms_section_components` remains the physical D1 table for compatibility; the canonical model and new `/api/cms/blocks*` routes use Block terminology.

`src/api/cms.js` no longer performs direct section/block mutation SQL. Section list/create/update/remove/visibility/reorder, page-detail tree reads, injected-section record upsert, and block CRUD delegate into the canonical domains. The remaining direct `cms_page_sections` references in the API are activity-log reporting subqueries, not content mutation ownership.

R2 fragment transformation, draft artifact writes, activity/audit side effects, and eventual archive/revision semantics remain for the Assets/Preview/Publish/Lifecycle peels.

## Assets / Media peel

Canonical asset ownership now lives in `src/core/agentsam/cms/assets/`, with D1 schema adaptation in `adapters/cloudflare/d1-asset-store.js` and R2 transport in `r2-asset-store.js`. The live production table uses the historical expanded asset columns while client-runtime migrations contain a compact schema; the adapter intentionally supports both and the portable domain exposes neither shape directly.

Existing `GET /api/cms/assets` and `GET /api/cms/collection-assets` now delegate inward and serialize compatibility rows for the current Studio client. `src/api/cms.js` contains no direct `cms_assets` SQL after this peel. Mutating asset HTTP contracts were not added as part of the refactor.

## Preview peel

Canonical preview ownership now lives in `src/core/agentsam/cms/preview/`. `src/core/cms-preview-route.js` is reduced to a compatibility facade, and `renderCmsSectionTreeHtml`, `mergeCmsDraftSections`, and `loadCmsPagePreviewContext` in `cms-edit-safety.js` delegate to canonical Preview. The authenticated page preview and draft-read API paths also consume the canonical preview store/model. Publish/draft mutation, R2 promotion, revision history, and cache invalidation remain for the Publish + Lifecycle + Revisions peel.

## Publish/lifecycle/revision peel

Draft writes previously implemented in `cms-edit-safety.js` now delegate to canonical Lifecycle. Full-page rollback/snapshot and override-version API SQL have moved behind `adapters/cloudflare/lifecycle-store.js`. `src/api/cms.js` no longer owns `cms_page_drafts`, `cms_page_overrides`, `cms_override_versions`, or `cms_live_rollbacks` SQL. Raw content-draft saving is delegated to `cms-draft-artifact-host.js`, while page metadata commits are performed by the lifecycle adapter.

`cms-agent-publish.ts` now injects host-specific gates, IAM assembly and telemetry into `runCmsPublishPipeline()` instead of owning publish sequencing. Normal republishes snapshot the prior published R2 artifact before replacement, and the existing rollback endpoint is preserved as a compatibility transport over canonical Revision restore.

## Thin API convergence

The former ~3k-line `src/api/cms.js` implementation has been reduced to a thin HTTP facade. Page, Section/Block, Asset, Theme, Lifecycle/Revision, Templates, Liquid Import, Conversion, Activity, Studio status, injected-section, site-operation, and package transports now live in focused `src/api/cms-routes/` modules.

Direct D1 ownership was removed from the facade. Activity, conversion, integration discovery, Liquid import, Studio status, and template persistence now use Cloudflare adapters under `src/core/agentsam/cms/adapters/cloudflare/`.

A canonical `templates/` domain now owns reusable template CRUD. Template instantiation composes Templates with canonical Pages rather than inserting `cms_pages` rows directly. Page creation now accepts optional `metadata_json` through the canonical Pages contract.

## Editor convergence

The former `studio-cms-editor/` vinext tree is removed. `src/dashboard/cms/editor/CmsEditor.tsx` owns the editor. `app/studio-cms/main.tsx` mounts it in the isolated iframe bundle; the client editor package injects its canonical styles.

The historical `app/pages/cms/studio/iamApi.ts` client is now a compatibility facade over `src/dashboard/cms/api/cmsClient.ts`. Bootstrap mapping, Page/Section/Block types, and preview bridge semantics live under `src/dashboard/cms/`.

Hardcoded customer demo sites, fake collaboration/telemetry, fake media upload/template application/page reorder states, and the old pseudo-Component library were removed. The editor now consumes canonical Blocks from bootstrap and uses the `/api/cms/blocks` contracts for create/save/visibility.

## Agent / AI convergence

`src/core/cms-spawn-bridge.js` previously mixed CMS delegation thresholds with Agent Sam spawn persistence and pinned a concrete fallback model. Delegation thresholds now live in `agents/spawn-policy.js`; the legacy bridge remains a platform adapter and resolves handoff models through the Agent Sam catalog/router.

`src/tools/builtin/cms.js` consumes the canonical CMS protocol. Planning belongs to the agent layer; CMS write/publish tools remain the mutation hosts while their deeper business logic continues moving through the canonical Page/Section/Block/Lifecycle domains.

Migration `1218_cms_multi_provider_agent_plan.sql` registers the planning tool on the existing `cms_edit` profile and repairs the stale `agentsam_cms_write` capability label from `github.write` to `cms.write`.
