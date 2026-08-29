# CMS theme domain

This directory is the canonical implementation of live CMS theme state and editor-facing theme behavior.
It is portable, site-neutral, and provider-neutral.

## Owns

- parsing and normalizing theme configuration
- deriving runtime CSS variables and canonical token buckets
- active-theme resolution across project/workspace/user/tenant scopes
- theme preference persistence
- active-theme cache keys and payload cache behavior
- active-theme API payload construction
- theme catalog/preview normalization
- theme creation/update helpers
- per-site CSS variable overrides
- theme-owned Agent Home component configuration

## Does not own

- HTTP request/response transport
- Cloudflare R2 binding selection or upload authorization
- Durable Object / collaboration broadcasting
- theme archive extraction/import execution
- package build/deploy/audit pipelines
- customer/site-specific theme defaults

Cloudflare-specific hydration, upload eligibility, and realtime broadcast are supplied from
`src/core/cms-theme-host-adapters.js`. The canonical theme modules must not name those host bindings.

## Compatibility

The historical `src/core/cms-theme-*.js` state files are compatibility facades during migration.
They re-export this domain (and, where required, explicit host adapters); they are no longer the
source of truth. New CMS code should import `src/core/agentsam/cms/theme/` directly.

Theme archive/package files remain legacy pipeline modules for now and will be peeled in the later
package/import pipeline sprint rather than mixed into live theme state.
