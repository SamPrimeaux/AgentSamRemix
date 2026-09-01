# inneranimalmedia-mcp-server ↔ AgentSamRemix wiring

AgentSamRemix executes proven tools from the D1 catalog (`agentsam_tools`) and
routes MCP-backed rows to registered servers in `agentsam_mcp_servers`. The
canonical hosted MCP server is **inneranimalmedia-mcp-server** at
`https://mcp.inneranimalmedia.com/mcp`.

## Build & verify (run before deploy)

```bash
npm ci
npm run verify:sdk-cli      # installed @inneranimalmedia/agentsam-sdk CLI
npm run verify:mcp-bridge   # schema twin modules + bridge manifest
npm run test:bin-lib
npm run build               # Vite SPA + export MCP bridge artifact
```

After `npm run build`, import `dist/mcp-bridge/manifest.json` from
**inneranimalmedia-mcp-server** to align tool schemas and server URLs.

## Schema twins (must stay in sync)

| AgentSamRemix | inneranimalmedia-mcp-server |
|---------------|----------------------------|
| `src/core/mcp-memory-search-schema.js` | `src/mcp-memory-search-schema.js` |
| `src/core/mcp-memory-save-schema.js` | `src/mcp-memory-save-schema.js` |
| `src/core/mcp-plan-schema.js` | `src/mcp-plan-schema.js` |
| `src/core/mcp-github-public-schema.js` | `src/mcp-github-public-schema.js` |
| `src/core/d1-write-contract.js` | `src/mcp-d1-write-contract.js` |

CI runs `npm run verify:mcp-bridge` on every push.

## Tool execution path

```
Agent chat → catalog-execution-runtime.js
          → handler_type=mcp → catalog-tool-mcp.js
          → resolveMcpServerForTool (agentsam_mcp_servers)
          → POST inneranimalmedia-mcp-server /mcp (tools/call)
          → agentsam_tool_call_log telemetry
```

## Operator CLI

```bash
npm run agentsam -- sdk status
npm run agentsam -- context --json
npm run agentsam -- acp serve          # stdio ACP bridge → Agent Sam API
npm run agentsam -- deploy fast        # Remix Worker + assets
```

Portable SDK verbs delegate to `@inneranimalmedia/agentsam-sdk` (pinned from
GitHub in `package.json` until npm alpha catches up).

## MCP server repo consolidation checklist

1. Copy or diff schema twins listed in `config/mcp-server/bridge.manifest.json`
2. Register server row: `server_key = inneranimalmedia-mcp-server`, `url = https://mcp.inneranimalmedia.com/mcp`
3. Point `agentsam_tools.handler_config.server_key` at proven tools
4. Import `dist/mcp-bridge/manifest.json` after Remix build for drift checks
5. Run MCP server ratchet tests against the same schema export names
