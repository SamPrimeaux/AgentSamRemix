# ACP stdio bridge (local operator)

Spike / CLI entry for Agent Client Protocol — stdio agent forwarding to Worker `POST /api/acp`.

| Piece | Path |
|-------|------|
| Local stdio bridge | `backend/agentsam/acp/serve.mjs` |
| Wire law | `backend/protocol/acp.md` |
| Worker HTTP | `src/api/acp/*` |

Wire protocol: `@agentclientprotocol/sdk` (repo root dependency).

```bash
export AGENTSAM_ACP_URL=https://inneranimalmedia.com/api/acp
export AGENTSAM_ACP_TOKEN=…   # or AGENTSAM_ACP_COOKIE
node backend/agentsam/acp/serve.mjs
```

Planes (do not conflate):

- ACP client FS / client terminal → editor Client methods
- IAM `client_fs` / `terminal_exec` → governed execution

Plan: `plans/active/AGENTSAM-ACP-SDK-E2E-2026-08.md`
