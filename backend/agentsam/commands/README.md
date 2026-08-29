# `/backend/agentsam/commands`

Runtime implementation of `agentsam_commands` rows (slash, palette, in-turn dispatch).

Postgres analog: `src/backend/commands` (CREATE/ALTER/DROP live next to `catalog/`, not in `src/bin`).

| Here | Not here |
|------|----------|
| `resolve.js` · `execute.js` | `tools/agentsam/commands/` (operator CLI) |
| Prepare / approve / run **one** catalog command | Tool-loop turns (`runtime/tool-loop/`) |
| Telemetry via `backend/telemetry/commands/` | HTTP parsing (`backend/http/agentsam/`) |

Lifted from `runtime/commands/` so catalog and commands sit at the same depth. No compatibility shim at the old path.
