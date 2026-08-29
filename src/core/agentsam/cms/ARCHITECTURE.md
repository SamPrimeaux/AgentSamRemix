# Agent Sam CMS — target architecture

`src/core/agentsam/cms/` is the reconstruction boundary for the canonical, portable CMS domain.
InnerAnimalMedia is the first host of this domain, not a special case inside it.

## Ownership rule

The core owns the meaning and lifecycle of CMS concepts: site, route, page, section, block,
asset, theme, revision, preview and publish. Dashboard/Worker code may host or expose those
concepts, but must not become a second source of truth.

## First canonical boundary: routing

`routing/` owns editor CMS route semantics. `/dashboard/cms` is a default host mount only;
callers may supply another `basePath` for a standalone Vite/package host.

Current compatibility flow:

```text
dashboard URL
  -> app/dashboard/pages/cms/cmsRoute.ts        compatibility facade
  -> src/core/agentsam/cms/routing/         canonical semantics
  -> normalized CMS route context
```

No CMS route resolver may infer a specific site/customer when the route omits site context.
Site identity must come from explicit route context or authoritative site/workspace resolution.

## Product convergence rule

This reconstruction produces **one CMS product**. Legacy dashboard, API, and Studio surfaces are migration hosts only; they must progressively delegate into the canonical CMS rather than becoming parallel implementations.

The dependency direction is intentionally one-way:

```text
legacy UI / API / compatibility files
                 ↓
        src/core/agentsam/cms/
                 ↓
        contracts / adapters
```

The canonical CMS must not permanently call back into legacy CMS mega files. Useful legacy behavior is moved, abstracted behind a contract, or deleted after replacement. The target invariant is **zero legacy CMS implementation imports from `src/core/agentsam/cms/`**.

Detailed migration law, dependency firewall rules, multi-agent/provider boundaries, and package convergence requirements live in [`DEPENDENCY_BOUNDARIES.md`](./DEPENDENCY_BOUNDARIES.md).

The dependency firewall is now executable, not aspirational: `dependency-policy.json` plus `npm run guard:cms-dependencies` default-deny every outward production import from this tree. The temporary legacy dependency allowlist is currently empty.

## Agent and provider architecture

Multi-agent and multi-provider operation is a first-class CMS capability. Core CMS behavior should express capabilities and agent tasks through generic contracts, while concrete provider SDKs remain behind adapters and routing. This preserves support for multiple providers/models without binding the CMS core to any single SDK.

Planned package-shaped domains include:

```text
agents/        orchestration, sessions, capabilities, tool policy
ai/            provider/model contracts and routing
```

The same ownership rule applies to storage and hosting: the CMS domain owns behavior; adapters own Cloudflare/provider/runtime implementation details.


Current landed portability boundaries also include:

```text
runtime/                  portable runtime/site descriptors + client-app inventory
packages/                 portable archive/hash/template/inventory/artifact generation
adapters/cloudflare/      explicit Cloudflare host/runtime/storage/pipeline implementations
```

## Planned domains

```text
src/core/agentsam/cms/
  routing/       canonical CMS/editor route semantics
  context/       workspace/site/permission resolution
  domain/        site/page/section/block/revision entities
  storage/       storage contracts, not vendor-specific business logic
  registry/      field/section/block/schema/validation/migration registration
  pages/         page operations
  sections/      section operations
  blocks/        block operations
  assets/        asset metadata/usages
  theme/         tokens/theme resolution
  preview/       editor-preview protocol
  pipeline/      render/assemble/preview/publish/cache
  lifecycle/     visibility/delete/restore/purge/revisions
  bootstrap/     editor bootstrap/site manifest
  contracts/     portable public contracts
  agents/        multi-agent orchestration/capabilities
  ai/            provider/model contracts and routing
```

Cloudflare-specific adapters can initially live beside the core but should remain separable so
this domain can later move to packages such as `agentsam-cms-core`, `agentsam-cms-client`,
`agentsam-cms-editor`, and `agentsam-cms-cloudflare` without a second rewrite.

## Runtime and package adapter boundary

CMS runtime identity is now data-driven. `runtime/` normalizes authoritative site/client-app configuration into a portable descriptor; it does not infer a customer, Worker, bucket, database, binding, or domain. The historical hardcoded `cms-site-spine.js` map is retired and remains only as a compatibility wrapper over supplied runtime configuration.

Portable package mechanics live in `packages/`: archive extraction, hashing, template planning, inventory manifests, and deterministic theme artifact generation. Cloudflare-specific upload, R2 binding selection, realtime broadcast, service bindings, package audit persistence, and deployment inventory live in `adapters/cloudflare/`.

