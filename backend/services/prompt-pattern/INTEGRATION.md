# Prompt pattern economics — backend domain

Durable **stable-prefix pattern identity** and **provider cache economics** live here.
Worker hot paths import via
[`src/core/prompt-pattern-bridge.js`](../../../src/core/prompt-pattern-bridge.js)
(same seam as [`bootstrap-service-bridge.js`](../../../src/core/bootstrap-service-bridge.js)).

## Layout

```
backend/services/prompt-pattern/
  contract.js           PROMPT_PATTERN_CONTRACT_VERSION, VOLATILE_PROMPT_LAYER_KEYS
  manifest.js           compilePromptManifest, computePromptPatternHash, run stats
  layer-resolve.js      agentsam_prompt_routes → agentsam_prompt_versions stable fragments
  economics/
    pricing.js          baseline vs actual input cost from provider token splits
    observe.js          recordPromptCacheObservation, bumpPromptCacheOnCompaction
```

## Three-table roles

| Table | Role |
|-------|------|
| `agentsam_prompt_versions` | Content SSOT (`prompt_hash`, `body_tokens`) |
| `agentsam_prompt_routes` | Composition policy (`prompt_layer_keys`, RAG/memory flags) |
| `agentsam_prompt_cache_keys` | Lifetime economics evidence (never TTL-purged) |

## pattern_hash law

- Hash inputs: contract version + ordered `(layer_key, prompt_version_id, prompt_hash)` for **stable** fragments only.
- Never in hash: tenant, workspace, provider, model, task, mode, route.
- Volatile layers (RAG, memory, knowledge bootstrap, CMS, skill, terminal dock, …) → `volatile_suffix` only.

## Economics

Per model turn with cache activity:

- `uncached = total_input - cache_read - cache_creation`
- Baseline prices **all** input at normal rate; actual uses provider split rates.
- `total_cache_savings_usd` accumulates at observation time (never reprices old rows).

## Wiring (Worker)

1. `agent-controller-prepare.js` — `compilePromptManifest` + volatile blocks
2. `agent-tool-loop.js` — `promptManifest`, `promptPatternStats` on loop bag
3. `agent-tool-loop-model-turn.js` — `recordPromptCacheObservation` per turn
4. `finalizeAgentsamChatAgentRun` — `prompt_pattern_hash` = dominant pattern (most cache-read tokens)
5. `experience/compile.js` — copy dominant hash onto `agentsam_agent_experience`

Migration: `migrations/1298_prompt_pattern_economics_registry.sql`
