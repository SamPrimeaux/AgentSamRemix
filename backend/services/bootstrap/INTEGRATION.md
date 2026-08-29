# Bootstrap v2 (`backend/services/bootstrap`)

Lean materialized authorization cache — **not** sessions, health, or resume state.

**KV lane SSOT:** `docs/platform/kv-lane-ssot-2026-08.md`

## Authority split

| Source | Role |
|--------|------|
| `agentsam_user_policy` | Authority |
| `workspace_members` / `user_governance_roles` | Authority |
| `agentsam_feature_flag*` (agent subset via `flag-lanes.js`) | Agent authority → MCP_TOKENS |
| `agentsam_bootstrap` | Materialized snapshot (regenerated on refresh) |
| `agentsam_user_ui_preferences` | UI prefs → SESSION_CACHE `iam:prefs:{au}:{ws}` |

Worker bridge: `src/core/bootstrap-service-bridge.js`

## Single entry

```javascript
const bootstrap = await resolveAgentSamBootstrap(env, {
  userId,
  requestedWorkspaceId,
  request,
  authUser,
});
```

Row id: `asb_<workspace_id>_<user_id>` · `UNIQUE(workspace_id, user_id)`

## Cache identity (hashes)

| Field | Meaning |
|-------|---------|
| `policy_hash` | SHA-256 of canonical permission inputs (policy, roles, **agent_flags**) |
| `context_hash` | SHA-256 of materialized snapshot (+ policy_hash) |
| `generated_from_version` | Bootstrap compiler version — currently `4` (context digest manifest in context_hash) |

**Cache hit** (skip D1 rewrite):

```
stored.policy_hash == current.policy_hash
AND stored.generated_from_version == CURRENT_BOOTSTRAP_COMPILER_VERSION
```

## MCP_TOKENS keys (env.KV)

| Key | Role |
|-----|------|
| `iam:mcp:perm:{au}:{ws}` | Mutable pointer → `context_hash` |
| `iam:mcp:perm-snapshot:{context_hash}` | Immutable compiled authority |

Legacy read fallback: `agentsam:bootstrap:{context_hash}`

Lookup: pointer → snapshot. Policy change orphans old snapshots automatically.

Migrations: `1295_agentsam_bootstrap_v2.sql`, `1296_agentsam_bootstrap_hashes.sql`

## Out of bootstrap

`runtime_status_json`, session ids, terminal health — use SESSION_CACHE / telemetry tables.

UI prefs — `agentsam_user_ui_preferences` + SESSION_CACHE, not perm snapshot.
