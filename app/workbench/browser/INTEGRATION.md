# Agent Sam browser workbench — domain handoff

**Branch:** `feat/browser-session-hook` (Phase C peel + Phase D/E remaster)  
**Manifest:** `peel-manifest.js`  
**Classification map:** `docs/platform/dashboard-components-classification-2026-08.md`

---

## Hard law

1. **Product code lives here** — `app/agentsam/frontend/workbench/browser/`.  
   `app/dashboard/components/BrowserView.tsx` is a **mount shim only** (~10 lines).

2. **Never** `app/dashboard/components/browser/` — no second product tree in dashboard.

3. **No duplicate implementations.** Legacy `BrowserView.tsx` body is deleted; grep must not find `PermissionGate`, `BrowserSurfaceDevToolsDock`, or `PICKER_SCRIPT` under `app/dashboard/components/BrowserView.tsx`.

4. **Import boundary**

   ```text
   dashboard shell  →  @iam/agentsam/frontend/workbench/browser
   inside browser/  →  sibling modules (no barrel hub)
   backend/browser/ → server domain (frontend fetch/WS only — never import)
   ```

5. **`peel-manifest.js` is bookkeeping** — not exported from `index.ts`, not runtime API. Delete when Phase D/E complete.

---

## Session identity (Phase D — locked)

Interactive browser state is **not** owned by `agent_run_id` or `workflow_run_id`.

| ID | Role | Store |
|----|------|-------|
| **`browser_session_id`** (`bsess_*`) | Browser **lease** — Chromium session owner | `BROWSER_SESSION` DO key + DO SQLite row |
| **`conversation_id`** | Optional chat link | Nullable on DO row (`conversation_id`) — not on `agentsam_chat_sessions` |
| **`agent_run_id`** | **Caller** per tool turn — billing, telemetry, HITL | Passed on each `browser_*` invoke; optional on DO row |
| **Cloudflare `session_id`** | CDP handle inside the lease | DO SQLite `live_browser_session.session_id` |
| **`workflow_run_id`** | Orchestration only | **Not** a browser scope |

### DO-only auth (no D1 lease table)

```text
POST /api/browser/sessions  →  mint bsess_* (authenticated user)
POST /api/browser/session   →  ensure Chromium + stamp user_id/workspace_id on DO row
GET  /api/browser/live/*    →  assertBrowserSessionAccess (DO row user_id match)
WS   ?browser_session_id=   →  same DO stub

bsess_*  →  BROWSER_SESSION.get(idFromName(bsess_*))
        →  DO SQLite live_browser_session (user_id, workspace_id, session_id, …)
        →  MYBROWSER connect(session_id)
        →  live.browser.run (tab + devtools)

agent_run_id  →  attribution on tool invoke / optional DO column — not DO key
```

**No `agentsam_browser_session` D1 table.** Spawn tables (`agentsam_spawn_session`, `agentsam_spawn_job`) are chat handoff / multitask orchestration — wrong bucket for browser leases.

### Lifecycle

1. Browser workbench mounts → `POST /api/browser/sessions` mints `bsess_*`.
2. Navigate / agent surface → `POST /api/browser/session` with `{ browser_session_id, url }` ensures DO + Browser Run.
3. Tools pass `{ browser_session_id, agent_run_id? }`.
4. Tab close → `POST /api/browser/session/close` with `browser_session_id`.

### Tool families

| Family | Stateful? | Requires |
|--------|-----------|----------|
| `browser_*` | Yes | `browser_session_id` (+ optional `agent_run_id` for audit) |
| `browser_run_*` | No | URL only — Quick Actions, no session |
| Passive preview | N/A | `blob:` / `data:` / editor local only |

### Explicit bans

- **No `SESSION_CACHE`** for browser (`agentsam_browser_sess:v1:*` — KV is auth/CMS only).
- **No `agent_run_id`** as BROWSER_SESSION DO key.
- **No D1 table** for browser leases (DO is registry + live truth).
- **No `workflow_run_id`** as browser scope.

---

## Binding map

| Binding | Class / service | Browser role |
|---------|-----------------|--------------|
| `BROWSER_SESSION` | `AgentBrowserLiveV1` | Authority — keyed by **`browser_session_id`** |
| `MYBROWSER` | Browser Rendering | Execution — `connect` / Playwright |
| Browser Run REST | HTTP API | Session create + Live View URLs (via DO ensure) |
| `AGENT_SESSION` | `AgentChatSqlV1` | Chat only |
| `SESSION_CACHE` | KV | Auth, CMS — **never browser** |

---

## Module map

| Module | Role |
|--------|------|
| `BrowserWorkbench.tsx` | Mint `bsess_*`, split A/B, window events |
| `BrowserPane.tsx` | Single pane composer (≤1k lines) |
| `useBrowserSession.ts` | `browser_session_id`, navigate, embed, live WS |
| `browserApi.ts` | `mintBrowserSessionLease`, session HTTP |
| `useAgentLiveBrowserWs.ts` | WS `?browser_session_id=` |
| `backend/browser/sessions/scope.js` | `newBrowserSessionId`, `resolveBrowserSessionScopeId` |
| `backend/browser/sessions/client.js` | `assertBrowserSessionAccess` (DO user_id) |

---

## Phase D — shipped in this branch

1. `bsess_*` DO key (replaces `agent_run_id`).
2. DO-only auth (`user_id` / `workspace_id` on ensure).
3. KV browser fallback removed — fail-closed without `BROWSER_SESSION`.
4. HTTP/WS re-keyed to `browser_session_id`.
5. Workbench mints lease on mount.

## Phase E — shipped

1. **E1** — Removed orphan `GET /api/browser/screenshot` + `overnight.js` pipeline; no `pw.launch` per URL.
2. **E1b** — Stateful `browser_*` / `cdt_*` tools fail closed without `browser_session_id` (no silent launch).
3. **E2** — DO ensure uses MYBROWSER `acquire` first (`bootstrapBrowserLeaseSession`), REST fallback only.
4. **E3** — Chat `browserContext.browser_session_id` → tool-loop → agent `browser_*` invokes.
5. **E4** — `invokeBrowserTool` (UI); deleted `playwright-handle-cache.js`.
6. **E5** — Migration `20260826_browser_tools_phase_e.sql` — canonical `browser_*`; `cdt_*` deactivated.

### Remaining (post-E)

- `browser_inspect_point` via real CDP picker (product feature, not lane cleanup).

---

## Verification

```bash
node --check backend/browser/sessions/client.js
node --check backend/browser/sessions/scope.js
npm --prefix app/dashboard run build
./scripts/with-cloudflare-env.sh node scripts/smoke-browser-devtools-dock-live.mjs
```

Phase D exit: same `browser_session_id` + Cloudflare `session_id` + `target_id` across navigate, DevTools refresh, and human Live View.
