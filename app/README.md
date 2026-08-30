# Inner Animal Media Dashboard

The authenticated Workspace browser application for Inner Animal Media. It is a React/Vite single-page app mounted at `/dashboard/*`, not a standalone Worker and not the whole backend.

The dashboard provides the browser surfaces for:

- Agent Sam chat, sessions, workspaces, files, Monaco editing, previews, browser, and terminal
- Projects, artifacts, tickets, tasks, and collaboration
- CMS site management and the CMS editor
- Images, hosted video, Draw, Design Studio, and Movie Mode
- Database, analytics, workflows, integrations, and settings

The server-side APIs and execution logic live in the repository's `backend/` and transitional root `src/` runtime. The browser calls those services through `/api/*`.

### Source-root invariant

`app/` is the Vite/browser application root. `DashboardApp.tsx`, `DashboardAppRoutes.tsx`, and `lazyDashboardPages.tsx` live directly under `app/`. Do not recreate `app/app/` or `app/dashboard/`. `app/frontend/public/auth/` is intentional public-auth content and is not a dashboard application root.

## How the app starts

```text
app/index.html
  → app/index.tsx
  → app/App.tsx
  → app/components/shell/AppShellFrame.tsx
  → app/DashboardAppRoutes.tsx
```

Important files:

- `index.html` — HTML/PWA shell and boot recovery UI.
- `index.tsx` — React mount, session bootstrap, and `BrowserRouter`.
- `App.tsx` — chooses the dashboard shell or public auth routes.
- `components/shell/AppShellFrame.tsx` — shared chrome: navigation, Agent Sam, editor, terminal, browser, activity panels, and status bar.
- `app/DashboardAppRoutes.tsx` — normal page route tree.
- `app/lazyDashboardPages.tsx` — route-level lazy loading.
- `components/shell/PublicAuthRoutes.tsx` — auth and onboarding routes rendered by the same bundle.
- `vite.config.ts` — production dashboard/PWA build configuration.
- `studio-cms/main.tsx` — separate bundled CMS editor entrypoint.
- `public/cms/studio-cms-shell.html` — iframe shell that loads the CMS editor bundle.

## Live dashboard route map

“Live” here means registered by the current checked-out router. Production availability also requires the matching dashboard bundle to have been deployed to R2 and the Worker to be deployed.

### Agent Sam and editor

These routes are handled by the shell rather than the ordinary route list:

- `/dashboard/agent`
- `/dashboard/agent/new`
- `/dashboard/agent/editor`
- `/dashboard/agent/workspace`
- `/dashboard/agent/quickstart`
- `/dashboard/agent/examples`
- `/dashboard/agent/:conversationId`
- `/dashboard/agent?tab=recent|workspaces|examples`

The editor route contains the file explorer, Monaco, previews, Git/source panels, browser, terminal, and the Agent Sam work rail.

### Workspace pages

- `/dashboard/home`
- `/dashboard/overview`
- `/dashboard/projects`
- `/dashboard/projects/:projectId`
- `/dashboard/artifacts`
- `/dashboard/artifacts/*`
- `/dashboard/artifacts/tickets`
- `/dashboard/artifacts/tickets/:ticketId`
- `/dashboard/tasks`
- `/dashboard/chats`
- `/dashboard/collaborate`
- `/dashboard/book/:slug`
- `/dashboard/analytics`
- `/dashboard/learn`
- `/dashboard/workflows`
- `/dashboard/database`
- `/dashboard/database/:databaseName`

### Create and media pages

- `/dashboard/designstudio`
- `/dashboard/draw`
- `/dashboard/sketch`
- `/dashboard/moviemode`
- `/dashboard/moviemode/:projectId`
- `/dashboard/images`
- `/dashboard/images/storage`
- `/dashboard/images/delivery`
- `/dashboard/images/delivery/variant/create`
- `/dashboard/images/keys`
- `/dashboard/images/sourcing-kit`
- `/dashboard/images/:id`
- `/dashboard/images/:id/edit`
- `/dashboard/images/videos`
- `/dashboard/images/videos/asset/:assetId`
- `/dashboard/images/videos/:uid`
- `/dashboard/images/videos/:uid/settings`
- `/dashboard/images/videos/:uid/downloads`
- `/dashboard/images/videos/:uid/captions`
- `/dashboard/images/videos/:uid/embed`
- `/dashboard/images/videos/:uid/json`
- `/dashboard/images/videos/:uid/public-details`
- `/dashboard/images/videos/:uid/tags`

### CMS pages

All CMS paths render through `pages/cms/CmsPage.tsx`, which resolves the selected site and panel:

- `/dashboard/cms`
- `/dashboard/cms/pages`
- `/dashboard/cms/templates`
- `/dashboard/cms/imports`
- `/dashboard/cms/theme-editor`
- `/dashboard/cms/online-store`
- `/dashboard/cms/media`
- `/dashboard/cms/*`

`/dashboard/cms/sites` is a compatibility redirect to `/dashboard/cms`.

### Collaboration pages

- `/dashboard/mail`
- `/dashboard/meet`

### Settings

`/dashboard/settings` redirects to `/dashboard/settings/general`.

- `/dashboard/settings/design` — workspace Brand & Design preferences and reusable design assets

Current section slugs are defined in `components/settings/settingsConstants.ts`:

