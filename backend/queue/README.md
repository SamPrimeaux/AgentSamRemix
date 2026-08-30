# Queue boundary

`backend/queue/` is the Cloudflare Queue transport boundary, parallel to
`backend/http/`. `backend/worker/queue.js` owns the Worker `queue()` lifecycle;
this directory normalizes/dispatches queue messages to domain-owned handlers.

Queue transport must not become a domain dumping ground. New handlers should:

- carry explicit tenant/workspace scope for user-owned work;
- reference logical resources/configuration, not hardcoded physical bucket names;
- never carry raw credentials or require one platform user's `.env` secrets;
- delegate execution to the owning domain (`backend/rag`, `backend/browser`,
  `backend/agentsam`, `backend/cms`, etc.);
- fail closed on unknown/unscoped user work so retry/DLQ policy can act.

The existing dispatcher still contains legacy payload-shape compatibility and is
scheduled for a versioned, multi-tenant envelope migration.
