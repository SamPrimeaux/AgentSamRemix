# Agent Sam chat sessions — domain handoff

**Architecture SSOT:** [`docs/platform/repo-ownership-2026-08.md`](../../../docs/platform/repo-ownership-2026-08.md) (§ `agentsam/sessions/`)  
**Audit track:** [`docs/platform/repo-reorg-audit-2026-08.md`](../../../docs/platform/repo-reorg-audit-2026-08.md) (§ **A4**)  
**Wire law:** [`backend/protocol/acp.md`](../../protocol/acp.md) · [`backend/protocol/README.md`](../../protocol/README.md)

**Public boundary (external callers only):** `backend/agentsam/sessions/index.js`

---

## Hard law (non-negotiable)

1. **No `src/` bridges.** Do not re-export from `src/core/*` after a module moves here.  
   Shims defeat the peel — they hide duplicate authority and block dependency-law cleanup.

2. **Delete legacy paths in the same PR** that lands the backend module. Every importer
   updates to `backend/agentsam/sessions/*` (or `backend/http/agentsam/*` for routes).
   `git grep` for old paths must return **zero** before merge.

3. **Sessions = conversation state only.** Not execution, orchestration, vision, tool menus,
   spend accounting, planning, or multitask. Those belong in `backend/agentsam/runtime/`.

4. **Three authorities stay separate** (Phase 1 seq protocol builds on this):

   | Authority | Store | This domain owns |
   |-----------|-------|------------------|
   | Live messages + turn state | AgentSession DO (`src/do/AgentChat.js`) | `do/*` handlers |
   | Conversation metadata | D1 `agentsam_chat_sessions` | `metadata-repository.js` |
   | Durable archived context | R2 + `agentsam_context_digest` | `compaction/`, `r2-archive.js` |

5. **Not auth sessions.** `backend/identity/sessions/` = browser login / `auth_sessions`.
   This tree = **chat conversations** (`conversation_id`, AgentChat DO).

6. **Import law**

   ```text
   Outside backend/agentsam/sessions/  →  import ../sessions/index.js
   Inside  backend/agentsam/sessions/  →  import sibling modules directly (no barrel)
   ```

   `index.js` is the **external** public boundary — not an internal dependency graph hub.

7. **`peel-manifest.js` is migration bookkeeping** — not exported from `index.js`, not runtime API.
   Delete when the peel completes.

---

## Dependency direction

```text
backend/agentsam/runtime/     ← execution, modes, turn prep, tool-loop
        │
        │ uses
        ▼
backend/agentsam/sessions/    ← conversation state, DO handlers, window, compaction
```

Runtime **uses** conversations. Conversations do **not** own the Agent Sam runtime.

---

## Request flow (target)

```text
dashboard / MCP / ACP
        │
        ▼
backend/http/agentsam/chat-sessions.js   ← route table only
backend/http/agentsam/chat-turn.js       ← thin orchestration
        │
        ├──► backend/agentsam/runtime/    ← modes, turn prep, tool-loop
        │
        └──► backend/agentsam/sessions/   ← conversation state (this tree)
                    │
                    ├── metadata-repository.js  ──► D1
                    ├── do/messages.js            ──► AgentSession DO SQLite
                    ├── window/assemble.js        ──► inference working copy
                    └── compaction/compact.js     ──► archive + digest
        │
        ▼
src/do/AgentChat.js                      ← DO class shell only
```

`src/index.js` and `src/api/*` remain **worker composition** (bindings, auth, route mount).

---

## Long-term layout

```text
backend/agentsam/
│
├── sessions/                          # conversation state + lifecycle
│   ├── index.js                       # external public boundary only
│   ├── INTEGRATION.md
│   ├── peel-manifest.js               # migration tracker (not in index.js)
│   │
│   ├── metadata-repository.js
│   ├── title.js
│   ├── project-bind.js                # projects.id ↔ conversation binding
│   ├── lifecycle.js
│   ├── purge.js
│   │
│   ├── do/
│   │   ├── schema.js
│   │   ├── messages.js
│   │   ├── bootstrap.js
│   │   ├── context.js
│   │   ├── turn-outbox.js
│   │   └── ...
│   │
│   ├── window/
│   │   ├── assemble.js                # turn-context-assembler
│   │   └── hydrate.js
│   │
│   ├── compaction/
│   │   ├── compact.js
│   │   └── archive.js                 # r2-archive
│   │
│   ├── chat-do-client.js              # Worker → DO stub calls
│   ├── turn-outbox-client.js
│   └── tests/
│
└── runtime/                           # execution / orchestration
    ├── modes/                         # ask, plan, agent, debug, multitask
    ├── turn/                          # prepare, execute, accounting, tool-menu
    ├── tool-loop/                     # (partial peel exists)
    ├── routing/
    └── project-context.js             # github_repo, branch, active_file from request body
```

---

## `src/` → `backend/` mapping (delete source after each row)

