# ACP — Agent Client Protocol (runtime)

Wire law for IAM as an **ACP agent** (provider-agnostic clients: Zed, JetBrains,
VS Code ACP, scripted clients).

**SDK:** `@agentclientprotocol/sdk` (repo root dependency)  
**Surface:** `POST /api/acp` (`src/api/acp/`)  
**Local stdio:** `backend/agentsam/acp/serve.mjs`

## Transport (Phase 0 — locked)

| Option | Result |
|--------|--------|
| Custom JSON-RPC framing | **Rejected** |
| WebSocket-first lock | **Rejected** until proven on Workers |
| Streamable HTTP NDJSON for `session/prompt` | **Chosen** (agent side) |
| `ndJsonStream` + `agent()` (SDK) | Local stdio bridge |
| `createHttpStream` (experimental/http-client) | Client-side POST + SSE |

Spike receipt: `docs/platform/acp-transport-spike-2026-08.md`

## Domain

| Concept | Store / binding |
|---------|-----------------|
| `sessionId` | `agentsam_chat_sessions.conversation_id` (+ AgentChat DO) |
| Per-prompt run | `agentsam_agent_run` — one row per `session/prompt` |
| Anti-pattern | Using `arun_*` as `sessionId` |

## Files

| Piece | Path |
|-------|------|
| HTTP handler | `src/api/acp/handler.js` |
| Capabilities / initialize | `src/api/acp/capabilities.js` |
| JSON-RPC helpers | `src/api/acp/jsonrpc.js` |
| Stdio bridge | `backend/agentsam/acp/serve.mjs` |

## Operator run (local)

```bash
export AGENTSAM_ACP_URL=https://inneranimalmedia.com/api/acp
export AGENTSAM_ACP_TOKEN=…   # or AGENTSAM_ACP_COOKIE
node backend/agentsam/acp/serve.mjs
```

## Planes (do not merge)

- **ACP client FS / client terminal** — editor Client methods (`fs/*`, `terminal/*`)
- **IAM execution** — `client_fs`, `terminal_exec` (local / VM / sandbox)

Full contract: `plans/active/AGENTSAM-ACP-SDK-E2E-2026-08.md` (rev 2.1+)