`src/core/cms-site-config.js` remains a transitional host resolver outside the portable core. It may consume platform/workspace inventory while callers are peeled, but those host decisions must not migrate back into `runtime/` or `packages/`.

Current canonical domain: `pages/` owns page identity, metadata, route uniqueness, status and archive/restore behavior. Homepage identity derives from route `/`; the legacy `is_homepage` flag is not part of the canonical contract.

Canonical content tree: `Site → Page → Section → Block`. `sections/` and `blocks/` own structure and mutation behavior; D1 table names remain adapter details.

### Assets / Media

`assets/` owns canonical CMS asset descriptors: identity, filename, MIME/kind, size, alt text, category, usage context, labels, tags, storage locators and collection membership. Physical D1 schema variants and R2 object operations live under `adapters/cloudflare/`. Asset metadata deletion never implies R2 object purge; lifecycle/revision policy owns destructive cleanup.

### Preview

`preview/` owns portable preview-mode resolution, public preview request semantics, route/page selection, draft overlays, visibility filtering, normalized Page → Section → Block preview models, inspector targets, preview URL construction, iframe bridge message normalization, cache policy, and fallback HTML rendering. D1/KV retrieval lives in `adapters/cloudflare/preview-store.js`; R2 hydration remains a host adapter concern. Publish promotion and revisions are explicitly outside Preview.

### Publish, lifecycle, and revisions

`lifecycle/` owns portable draft persistence semantics, lifecycle transition and purge policy, revision normalization, structured override versioning, and artifact revision operations. `pipeline/` owns the ordered publish transaction: prepare draft → verify gates → acquire lock → load draft → snapshot current publication → promote structured draft → promote artifact → commit publication → invalidate caches → clear hot draft → release lock.

Cloudflare D1/KV/R2 mechanics live in `adapters/cloudflare/lifecycle-store.js`. Existing `cms_override_versions` and `cms_live_rollbacks` are normalized as structured and artifact revision stores rather than introducing another revision table. A publish replacing an existing published artifact snapshots the current artifact before promotion. Host-specific draft rendering and IAM storefront artifact mapping are isolated in `src/core/cms-draft-artifact-host.js`.

### Thin CMS HTTP facade

`src/api/cms.js` is now the CMS HTTP composition root rather than a CMS implementation. It authenticates the request, resolves request-scoped workspace/site access, constructs canonical Cloudflare stores, preserves client-worker bridge routing, and dispatches focused handlers from `src/api/cms-routes/`.

The dispatcher has two deliberate phases: context/integration discovery runs before bridge interception; platform-hosted CMS routes run only after client-worker/bridge routing is resolved. This preserves remote/client-hosted CMS semantics while keeping the platform transport modular.

`src/api/cms.js` contains no direct D1 SQL. Capability-specific D1 reads/writes live behind canonical Cloudflare adapters. Route modules own HTTP parsing/compatibility only; reusable product rules stay in the canonical CMS domains.

### Canonical editor frontend

`src/dashboard/cms/` is the single frontend ownership boundary for CMS editing. It owns the browser API client, Page → Section → Block editor model, preview/selection bridge, and `CmsEditor` implementation. The dashboard CMS surface remains the hub/route host rather than a second editor.

The existing Studio iframe build remains intentionally isolated for React/build safety, but it now mounts the canonical editor. `app/dashboard/studio-cms/main.tsx` and the historical `app/dashboard/pages/cms/studio/iamApi.ts` are compatibility hosts only.

Editor UI must not fabricate customer seed content, telemetry, or successful mutations. Capabilities without a real canonical API are shown as unavailable until implemented.

### Multi-agent and multi-provider CMS

Canonical CMS now owns agent semantics under `agents/`, provider-neutral AI contracts under `ai/`, and the shared capability vocabulary under `contracts/`.

The dependency direction is intentionally one-way:

```text
Agent Sam model catalog / provider runtime / spawn persistence
                         ↓ adapters
              canonical CMS agents + AI
                         ↓
         Page → Section → Block capabilities
```

CMS core does not select vendors, import provider SDKs, persist Agent Sam spawn rows, or implement a second tool loop. `src/core/cms-ai-runtime.js` resolves a model through the platform router and dispatches through the existing provider runtime. `src/core/cms-spawn-bridge.js` adapts the portable CMS delegation policy to Agent Sam's existing spawn/handoff persistence.

AI is proposal-first. Provider output is normalized into canonical CMS operations, unknown capability names are rejected, requested capability allowlists are enforced after generation, and actual mutations remain the responsibility of canonical CMS capability executors/tool handlers. Publish/destructive operations are marked approval-required at the generic CMS agent service boundary.

CMS planning belongs to the agent layer; catalog tools execute/read CMS operations rather than exposing a separate AI-plan tool.