### Sessions peel (this tree)

| Legacy | Target | Notes |
|--------|--------|-------|
| `agentsam-chat-sessions.js` | `metadata-repository.js` + `title.js` | **deleted S1** |
| `project-chat-link.js` (session bind) | `project-bind.js` | **deleted S1** — `resolveChatProjectId`, `expandChatProjectRefs`, … |
| `chat-session-do-messages.js` | `chat-do-client.js` | S3 |
| `chat-session-r2.js` | `compaction/archive.js` | S3 |
| `chat-turn-outbox.js` | `turn-outbox-client.js` | S3 |
| `chat-session-purge.js` | `purge.js` | S3 |
| `agent-session/*` | `do/*` | S2 — delete `agent-session/` folder name |
| `turn-context-assembler.js` | `window/assemble.js` | S4 |
| `conversation-compaction.js` | `compaction/compact.js` | S4 |
| `thread-on-demand.js` | `thread-on-demand.js` | **deleted** — `/compact` `/summarize`; messages via DO + `agentsam_chat_sessions` R2 keys |
| `chat-hydrate-window.js` | `window/hydrate.js` | S4 |
| `api/agent/chat/sessions.js` | `backend/http/agentsam/chat-sessions.js` | S6 |

### Runtime peel (separate track — **not** under sessions/)

| Legacy | Target | Notes |
|--------|--------|-------|
| `project-chat-link.js` (request context) | `runtime/project-context.js` | **deleted S1** — `parseProjectContextFromBody` |
| `mode-controllers/*` (21 files) | `runtime/modes/` + `runtime/turn/` | R5 — not `sessions/modes/` |
| `agent-tool-loop*.js` | `runtime/tool-loop/` | partial |

**`src/do/AgentChat.js`** stays as DO shell; imports handlers from `backend/agentsam/sessions/do/*`.

---

## Peel order

| Phase | Move | Exit proof |
|-------|------|------------|
| **S0** | Scaffold + this doc | Directory exists |
| **S1** | `metadata-repository`, `title`, `project-bind`; split `project-chat-link` | Zero `agentsam-chat-sessions.js`, zero `project-chat-link.js` |
| **S2** | `do/*` + repoint `AgentChat.js` | Zero `src/core/agent-session/` |
| **S3** | `chat-do-client`, `r2-archive`, outbox client | Delete `chat-session-*.js` cluster |
| **S4** | `window/*`, `compaction/*` | Delete assembler/compaction in `src/core` |
| **S6** | `backend/http/agentsam/chat-*.js` | API routes peel |
| **S7** | Seq/checkpoint on `do/messages.js` | Phase 1 protocol |
| **R5** | `runtime/modes/*`, `runtime/turn/*` | Zero `src/core/mode-controllers/` |

**Dependency law:** `sessions/` may import `backend/services/*`, `backend/identity/`.  
It must **not** import `src/api/*` or `backend/agentsam/runtime/*` (runtime depends on sessions, not reverse).

---

## Phase 0 contracts (implement during S1–S4)

1. **Compaction before window** — durable archive before `recent_verbatim_window`.
2. **Inference bootstrap cap** — `do/bootstrap.js`: `AGENT_INFERENCE_BOOTSTRAP_HISTORY_LIMIT = 120`.
3. **POST creates `agentsam_chat_sessions`** — not `agentsam_agent_run` on empty create.
4. **PATCH never CREATEs** — missing row → `not_found`.
5. **No timer session-list polling** — dashboard optimistic catalog.

---

## Public surface (`index.js`)

**External callers only:**

```javascript
import {
  ensureChatSessionRow,
  listUserChatSessions,
  getUserChatSession,
  patchUserChatSession,
  deleteUserChatSession,
  scheduleChatSessionTitleInsert,
  resolveChatProjectId,
  resolveConversationProjectRef,
} from '../../backend/agentsam/sessions/index.js';
```

**Inside the domain:**

```javascript
import { resolveSessionPatchProjectId } from './project-bind.js';
```

Symbols not yet exported = peel not done. Never re-export from `src/core`.

---

## Seq protocol (S7 — fits authority boundaries)

```text
AgentSession DO
  session_state: head_seq, compacted_through_seq, latest_digest_key
  session_messages: seq, turn_id, role, content
        │
        ▼
sessions/window/     inference window, UI history page
        │
        ▼
sessions/compaction/ archive [old_seq .. compacted_seq]
        │
        ▼
D1                   metadata projection only
```

---

## Tests

```bash
node --test backend/agentsam/sessions/tests/*.test.mjs
```

---

## Deliberate non-goals (this tree)

- Agent execution / mode controllers (`backend/agentsam/runtime/`)
- Dashboard session UI (`app/`)
- Auth sessions (`backend/identity/sessions/`)
- Terminal PTY (`backend/agentsam/terminal/`)
- MCP tool catalog (`backend/agentsam/catalog/`)
