# `/backend/agentsam` — Agent Sam product runtime

High-level siblings (Postgres `src/backend/` idea, IAM names):

```
backend/agentsam/
├── catalog/       # what exists (tools, models, command rows)
├── commands/      # prepare/resolve/execute those command rows
├── runtime/       # tool-loop, modes, spawn, plan — residual until executor peel
├── sessions/      # chat conversation state (not auth sessions)
├── terminal/      # PTY / command-trust
├── mcp/           # MCP panel + zone contracts
└── …
```

| Folder | Owns | Not |
|--------|------|-----|
| `catalog/` | D1 rows + DTOs (`agentsam_tools`, `agentsam_commands`, models) | Execution |
| `commands/` | Authorize, record, run one catalog command | Operator CLI (`bin/agentsam …`) |
| `runtime/tool-loop/` | Multi-step agent turn (future `executor/`) | HTTP adapters |

Do not add `backend/commands/` at the platform root. Agent Sam is one product inside `backend/`; CMS, workflows, and identity stay siblings.

Operator health and deploy stay at `bin/agentsam`. See `.cursor/rules/iam-operator-cli.mdc`.
