# `backend/agentsam/runtime/tool-loop`

Agent Sam in-app tool loop — model → tools → model state machine + per-tool host.

**Golden import (external):** `backend/agentsam/runtime/tool-loop/index.js`

---

## Hard law

1. **No `src/` bridges.** Do not re-export from `src/core/agent-tool-loop*.js` or
   `src/core/agent-tool-host-*.js`. Delete legacy files in the same PR that lands
   the backend module.

2. **Runtime never imports HTTP.** `backend/agentsam/runtime/**` must **not** import
   `src/api/*` as a dependency hub. HTTP/composition imports **into** runtime.

3. **`run.js` owns order; siblings own behavior.** Do not grow `run.js` back into a
   god-function.

---

## Layout

| Module | Role |
|--------|------|
| `run.js` | `runAgentToolLoop` — model → tools → model orchestration only |
| `state.js` | loopBag, dispatch spine, IDs, budgets, counters |
| `limits.js` | cancel, timeout, max turns/tools, spend gate |
| `outcome.js` | safeDone, halt, cancelled/timeout/success results, usage telemetry schedule |
| `persistence.js` | persist turn via `backend/agentsam/sessions` (single-owner completion) |
| `capability-pins.js` | named catalog + image capability pins |
| `ptc.js` | OpenAI Responses PTC helpers |
| `recovery.js` | text-only / empty-end-turn recovery |
| `artifact.js` | post-loop artifact schedule |
| `model-turn/` | provider dispatch + stream consume + usage |
| `host.js` | `dispatchToolCallsViaHost` |
| `preflight.js` / `execute.js` / `finalize.js` | per-tool host pipeline |
| `ceiling.js` / `block-log.js` / `apply-patch.js` / `helpers.js` | host support |

---

## Dependency direction

```text
backend/http/agentsam
        │
        ▼
backend/agentsam/runtime/modes
        │
        ▼
backend/agentsam/runtime/tool-loop
        │
        ├── sessions/                      (persist, assemble)
        ├── backend/telemetry/             (recordUsage, tool-chain)
        └── src/core/*                     (providers, catalog, guardrails — peel residual by domain)
```

**Law:** `backend/agentsam/runtime/**` must not import `src/api/**` for telemetry/accounting.
Usage + tool-chain writers live under `backend/telemetry/`.

---

## Callers

Import:

```javascript
import { runAgentToolLoop } from '../../backend/agentsam/runtime/tool-loop/index.js';
```

Do **not** reach `runAgentToolLoop` through `src/api/agent.js`.
