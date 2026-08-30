# AgentSamRemix terminal: built-in VPC VM

The zero-config interactive terminal target in AgentSamRemix is the Cloudflare `PTY_SERVICE` VPC binding.

## Request path

```text
browser xterm
  -> GET /api/agent/terminal/config-status
  -> WS  /api/agent/terminal/ws
  -> Worker-authenticated runtime scope
  -> PTY_SERVICE VPC binding
  -> http://localhost:3099/terminal (WebSocket upgrade)
```

One-shot execution follows the same infrastructure boundary:

```text
POST /api/exec/run (default lane when omitted: remote)
POST /api/agent/terminal/run (xterm reconnect fallback)
  -> executeTerminalLane(remote)
  -> PTY_SERVICE /exec
```

## Ownership rules

- `PTY_SERVICE` is platform infrastructure and does not require a per-user `terminal_connections` row.
- Git/user/workspace product context may authorize and locate resources; it does not create a separate terminal implementation.
- The browser never receives `AGENTSAM_BRIDGE_KEY` or any PTY backend secret.
- `Local` (`user_hosted_tunnel`) remains explicit/opt-in until its Remix runtime is equally stable.
- `ExecOS` remains available for lanes it owns, but the bound permanent VM does not add an unnecessary ExecOS hop.
