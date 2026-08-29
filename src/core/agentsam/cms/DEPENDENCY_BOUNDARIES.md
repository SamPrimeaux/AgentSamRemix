# Agent Sam CMS — dependency boundaries

This document is the migration and package-boundary law for the CMS reconstruction.

The end state is one refined CMS product/package, not a new CMS layered on top of legacy CMS implementations.
Legacy files may temporarily delegate into the new domain during migration, but the dependency direction must always point toward the new canonical CMS.

## Core invariant

`src/core/agentsam/cms/` is the canonical implementation boundary.

Allowed dependency direction:

```text
legacy dashboard / API / compatibility facade
                ↓
      src/core/agentsam/cms/*
                ↓
 generic platform contracts / explicit adapters
```

Forbidden dependency direction:

```text
src/core/agentsam/cms/*
        ↓
legacy CMS mega files / old editor implementation
```

The measurable migration target is:

```text
legacy CMS imports from src/core/agentsam/cms/ = 0
```

## Migration rule for legacy behavior

When useful behavior is found in legacy CMS code, only three outcomes are valid:

1. **Move it** — move the implementation into the canonical CMS domain and leave a compatibility re-export if needed.
2. **Abstract it** — define a generic contract in the CMS and inject a host/provider/storage adapter from outside.
3. **Delete it** — remove obsolete or duplicate behavior after the canonical replacement is stable.

Do not create a fourth option where the new CMS permanently calls into legacy mega files.

## Allowed imports

Modules under `src/core/agentsam/cms/` may depend on:

- other canonical CMS modules under `src/core/agentsam/cms/`
- generic platform primitives that are not CMS implementations
- stable contracts/interfaces
- explicit adapters supplied by the host
- standards/runtime APIs that keep the package portable

## Temporary imports

A temporary import from a legacy `src/core/cms-*` helper is allowed only when all of the following are true:

- the dependency is documented as transitional
- there is a named destination in the new CMS architecture
- no duplicate implementation is created
- later work is expected to move or abstract it

Temporary legacy dependencies are debt to remove, not part of the package contract.

## Forbidden permanent imports

The canonical CMS must not permanently depend on:

- `src/api/cms.js`
- dashboard CMS implementation files
- `studio-cms-editor` implementation files
- legacy CMS mega modules as implementation dependencies
- customer/site-specific modules or hardcoded customer identity
- hardcoded AI-provider SDKs in CMS core
- hardcoded deployment resources such as a specific Worker, D1 database, R2 bucket, KV namespace, domain, or tenant

## One CMS product rule

There must be one canonical implementation of each CMS capability.

The reconstruction must not end with:

```text
legacy CMS core
new CMS core
legacy editor
new editor
future packaged editor
```

The intended migration is:

```text
legacy implementation
        ↓ progressively delegates / decomposes
canonical CMS product
        ↓ packaged when stable
agentsam-cms-* packages
```

Compatibility shells are temporary hosts, not separate products.

## Editor rule

The current dashboard and Studio surfaces may host the editor during migration, but the end state is one editor implementation.

Target ownership:

```text
agentsam-cms-editor
  owns human editing UX

agentsam-cms-client
  owns CMS API/client/event contracts

agentsam-cms-core
  owns CMS domain behavior

agentsam-cms-cloudflare
  owns Cloudflare-specific persistence/runtime adapters
```

The dashboard should eventually mount or embed the canonical editor rather than contain a second CMS editor implementation.

## HTTP API rule

`src/api/cms.js` is transitional transport and dispatch, not the long-term CMS implementation.

Target direction:

```text
HTTP request
   ↓
src/api/cms.js        thin transport/validation/response adapter
   ↓
agentsam CMS core    canonical behavior
```

As reconstruction progresses, API handler bodies should shrink while canonical CMS modules grow.

## Multi-agent / multi-provider rule

AI and agents are first-class CMS capabilities. The CMS must support multiple agents, models, and providers without coupling core domain modules to one provider SDK.

Target shape:

```text
cms/agents/
  orchestrator
  task-router
  agent-session
  agent-context
  capabilities
  tool-policy

cms/ai/
  contracts
  model-request
  provider-registry
  model-router
```

Provider-specific implementations belong behind adapters, for example:

