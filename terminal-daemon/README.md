# AgentSamRemix Terminal Daemon

Ported from `ExecOS` (`server.js` + `lib/ws-pty.js`), which was already
architecturally decoupled from inneranimalmedia's own D1/auth — auth here
is a plain bearer-token check, renamed from `PTY_AUTH_TOKEN` to
`AGENTSAM_BRIDGE_KEY` to match this repo's existing convention.

## Why this is a separate process, not part of the Worker

Cloudflare Workers cannot spawn native processes or PTYs. This daemon runs
as a normal Node process — on your Mac for the `local` lane, on a VM for
the `vm` lane — and the Worker's `/api/terminal/local` and `/api/terminal/vm`
routes (see `app/backend/src/index.ts`) proxy to it rather than executing
anything themselves.

## Setup

```bash
cd terminal-daemon
npm install
AGENTSAM_BRIDGE_KEY=<same value set via wrangler secret> node server.js
```

Do not run this without `AGENTSAM_BRIDGE_KEY` set — check `server.js` and
`lib/ws-pty.js` fail closed (refuse to serve) when it's missing, and keep
it that way. Never add a hardcoded fallback value here — that exact
mistake exists in ExecOS's dead `iam-pty/server.js`, untracked and never
pushed, and it should stay deleted, not get copied forward.

## Not yet wired

The Worker routes currently 501. Proxying `/api/terminal/local` and
`/api/terminal/vm` to this daemon over WebSocket is the next real step —
this commit only adds the daemon itself.