```text
general · agents · ai-models · tools · rules · workspace · design · hooks
github · indexrules · cicd · network · themes · storage · security
keys · billing · notifications · docs · integrations
```

The route form is `/dashboard/settings/:sectionSlug`.

### Compatibility redirects

- `/dashboard` → `/dashboard/agent`
- `/dashboard/calendar` → `/dashboard/collaborate`
- `/dashboard/library` → `/dashboard/artifacts`
- `/dashboard/launch-desk` → `/dashboard/collaborate`
- `/dashboard/docs` → `/dashboard/settings/docs`
- `/dashboard/integrations` → `/dashboard/settings/integrations`
- `/dashboard/storage` → `/dashboard/settings/storage`
- `/dashboard/health` → `/dashboard/analytics`

## Auth and onboarding routes in this bundle

When the URL is not under `/dashboard`, `App.tsx` renders `PublicAuthRoutes`:

- `/auth/login`
- `/auth/signup`
- `/forgot-password`
- `/reset-password`
- `/onboarding`
- `/api/auth/oauth/consent`
- `/oauth/mcp/consent`

The Worker also serves the static auth pages at `/auth/login`, `/auth/signup`, and `/auth/reset` from R2. The browser route list is the recovery/fallback surface; the Worker remains the HTTP authority.

## Build and deployment

From the repository root:

```bash
npm install
npm --prefix app install
npm run dev
npm run build
```

The dashboard package's `build` script runs two Vite builds:

```text
vite build
vite build --config studio-cms/vite.config.ts
```

The main dashboard is published under the R2 key prefix `static/dashboard/app/`. The PWA root assets include `/sw.js`, `/manifest.webmanifest`, `/offline.html`, and `/pwa-build-meta.json`.

Use the repository deployment lane from the repository root:

- Mac: `bin/agentsam deploy fast` or `bin/agentsam deploy full`
- GCP/phone/remote operator: `bash scripts/ship-remote.sh`

Do not treat a Worker-only deploy as proof that dashboard assets shipped. The dashboard bundle, PWA assets, Worker, and their build SHA must agree.

## Ownership: dashboard versus runtime

### Properly located browser code

These are dashboard-owned browser concerns and belong under `app/`:

- React pages and components
- Shell navigation and layout
- Monaco/editor state
- browser-side terminal and file-source clients
- PWA/session recovery UI
- CMS editor host and dashboard product surfaces

`app/src/` is a browser-local source folder. It is not the same thing as the legacy root `src/`; it currently contains active frontend primitives such as `EditorContext`, `WorkspaceContext`, PWA helpers, library surfaces, database clients, and collaboration UI.

### Properly relocated server code

The server peel has real destinations in `backend/`, including:

- `backend/identity/` — identity, workspace, permissions, OAuth, and sessions
- `backend/identity/sessions/` — session read/write, KV, upgrade, and workspace handling
- `backend/identity/tokens/mcp-bearer.js` — MCP bearer token authority
- `backend/credentials/resolver.js` — explicit credential-lane resolution
- `backend/database/d1/retry.js` — D1 retry behavior
- `backend/http/dashboard/bootstrap.js` — dashboard bootstrap API
- `backend/http/agentsam/bootstrap.js` — Agent Sam bootstrap API
- `backend/http/settings/` — settings API routes
- `backend/agentsam/` — Agent Sam runtime, sessions, catalog, terminal, and planning work
- `backend/services/` — long-lived service/domain code

These destinations exist and are being used, but the peel is not complete until their callers no longer depend on root `src/`.

### Still transitional or old

The production Worker is still composed from `src/index.js` because both `wrangler.jsonc` and `wrangler.production.toml` currently use:

```text
main = "src/index.js"
```

There is not yet a `backend/worker/index.js` cutover. Therefore root `src/` remains load-bearing for the Worker. Examples still imported by the Worker include:

- `src/core/router.js`
- `src/api/auth.js`
- `src/api/oauth.js`
- `src/api/health/index.js`
- `src/api/webhooks/*`
- `backend/services/retention.js`
- `src/core/security-scan.js`
- `src/core/tunnel-status.js`
- `src/core/dashboard-r2-assets.js`
- `src/core/cms-studio-lane.js`
- `src/cron/scheduled.js`

Some new backend files also still import legacy root `src/` modules. Notable examples include `backend/identity/oauth-finalize.js`, `backend/services/bootstrap/resolve.js`, `backend/agentsam/runtime/tool-loop/*`, `backend/services/tools/handlers/registry.js`, and `backend/http/settings/*`. Those files are relocated by directory but are not yet fully independent.

There are also three direct dashboard-to-root-runtime edges that still need ownership decisions:

- `app/lib/excalidrawLibraries.ts` → `src/core/excalidraw-library-normalize.js`
- `app/pages/cms/cmsRoute.ts` → `src/core/agentsam/cms/routing/index.js`
- `app/src/lib/fsMerkleSnapshot.ts` → `src/core/fs-merkle-snapshot.js` and `src/core/fs-merkle-snapshot-adapter.js`

The target architecture is:

```text
app/
  → HTTP / packages
  → backend/worker/index.js
  → backend/http/*
  → backend domain services
```

Root `src/` is retirement-only: do not add new runtime code there, do not create compatibility shims there, and do not leave a half-migrated implementation behind. A completed peel builds the backend destination, moves every caller, deletes the old root `src/` file, removes its migration exception, and passes the relevant guards and build.