```text
CMS capability request
        ↓
CMS AI/agent contract
        ↓
provider/model router
        ↓
OpenAI | Anthropic | Google | Workers AI | future provider
```

The core may express a capability such as content rewrite, page generation, accessibility review, site audit, image generation, migration assistance, or publish review without importing a specific provider SDK directly.

## Storage / host rule

CMS domain modules describe what must be persisted or published. Host adapters decide where it runs.

The final package boundary should allow adapters for:

```text
D1
R2
KV
Durable Objects
Queues
other future persistence/runtime implementations
```

A CMS domain module must not need a specific deployment identity to understand a site, page, section, block, revision, preview, or publish operation.

## Dependency firewall

The firewall is active and default-deny for this product tree.

Canonical policy lives in:

```text
src/core/agentsam/cms/dependency-policy.json
```

Executable enforcement lives in:

```text
scripts/guard-cms-dependency-firewall.mjs
npm run guard:cms-dependencies
```

**Repo parent law:** the same idea is generalized for the whole repository in
[`docs/platform/DEPENDENCY_LAW.md`](../../../docs/platform/DEPENDENCY_LAW.md)
(`npm run guard:dependency-law`). CMS remains the stricter product-local prototype
(default-deny platform + packages). The repo law forbids coarse upward edges
(`products → hosts`, etc.) and ratchets via `dependency-law/compatibility.json`.

The GitHub `pr-law-gate` runs the CMS guard without installing application dependencies, so package/provider imports cannot silently enter the portable core.

Every production JavaScript import under `src/core/agentsam/cms/` is classified as one of:

```text
canonical-cms
 generic-platform
 explicit-package-adapter
 temporary-legacy
 forbidden-*
```

The policy is **default deny** for dependencies outside the canonical CMS tree. Any outward platform dependency must be explicitly named in `dependency-policy.json` with a reason. Package dependencies are also denied unless explicitly approved as adapter contracts.

Current approved outward platform primitives are only:

```text
src/core/auth.js
src/core/bootstrap.js
src/core/bootstrap-scoped-context.js
src/core/workspace-access.js
```

Current temporary legacy allowlist size:

```text
8
```

The live policy in `dependency-policy.json` currently allowlists these eight transitional `src/core/cms-*` files. That list is debt to shrink, not a license to grow — canonical CMS must not add new backward edges to clear a firewall failure.

```text
src/core/cms-edit-safety.js
src/core/cms-draft-artifact-host.js
src/core/cms-agent-page-html.js
src/core/cms-agent-publish.ts
src/core/cms-preview-route.js
src/core/cms-public-domain.js
src/core/cms-site-package-api.js
src/core/resolve-cms-database.js
```

The target invariant remains:

```text
legacy CMS implementation imports from src/core/agentsam/cms/ = 0
```

Adding a dependency is an architecture decision, not an incidental import. The allowlist may grow only for a deliberate generic contract/adapter and should otherwise shrink as platform primitives become package contracts.

## Package destination

The reconstruction should remain package-shaped so the final move is an extraction rather than another rewrite:

```text
packages/
  agentsam-cms-core/
  agentsam-cms-client/
  agentsam-cms-editor/
  agentsam-cms-cloudflare/
  agentsam-cms-providers/
```

Package names may change; the ownership boundaries should not.

## Definition of done

The reconstruction is structurally complete when:

- CMS domain behavior has one canonical implementation
- `src/core/agentsam/cms/` has zero legacy CMS implementation imports
- app/dashboard/Studio code consumes the canonical editor/client rather than implementing another CMS
- `src/api/cms.js` is a thin transport layer
- provider SDKs are behind provider adapters
- host/storage details are behind runtime adapters
- adding a new site does not require forking the core or editor
- moving the CMS into standalone packages is primarily an import/build/package operation, not a rewrite

## Landed runtime/package boundaries

The package-shaped split is now concrete:

```text
src/core/agentsam/cms/runtime/
  portable runtime/site descriptor and client-app inventory normalization

src/core/agentsam/cms/packages/
  portable archive, hashing, template planning, inventory and artifact generation

src/core/agentsam/cms/adapters/cloudflare/
  Cloudflare R2, realtime, service-binding, audit and deployment/inventory adapters
```

