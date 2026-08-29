# AgentSamRemix Terminal Daemon

Ported from `ExecOS` — real scope, verified by actually running it, not by
guessing at the import graph (took several attempts to get right; the
final verification was starting the process and watching it either crash
or bind a port).

## What's actually here

19 files, ~3,200 lines: `server.js`, `router.js`, `context-manager.js`,
and `lib/`+`shared/` covering PTY session lifecycle, exec security policy,
command vocabulary/allowlisting, operator identity, machine auth, MCP
filesystem bridge, and the WebSocket PTY relay itself.

`lib/machine-auth.js` already uses `AGENTSAM_BRIDGE_KEY` as its primary
credential (with `EXECOS_KEY` as a legacy alias) — same contract as
inneranimalmedia's own `backend/auth/bridge-key-auth.js`. No auth
rewrite needed, this was already built to the right convention.

Coupling to inneranimalmedia is limited to env-var-overridable defaults
(`WORKER_URL || "https://inneranimalmedia.com"`) and optional
`tenant_id`/`workspace_id` query params — nothing hardwired to D1 or
`auth_users`.

## Why this is a separate process, not part of the Worker

Cloudflare Workers cannot spawn native processes or PTYs. This daemon
runs as a normal Node process — on your Mac for the `local` lane, on a
VM for the `vm` lane — and the Worker's `/api/terminal/local` and
`/api/terminal/vm` routes proxy to it rather than executing anything
themselves.

## Setup

```bash
cd terminal-daemon
npm install
AGENTSAM_BRIDGE_KEY=<same value set via wrangler secret> PTY_PORT=3199 node server.js
```

Default port is 3099 — same default as ExecOS itself. If ExecOS's real
daemon is also running on this machine, set `PTY_PORT` to something else
(verified working on 3199) or you'll hit `EADDRINUSE`.

Never add a hardcoded fallback credential here — that mistake exists in
ExecOS's dead, untracked `iam-pty/server.js` and should stay there, not
get copied forward.

## Not yet wired

The Worker routes currently 501. Proxying `/api/terminal/local` and
`/api/terminal/vm` to this daemon over WebSocket is the next real step.
