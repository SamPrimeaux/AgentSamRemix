# Agent Sam memory — wire and catalog law

Durable memory runtime law: stores, embed lane, tool catalog ops, and caller
boundaries. **Not a code home** — implementation under `backend/services/memory/`;
Worker glue peels to `backend/agentsam/memory/`.

**Domain:** `backend/services/memory/` (`MemoryService`)  
**Bridge:** `src/core/memory-service-bridge.js`  
**Catalog dispatch:** `src/core/catalog-tool-memory.js` (`executeMemoryCatalogDispatch`)  
**Integration:** `backend/services/memory/INTEGRATION.md`

## Two planes (do not conflate)

| Plane | Store | Role |
|-------|-------|------|
| **Control** | D1 `agentsam_memory` | Operational SSOT — commit, save, outbox, revision, `key`/`status` |
| **Semantic** | `agentsam.agentsam_memory_gemini2_1536` | Gemini pgvector SSOT — embed, ANN search, supersede links |

Projection: D1 commit/outbox → `memory-service-bridge` → `MemoryService.remember` /
`update` / `supersede`. Never write Gemini vectors into `agentsam_memory_oai3large_1536`
(legacy OpenAI lane only).

### `memory_type` alignment (D1 = Postgres = catalog)

Allowed on **both** D1 `agentsam_memory` and `agentsam.agentsam_memory`:

`fact`, `preference`, `decision`, `policy`, `state`, `procedure`, `event`, `error`,
`project`, `skill` (legacy)

SSOT list: `MEMORY_COMMIT_TYPES` + `MEMORY_LEGACY_TYPES` in
`src/core/agentsam-memory-contract.js` (`MANAGED_MEMORY_TYPES`). Commit tool
(`agentsam_memory_commit`) and managed_pg projection must stay in sync — drift
causes `managed_pg.ok: false` while `pgvector_chunk` may still succeed
(`semantic_ready: false`). Fix migration:
`backend/database/migrations/20260823_agentsam_memory_type_commit_align.sql`.

Vectorize `agentsam-memory-gemini2-1536` is **projection-only**; writes fail loud.
Rebuild from pgvector if needed — not write SSOT.

## Embed lane (D1-driven)

Provider/model for `memory_embed` comes from `agentsam_routing_arms` via
`resolveMemoryEmbeddingLaneConfig()` — not wrangler env vars or fixture constants.
See `docs/platform/memory-embedding-gemini-lane-2026-08.md`.

## Catalog law (in-app + MCP — one dispatcher)

All `agentsam_tools` rows with `handler_type='memory'` route through
`executeMemoryCatalogDispatch` only. No surface-specific memory paths.

### Live ops (`MEMORY_CATALOG_OPS`)

| Op | Maps to | Notes |
|----|---------|-------|
| `memory_write` | commit / save pipeline | Aliases: `save`, `upsert`, `write` |
| `memory_search` | hybrid recall | Semantic leg via `MemoryService.search` |
| `memory_read` | D1 read | Aliases: `get`, `read` |
| `memory_delete` | soft delete | Alias: `delete` |
| `memory_list` | D1 list | Alias: `list` |
| `memory_resolve` | close blocker/alert row | **Not** supersession — different concept |

Canonical tools: one op per `agentsam_tools` row (`agentsam_memory_commit`,
`agentsam_memory_search`, …). `agentsam_memory_manager` is compat-only — do not
fold new ops into it.

### Planned ops (not yet in catalog)

| Op | `MemoryService` method | Tool row (when built) |
|----|------------------------|------------------------|
| `memory_supersede` | `.supersede()` | `agentsam_memory_supersede` |
| `memory_consolidate` | `.consolidate()` | `agentsam_memory_consolidate` |

Bridge seam: `memory-service-bridge.js` — dispatcher calls bridge, bridge calls
`MemoryService`. Never reimplement supersede/consolidate in the dispatcher.

Spec: `docs/platform/memory-tool-catalog-alignment-2026-08.md` · Cursor rule:
`.cursor/rules/iam-memory-tool-catalog.mdc`

## `MemoryService` surface (domain only)

Callers outside the service know:

```js
memory.remember({ content, workspaceId, subjectId, sourceType })
memory.search({ query, workspaceId, limit })
memory.get / list / update / forget / supersede / consolidate
```

`packages/client-core` and dashboard call HTTP only — never Gemini, pgvector,
Supabase, HNSW, or Vectorize directly (`memory-client-contract.js`).

## Hybrid recall order

`executeAgentsamMemoryHybridSearch`: exact → pinned/recent → **pgvector (Gemini
SSOT via bridge)** → legacy pgvector → lexical → D1 hydrate. Semantic hits use
provenance `pgvector_gemini`; Vectorize is not queried (cost dedupe).
`MEMORY_MIN_SEMANTIC_SCORE = 0.35` for semantic legs.

## Deliberate non-goals

- No second operational `agentsam_memory` table
- No `public.agentsam_*` Postgres tables
- No automatic chat-extraction policy inside `MemoryService` persistence
- No dashboard or tool handler direct Hyperdrive/pgvector SQL
- `memory_resolve` ≠ `memory_supersede` — do not conflate

## Separate concern — do not fold into peel

`src/core/memory.js` is **not** semantic memory and not legacy compat to delete.
Header law: Thompson routing priors (`writeRoutingMemoryPrior` →
`agentsam_model_routing_memory`) and old Hyperdrive chat-recall helpers.
Explicit: *"Do not wire `loadAgentMemoryForPrompt` back into chat prompt build."*

Keep this module out of `backend/agentsam/memory/` peel scope. Folding routing-prior
logic into the semantic memory bridge would recreate the scatter this service exists
to kill.

## Success (service is done when all three are true)

**Not** "has `remember`/`search` methods" — **`backend/services/memory/` is the only
caller path that reaches Gemini/pgvector embed/store/search/supersede/forget.**

1. **No side doors.** `src/api/agent/memory.js` legacy D1/private/Vectorize paths
   are gone or route through `MemoryService`. Today they bypass the service entirely.
2. **Full surface.** `remember`/`search` work end-to-end. `supersede`/`consolidate`
   exist on `MemoryService` but are not wired through the catalog dispatcher — agents
   cannot call them yet.
3. **Peel is glue-only.** The 10 `agentsam-memory-*.js` files plus
   `memory-service-bridge.js`, `memory-embedding-lane-resolve.js`, and
   `catalog-tool-memory.js` move to `backend/agentsam/memory/` as bridges. Zero new
   domain logic there; everything domain-shaped stays in `backend/services/memory/`.

**Proof:** a new engineer opens `backend/services/memory/`, finds all domain logic
there, and `src/core/agentsam-memory-*` is gone or pure re-export shims. Architecture
is settled; remaining work is factor-in (INTEGRATION.md items 3–5) + catalog exposure.

## Related

- SKP overlap: [`knowledge.md`](./knowledge.md) — curator commits via
  `executeAgentsamMemoryCommit()`, not raw memory writes
- Embed cost guardrails: `docs/platform/cost-guardrail-regressions-2026-08.md`
- Daily curator: `docs/platform/daily-evolution-curator-2026-08.md`
