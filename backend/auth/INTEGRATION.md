# Machine auth (AGENTSAM_BRIDGE_KEY)

Canonical implementation for fleet-wide machine-to-machine auth. Do not add
verify/outbound logic under `src/core/` — extend here and re-export via thin
Worker bridges.

## Layout

```text
backend/auth/
├── bridge-key-auth.js    # verifyBridgeKey, resolveOutboundBridgeKey, buildBridgeAuthHeaders
├── cms-bridge-trust.js   # buildCmsBridgeHeaders (IAM hub → client CMS API)
└── INTEGRATION.md
```

## Import law

Production callers import machine-auth behavior directly from `backend/auth/bridge-key-auth.js` and CMS bridge trust from `backend/auth/cms-bridge-trust.js`. The retired `src/core/bridge-key-auth.js`, `src/core/cms-bridge-trust.js`, and machine-auth exports from `src/core/auth.js` must not be reintroduced.

## Inbound verify

`verifyBridgeKey(request, env)` accepts `AGENTSAM_BRIDGE_KEY` only (from env).
Presented credentials may use legacy header names with the same plaintext:

- `Authorization: Bearer`
- `X-Internal-Secret`, `X-Ingest-Secret`, `X-IAM-Service-Key`, `X-ExecOS-Key`

Retired Wrangler secrets (`INTERNAL_API_SECRET`, `INGEST_SECRET`, `IAM_SERVICE_KEY`,
`EXECOS_KEY`) are **not** read from env for verify or outbound.

## Outbound (platform → service)

`buildBridgeAuthHeaders(env)` — `Authorization` + `X-IAM-Service-Key` alias.

ExecOS and some callers also set `X-ExecOS-Key` with the same value.

## CMS federated hub (platform → client Worker)

`buildCmsBridgeHeaders(env, authUser, siteConfig)` in `cms-bridge-trust.js`:

- Requires `AGENTSAM_BRIDGE_KEY` (not legacy env fallbacks — client workers verify bridge only).
- Identity headers: `X-User-Id`, `X-Tenant-Id`, `X-Workspace-Id`, `X-Project-Slug`.
- Consumer: `src/core/cms-client-bridge.js` → client `/api/cms/*`.

See `docs/platform/cms-federated-hub-architecture.md`.

## Client Workers (receive)

Each client Worker ports the **inbound** shape from `bridge-key-auth.js` (see
Legendary-OS `backend/src/auth/`). Same plaintext secret fleet-wide — not
per-site keys.

## Env types (application code)

Worker `Env` / `MachineAuthEnv` types must declare **only**:

```ts
AGENTSAM_BRIDGE_KEY?: string;
```

Do not list `INTERNAL_API_SECRET`, `IAM_SERVICE_KEY`, `INGEST_SECRET`, or
`EXECOS_KEY` on env interfaces — that is the five-field sprawl the audit
flags. Those names must not appear in runtime verify/outbound paths.

Audit: `python3 scripts/audit_bridge_key_ssot.py --local`

`services/moviemode-service` ships from [SamPrimeaux/moviemode-service](https://github.com/SamPrimeaux/moviemode-service).
`iam-codebase-indexer-service` ships from [SamPrimeaux/iam-codebase-indexer-service](https://github.com/SamPrimeaux/iam-codebase-indexer-service) only (no monorepo mirror).
Both vendored copies under `worker/src/lib/bridge-key-auth.js` (moviemode) or `worker/src/bridge-key-auth.js` (indexer) until those services import from a shared package. Keep in sync when changing verify semantics.

## Proof

```bash
node --test tests/unit/bridge-key-auth.test.mjs
node --test tests/unit/cms-bridge-trust.test.mjs
```

SSOT doc: `docs/platform/bridge-key-ssot-2026-08.md`.
