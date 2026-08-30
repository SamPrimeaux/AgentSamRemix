# HTTP boundary

`backend/http/` owns HTTP protocol adaptation only: route matching, request parsing,
auth/scope handoff, response/status/header shaping, and streaming/SSE framing.

Domain behavior should live under its owning backend domain and be called from the
HTTP adapter. Queue consumers, cron/jobs, workflow execution, credential policy,
filesystem/Git runtimes, model/routing logic, and persistence services do not
belong here merely because an HTTP route can trigger them.

Current migration debt still exists under `backend/http/agentsam/routes/*-runtime.js`
and several large settings routes. New domain behavior must not be added there.