`runtime/` and `packages/` must remain free of customer identity, Cloudflare binding names, deployment URLs, provider SDKs, or hardcoded resource identifiers. Host adapters may contain concrete runtime bindings because that directory is explicitly outside the portable package contract.

The old `cms-site-spine.js` customer map is retired. Runtime configuration must come from authoritative registry/site/client-app data, not source-code maps. Root-level `cms-*` paths retained during migration are compatibility facades; new work should import canonical domains or explicit adapters directly.

## Pages boundary

`src/core/agentsam/cms/pages/` owns portable page identity, metadata, route uniqueness, status, archive and restore behavior. D1 persistence lives in `adapters/cloudflare/d1-page-store.js`. Page content artifacts, sections/blocks and publish promotion are separate domains.

Homepage identity is derived from canonical `route_path === "/"`; `page_type: "home"` is semantic classification. The canonical page contract must not depend on the legacy `is_homepage` column.

## Sections and Blocks boundary

`sections/` owns page-section identity, structured data, ordering, visibility and field editing. `blocks/` owns child content units inside a section. The legacy table name `cms_section_components` is a Cloudflare/D1 adapter concern only; canonical product code calls these records Blocks.

R2 fragment upload/hydration and draft/publish artifact generation remain host/pipeline concerns. HTTP routes may preserve legacy `components` aliases during migration, but they delegate to the Block domain.

## Assets / Media boundary

`assets/` owns the portable asset model and metadata behavior. It does not import Cloudflare bindings, presigning code, customer domains, dashboard media helpers, or general platform media APIs. `d1-asset-store.js` absorbs the historical expanded `cms_assets` schema and the compact client-runtime schema; `r2-asset-store.js` owns object transport and host URL resolution.

Sections/Blocks may refer to asset IDs or canonical descriptors, but they do not own R2 operations. Preview/Publish may consume asset storage locators, but destructive object cleanup remains lifecycle policy.

## Preview boundary

`preview/` may consume canonical Pages, Sections and Blocks contracts. It must not import app/dashboard/editor implementations, provider SDKs, legacy preview helpers, Cloudflare bindings, customer identity, publish mutation code, or revision storage. The Cloudflare preview adapter owns D1/KV query mechanics and batched block retrieval. Legacy `cms-preview-route.js` and preview helpers in `cms-edit-safety.js` are compatibility facades only.

## Lifecycle and publish boundary

`lifecycle/` and `pipeline/` are portable and may depend only on canonical CMS modules/contracts. They must not import D1, KV, R2 bindings, editor code, customer identity, telemetry, provider SDKs, or IAM storefront implementations. `adapters/cloudflare/lifecycle-store.js` owns persistence, locks, cache invalidation, page publication metadata, revision storage and R2 snapshot copies. `cms-agent-publish.ts` is a host-step adapter around the canonical publish pipeline; it must not own lifecycle ordering or direct D1 SQL.

Page archive/restore record mutation remains in the canonical Pages store while Lifecycle owns state-transition and purge-eligibility policy. Purge is policy-only in this peel; no destructive purge endpoint is introduced.

## HTTP transport boundary

`src/api/cms.js` is a composition/dispatch facade. It may construct CMS stores/adapters and perform authentication, scope resolution, bridge routing, and HTTP fallback, but it must not contain direct SQL or reusable CMS business logic.

`src/api/cms-routes/` contains focused HTTP handlers. These modules may preserve legacy endpoint/response compatibility and perform host-specific transport, but they must delegate reusable behavior into `src/core/agentsam/cms/` and storage mechanics into adapters. A route file must not become a substitute domain service.

Bridge order is part of the contract: pre-bridge context/integration handlers → client-worker/bridge middleware → platform-hosted CMS handlers.

## AI and agent boundary

`agents/`, `ai/`, and `contracts/` must remain portable. They may import other canonical CMS modules but must not import Agent Sam's provider runtime, model router, subagent persistence, provider SDKs, Cloudflare bindings, or customer-specific code.

Platform adapters live outside canonical CMS:
- `src/core/cms-ai-runtime.js` — model catalog resolution + provider dispatch.
- `src/core/cms-spawn-bridge.js` — Agent Sam spawn/handoff persistence over canonical CMS delegation policy.

Do not add vendor-specific adapters under canonical `ai/`. A new provider belongs in the platform provider runtime and becomes available to CMS through the existing injected `complete()` contract.
