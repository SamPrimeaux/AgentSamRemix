# CMS HTTP Route Modules

These modules are the transport boundary behind `src/api/cms.js`.

Rules:

- Return `null` when a module does not own the request path/method.
- Own HTTP parsing, compatibility response shapes, status codes, and host-specific request transport only.
- Reusable CMS business rules belong under `src/core/agentsam/cms/`.
- D1/R2/KV mechanics belong in canonical Cloudflare adapters or an explicit host adapter, not in `src/api/cms.js`.
- Do not turn a route module into a replacement mega-service. Split by capability when transport grows.
- Preserve bridge ordering: context/integration discovery may run before client-worker interception; platform-hosted content routes run only after bridge/client-worker routing resolves.
- Route aliases may be preserved for compatibility, but canonical product vocabulary is Page → Section → Block.
