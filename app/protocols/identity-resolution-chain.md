# Identity Resolution Chain

Status: DRAFT — companion to `docs/platform/identity-substrate-2026-08.md`
(full audit + kill list, not yet committed — pending sign-off on open
items there). This file is the short form: the request-time chain only.

Every request, regardless of entry point, resolves down to one shape and
passes through one funnel. No code may read `auth_sessions`,
`mcp_workspace_tokens`, or any credential table directly — only
`resolveIdentity()` does.

```
REQUEST
 ├─ browser cookie → auth_sessions → auth_users
 ├─ bridge/M2M header → mcp_service_credentials (HMAC-verified) → identity claims
 ├─ MCP bearer → mcp_workspace_tokens → auth_users
 └─ OAuth login → oauth_states → oauth_providers → auth_users(.identities_json)
        ↓
   resolveIdentity() [single funnel]
        ↓
   IdentityContext { user, tenant, workspace, capabilities }
        ↓
 workspace_members (role + can_run_pty/mcp/deploy)
        ↓
   AUTHORIZED ACTION
        ↓
 secret_audit_log / auth_event_log (append-only)
```

Credentials held on the side, never sitting in the request path above:
`user_secrets` (BYOK) · `user_oauth_tokens` (Drive/Gmail/GitHub/CF) ·
`oauth_identity_tokens` (tokens IAM issues out to other clients).

## Rules this chain enforces

1. `resolveIdentity()` is the only reader of auth-state tables. Every
   HTTP route, MCP tool call, and terminal session goes through it —
   no route queries `auth_sessions` or verifies a bridge key inline.
2. The bridge/M2M lane authenticates via `mcp_service_credentials`
   (named, capability-scoped, HMAC-bound to identity claims) — not a
   flat shared-secret string compare.
3. `IdentityContext` is the only shape any downstream code receives.
   Its fields (`user`, `tenant`, `workspace`, `capabilities`) are
   defined in `app/backend/identity/contracts/identity-context.js`.
4. Every authorized action writes to `secret_audit_log` or
   `auth_event_log` — append-only, never mutated.

## Status of underlying tables

This diagram assumes the target state from
`docs/platform/identity-substrate-2026-08.md`, not the current schema.
As of this writing, `auth_users`, `workspace_members`, and the
credential tables above are correct; several duplicate tables
(`accounts`, `account_identities`, `auth_user_identities`,
`auth_user_emails`, `memberships`, `env_secrets`, and others) are still
live and must be retired before this chain is accurate end-to-end. See
the full doc for the verified kill list.
