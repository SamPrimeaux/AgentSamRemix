# Identity & Auth Substrate — SSOT

Status: DRAFT — pending sign-off. Once approved, commit to
`docs/platform/identity-substrate-2026-08.md` in AgentSamRemix, the path
`app/backend/identity/contracts/oauth-provider-lanes.js` already cites.

This document is the single point of truth for how identity, sessions,
credentials, and authorization are stored and resolved across
inneranimalmedia-business. Every table listed here has exactly one job.
No table listed as dead may be written to going forward.

---

## 1. Principles

These are the rules that decide where new data goes. Apply them before
adding a table or a column — don't re-derive the boundary case by case.

1. **Separate tables exist for different trust models, not different
   features.** "A human is present" (session), "a third party vouches
   for this person" (IDP link), "a machine has a scoped capability"
   (service credential), and "IAM is the authority issuing tokens to
   others" (OAuth server) are four distinct trust models. A table never
   serves two of these at once.
2. **A constraint is not a table.** If the only thing a second table
   would give you is a uniqueness guarantee or a lookup index, prefer a
   generated column + partial unique index on the owning table. Add a
   table only when the data has its own lifecycle (independent
   creation/expiry/revocation) separate from its parent row.
3. **Security-sensitive policy never shares a row with cosmetic
   preference.** Anything that changes what an agent, token, or session
   is *permitted to do* lives in a table no UI-preference write path can
   touch.
4. **Audit is append-only and structurally separate from the state it
   audits**, without exception, regardless of table size.
5. **One canonical writer per concept.** If two tables can both answer
   "is this the same person," one of them is wrong. Divergence between
   them is not a sync bug to fix — it's a sign one of the two must be
   deleted.
6. **A label is not a verdict.** A table's declared purpose (`key_type`,
   a docstring, a comment calling it "canonical") is a claim, not proof.
   Audit actual row contents — population rates, whether fields are
   ever filled, whether two tables' rows actually diverge — before
   keeping or killing anything. Two tables were wrongly given a clean
   pass in earlier drafts of this document on label alone; both were
   wrong once checked. See §3.

---

## 2. Canonical map — the only tables identity code may write to

### Identity core
| Table | Job | Keyed by |
|---|---|---|
| `auth_users` | One row per human/agent/system principal. Carries IDP links as `identities_json`, and any additional login-eligible addresses as `alt_emails_json` — both generated column + partial unique index (see §3). | `au_*` |
| `auth_sessions` | Browser session proof. High-churn, short-lived, no scope/capability data. | `user_id → auth_users.id` |
| `auth_event_log` | Append-only audit of auth events. | — |

### OAuth — IAM as relying party (logging users into IAM)
| Table | Job |
|---|---|
| `oauth_states` | CSRF/PKCE state during any login flow (google/github/iam alike — one `provider_id` column distinguishes them). |
| `oauth_providers` | External IDP client configs IAM authenticates against. |

### OAuth — IAM as authorization server (issuing tokens to other apps)
| Table | Job |
|---|---|
| `oauth_clients` | Registry of apps allowed to OAuth into IAM. |
| `oauth_authorizations` | Full grant lifecycle: pending → approved/denied, PKCE, issued-code hash inline. |
| `oauth_identity_tokens` | Access/refresh tokens IAM has issued to those clients. |

### Credential storage (things IAM holds on a user's behalf)
| Table | Job |
|---|---|
| `user_secrets` | BYOK provider API keys. Sole provider-key authority. |
| `user_oauth_tokens` | Inbound OAuth credentials (Google Drive/Gmail/Calendar, GitHub, GitHub App, Cloudflare, IAM). |
| `secret_audit_log` | Append-only rotation/access audit. |

### Machine-to-machine / MCP auth
| Table | Job |
|---|---|
| `mcp_service_credentials` | Named, capability-scoped service credentials (replaces flat `AGENTSAM_BRIDGE_KEY` — see §4). |
| `mcp_workspace_tokens` | Scoped bearer tokens: tools, lanes, risk levels. |
| `agentsam_mcp_oauth_external_client_registry` | Third-party MCP client registry. |
| `agentsam_mcp_oauth_tool_allowlist` | Tool-level allowlist per client. |
| `agentsam_mcp_oauth_user_client_allowlist` | Per-user client allowlist. |

### Workspace / org / capability
| Table | Job |
|---|---|
| `workspaces`, `tenants`, `orgs` | Container entities. *(Open item — see §5: confirm org vs tenant boundary before lock-in.)* |
| `workspace_members` | Canonical membership + role. Absorbs `can_run_pty`/`can_run_mcp`/`can_deploy` capability flags currently on `memberships` (see §3). |
| `user_governance_roles` | Platform-level governance roles, distinct from workspace membership. |

### Policy (split from current `agentsam_user_policy`)
| Table | Job |
|---|---|
| `agent_security_policy` *(new name)* | Everything that gates agent behavior: risk ceilings, cost caps, allowlist mode, spawn/chain depth. No UI-preference column may live here. |
| `agent_ui_preferences` *(new name)* | Cosmetic/workflow settings: text size, layout sync, editor behavior. No security-relevant column may live here. |

