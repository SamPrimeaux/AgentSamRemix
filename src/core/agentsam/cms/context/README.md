# CMS context domain

This directory is the canonical home for CMS identity, scope, and authorization.
It is intentionally site-agnostic and deployment-agnostic.

## Owns

- resolving the authenticated workspace context
- discovering the CMS sites available to that workspace/user
- selecting an explicit, stored, or unambiguous site
- operator/hub launcher discovery from authoritative registry rows
- mapping a selected site to a normalized site context
- CMS page/section/component authorization within workspace + tenant scope
- persisting the user's selected CMS site in bootstrap preferences

## Does not own

- dashboard URL/chrome routing (`../routing/` owns CMS route semantics)
- Worker/R2/D1/KV deployment configuration
- page/section rendering
- preview or publish pipelines
- customer/site-specific defaults

Deployment/runtime placement belongs in a host adapter. Context returns identity and scope; it
must not decide that a particular site uses a particular Worker, bucket, database, or domain.

## Compatibility

Legacy modules remain as thin re-export facades during reconstruction:

- `src/core/cms-workspace-resolve.js` -> `workspace-context.js`
- `src/core/cms-hub-sites.js` -> `hub-sites.js`
- `src/core/cms-access.js` -> `access.js`

Consumers therefore keep working while the implementation has a single source of truth.
The facades can be removed after imports have migrated and the new CMS package boundary is stable.
