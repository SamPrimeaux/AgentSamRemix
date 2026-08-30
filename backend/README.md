# `/backend` — Worker runtime

Server-side domain code peels here from `src/`. Browser surfaces → **`app/`**. Operator programs → repo-root **`bin/`** (not this tree).

**Full planned file tree + daily audit schedule (Phase A — do first):**
[`docs/platform/repo-reorg-audit-2026-08.md`](../docs/platform/repo-reorg-audit-2026-08.md)

**Law SSOT:** [`docs/platform/repo-ownership-2026-08.md`](../docs/platform/repo-ownership-2026-08.md)

**Runtime protocols:** [`protocol/README.md`](./protocol/README.md) — start here for
ACP, SKP, and wire law (implementation under `agentsam/`, `services/`, `src/api/`).

**Convention going forward:** new backend-only modules that don't need to
live inside the bundled Worker's existing `src/` tree — standalone clients,
provider integrations, anything reasonably self-contained — go here instead
of getting stuffed into `src/core/`. Still plain relative imports, still
bundled the same way by wrangler; this is an organizational boundary, not a
new build target.

## Postgres map (strategic)

Postgres keeps SQL statement implementations at `src/backend/commands/` beside `catalog/` and `executor/`. Client programs live in `src/bin`. IAM is a multi-product Worker, so those roles sit under the product that owns them — not a platform-root `backend/commands/`.

| Postgres | IAM | Not |
|----------|-----|-----|
| `src/bin` | repo-root `bin/` + `tools/agentsam/` | — |
| `src/backend/catalog` | `backend/agentsam/catalog/` | — |
| `src/backend/commands` | `backend/agentsam/commands/` | `tools/agentsam/commands/` (operator CLI) |
| `src/backend/executor` | `backend/agentsam/runtime/tool-loop/` (later `executor/`) | — |
| `src/backend/postmaster` | `backend/worker/index.js` (last peel) | `src/index.js` until cutover |

Product map: [`agentsam/README.md`](agentsam/README.md).

## Current contents

- `embeddings/google-gemini-embed.js` — Gemini `embedContent` client for the
  memory lane (see `docs/platform/memory-embedding-gemini-lane-2026-08.md`).
  Self-contained: only depends on `src/core/vault.js` for BYOK key
  resolution, nothing else from `src/core/agentsam-vectorize.js`.
- `services/memory/` — backend-owned Agent Sam memory domain
  (`MemoryService` → Gemini Embedding 2 + `agentsam.agentsam_memory_gemini2_1536`).
  Frontend depends on the client contract only. See
  `backend/services/memory/INTEGRATION.md`.
- `services/knowledge/` — Semantic Knowledge Protocol v1: bootstrap, retrieval,
  episodic experience compile/score/curator. Worker bridge:
  `src/core/knowledge-protocol-bridge.js`. See
  `backend/services/knowledge/INTEGRATION.md`.
- `services/learning/` — Reward policy v2 (pure `deriveRewardPolicy`). Worker
  bridge: `src/core/reward-policy-bridge.js`. Mutation gateway remains
  `src/core/reward-events.js`. See `backend/services/learning/INTEGRATION.md`.
- `services/bootstrap/` — Materialized auth/context cache v2
  (`resolveAgentSamBootstrap`). MCP_TOKENS pointer + perm-snapshot keys.
  UI prefs → `agentsam_user_ui_preferences` + SESSION_CACHE. See
  `backend/services/bootstrap/INTEGRATION.md` and
  `docs/platform/kv-lane-ssot-2026-08.md`.
- `services/session-context/` — SESSION_CACHE key families (`iam:ctx`, `iam:prefs`,
  `iam:ff`, dual-write `iam:sess`). Bridge: `src/core/session-context-kv-bridge.js`.
- `database/migrations/` — service-owned Postgres SQL. Memory's Gemini
  pgvector twin lives here, not in D1 `migrations/` or `public.agentsam_*`.
- `auth/` — fleet machine auth (`AGENTSAM_BRIDGE_KEY` verify/outbound) and CMS
  hub bridge headers. Worker bridges: `src/core/bridge-key-auth.js`,
  `src/core/cms-bridge-trust.js`. See `backend/auth/INTEGRATION.md`.
- `identity/` — identity plane scaffold + SDK OAuth finalize, password reset.
  **Golden entry:** `backend/identity/resolve-identity.js` (`resolveIdentity`).
  KV lanes: `kv-lanes.js` · peel tracker: `peel-manifest.js`.
  Auth portal HTML: `app/frontend/`. See `backend/identity/INTEGRATION.md`.
- `agentsam/catalog/` + `agentsam/commands/` — command rows vs resolve/execute (Postgres catalog + commands). See [`agentsam/README.md`](agentsam/README.md).
- `agentsam/acp/` — local stdio ACP bridge (`serve.mjs`) → Worker `src/api/acp/*`.
  Wire law: `backend/protocol/acp.md`. See `backend/agentsam/acp/INTEGRATION.md`.
- `agentsam/codebase/` — codebase orchestration, structural parse client, and symbol
  materialization (`IAM_CODEBASE_INDEXER`). The main Worker does not bundle or
  instantiate tree-sitter. See `backend/agentsam/codebase/INTEGRATION.md`.

<!-- memory-service-scaffold -->

## Frontend source root

The current Vite/browser application root is `app/`. Browser pages, components, hooks,
and browser-local `src/` primitives stay under that root. Public auth HTML is intentionally
under `app/frontend/public/auth/`. Do not recreate a nested dashboard application root.