**Verification status:** `auth_users`, `auth_sessions`, `mcp_service_credentials`
(design-level), and the workspace cluster have been checked against live
row data. The remaining tables in this section — the OAuth-server
cluster, `mcp_workspace_tokens`, `oauth_identity_tokens`, the MCP
allowlist tables — are carried forward on design-level reasoning only
and have not yet had the same population/divergence audit applied that
caught `auth_user_emails` and `env_secrets`. Do not treat this list as
fully locked until that pass is complete.

---

## 3. Explicit kill list

| Table | Reason | Absorbed by |
|---|---|---|
| `accounts` | Mirrors `auth_users` 1:1 by ID (confirmed same `au_*` values) — stale duplicate, not a competing system. | `auth_users` |
| `account_identities` | Duplicate IDP linkage + inline token storage; currently receiving more live writes than the canonical linkage path. | `auth_users.identities_json` + `user_oauth_tokens` |
| `auth_user_identities` | Superseded by generated-column approach on `auth_users` per Principle 2 — a separate table isn't needed at this data shape. | `auth_users.identities_json` |
| `auth_user_emails` | Audited: 10 of 11 rows are exact duplicates of `auth_users.email` for the same user — pure redundant mirror. Only 1 row (Connor's Google alt-address) does real work. One legitimate case doesn't justify a table. | `auth_users.alt_emails_json` |
| `memberships` | Duplicate of `workspace_members`, keyed to the dying `accounts` table. **Must migrate `can_run_pty`/`can_run_mcp`/`can_deploy` to `workspace_members` before drop**, or per-workspace capability scoping is lost. | `workspace_members` |
| `identity_oauth_states` | Same job as `oauth_states`, split for no structural reason. | `oauth_states` |
| `oauth_state_nonces` | Zero rows, never written. | — |
| `oauth_authorization_codes` | Superseded by `authorization_code_hash` inline on `oauth_authorizations`. | `oauth_authorizations` |
| `oauth_refresh_tokens` | Superseded by `refresh_token_hash` inline on `oauth_identity_tokens`. | `oauth_identity_tokens` |
| `integration_connections` | Zero rows. Declared in the old table-role map, never actually wired to a write path. | `user_oauth_tokens` (if the underlying need resurfaces) |
| `env_secrets` | Audited: 53% of `workers_secret`-typed rows store real secret material anyway despite claiming to be pointers; only 4/79 record what they point to; `vault_secret_id` and `scope` are effectively unused (0 and 1 populated rows respectively). No single job — has caused live duplicate rows for `AGENTSAM_BRIDGE_KEY`. | `mcp_service_credentials` (system secrets) / `user_secrets` (personal). The 8 `public_config` rows aren't secrets and move to a separate, out-of-scope app-config table. |

**Data-integrity bugs found during audit, not architectural — fix regardless of migration timing:**
- Two `auth_sessions` rows carry `user_id` values that aren't valid `auth_users.id`s (`inneranimalclothing@gmail.com` literal email; `au_sam_inneranimalmedia` non-standard format). No FK enforcement currently catches this.
- One `auth_sessions.created_at` row is a raw epoch string (`"1787990632.0"`) instead of the standard datetime format every other row uses.
- Duplicate `AGENTSAM_BRIDGE_KEY` rows in `env_secrets` (two rows, same key_name, both active).

---

## 4. Identity resolution — one funnel, not eleven call sites

Every request-handling code path — HTTP routes, MCP tool calls, terminal
sessions, bridge calls — resolves identity through exactly one function,
returning the `IdentityContext` shape already defined in
`identity-context.js`. No route may query `auth_sessions`,
`mcp_workspace_tokens`, or verify a bridge key directly; all of that logic
lives inside the resolver, once. See `app/protocols/identity-resolution-chain.md`
for the request-time diagram.

The bridge key specifically moves from a flat `env_secrets` string
compare to a `mcp_service_credentials` row per calling principal, with
identity headers (`X-User-Id`/`X-Tenant-Id`/`X-Workspace-Id`) bound via
HMAC signature using the credential's own secret — not merely
accompanying it unchecked. This is what turns "possession of a shared
secret" into actual accreditation.

---

## 5. Open decisions — need your call before this locks

1. **`orgs` (2 rows) vs `tenants` (22 rows)** — is this a real two-tier
   hierarchy (an org contains multiple tenants) or a second shadow pair
   like `accounts`/`auth_users` was? Needs one sentence of intent before
   §2's table stays as two entries instead of collapsing to one.
2. **The six dormant "invited" external contacts** (Dylan Hollier, Paw
   Love Rescue, Natasha Cloteaux, Kearn Dooley, Ken Wright, Beans
   Soileau) — keep as live invites, or drop as stale imports from other
   client sites?
3. **Naming** for the two split policy tables (§2) — `agent_security_policy`
   / `agent_ui_preferences` are placeholders, rename if you have house
   convention.
4. **The unverified "keeps" flagged in §2** — the OAuth-server cluster,
   `mcp_workspace_tokens`, `oauth_identity_tokens`, and the MCP
   allowlist tables need the same row-level audit that found the
   `auth_user_emails` and `env_secrets` problems before this document
   can be called fully locked.

Nothing in this document is final until items 1-4 are resolved.
