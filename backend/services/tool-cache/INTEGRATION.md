# Tool result cache v2 — backend domain

**Physical deterministic tool-output reuse** — not prompt prefix economics, not command-pattern learning, not telemetry.

Worker imports via [`src/core/tool-cache-bridge.js`](../../../src/core/tool-cache-bridge.js).

## Three reuse planes

| Plane | Table | Question |
|-------|--------|----------|
| Prompt | `agentsam_prompt_cache_keys` | Reusable LLM stable prefix? |
| Tool | `agentsam_tool_cache` | Reusable tool result at this version/input? |
| Knowledge | KV + generation counters | Reusable knowledge packet? |

All three eventually feed **`agentsam_agent_experience`** economics — not by retaining stale blobs forever.

## Policy SSOT

`agentsam_tools.cache_policy_json`:

```json
{
  "cache": {
    "eligible": true,
    "strategy": "versioned",
    "scope": "workspace",
    "ttl_seconds": 900,
    "stale_seconds": 86400,
    "max_output_chars": 16384
  }
}
```

- **Default:** NULL → cache disabled (opt-in only)
- **Strategy:** `ttl` | `versioned` | `immutable` (not `session`/`manual`)
- **Scope:** `global` | `tenant` | `workspace` | `user` | `session`
- **Hard deny:** mutations/terminal/deploy in `contract.js` safety net
- **D1 UNIQUE:** `(tenant_id, workspace_id, tool_key, cache_key_hash)` — both scope ids NOT NULL

## Tool call log provenance

Cache hits write factual `agentsam_tool_call_log` rows:

- `duration_ms` = actual cache lookup latency (not zero)
- `cache_hit = 1`, `external_execution = 0`, `result_source = 'tool_cache'`

Live executions default to `result_source = 'live'`.

## Surface boundary

The tool-result cache is intentionally **in-app-session-only** in this phase. The
standalone OAuth MCP worker (`inneranimalmedia-mcp-server`) executes connector
traffic live and does not read or write `agentsam_tool_cache`. Its OAuth client,
tenant, workspace, and provider-account boundary must be resolved before a safe
cross-repo cache port is considered.

Therefore, MCP connector traffic must not be used as evidence that the main
Worker cache is working. A future MCP cache integration is a separate PR in the
MCP repository and must reuse this cache-key contract rather than reimplementing
it.

## Cache key law

```
SHA256(
  contract_version |
  tool_key |
  tool_revision |
  scope_identity |
  normalized_input_hash |
  source_version |
  vary_hash
)
```

Volatile args (`request_id`, `trace_id`, `_nonce`, …) stripped before hash.

## Storage

- `result_inline_json` when `result_bytes <= max_inline_bytes`
- `result_r2_key` when larger (requires R2 binding)
- D1 row is index + economics (`origin_*`, accumulated `saved_*`)

## Migration

`migrations/1299_tool_cache_v2_rebuild.sql` — drop/recreate (0 rows at ship).
