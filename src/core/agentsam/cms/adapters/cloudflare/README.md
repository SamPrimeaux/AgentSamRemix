# Cloudflare CMS adapters

This directory is the explicit Cloudflare host boundary for the CMS product. Binding names, R2 selection, Durable Object broadcast, service bindings, and deployment/inventory persistence may live here; portable CMS domains must not depend on those details.

Current adapters:

- `storage.js` — R2 binding/public-object resolution
- `theme.js` — theme R2 hydration/upload eligibility/realtime broadcast
- `pipeline-service.js` — CMS pipeline service binding
- `package-audit.js` — package audit orchestration + persistence
- `package-registry.js` — R2 deployment/inventory metadata persistence

The existing root-level `cms-*` files are compatibility facades while callers migrate to this namespace.
