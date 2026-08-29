# Runtime protocols (`backend/protocol/`)

**Start here** for IAM Worker-side wire law — transport framing, session/run domain,
and cross-surface contracts. Implementation lives under `backend/*` and `src/api/*`;
this tree is spec + index only.

## Three homes (do not conflate)

| Home | Path | Owns |
|------|------|------|
| **Runtime wire** | `backend/protocol/` (this tree) | ACP, memory, SKP, bootstrap envelopes, MCP OAuth shapes |
| **SDK dual-home** | `agentsam-sdk/protocol/` | Portable tool contracts mirrored to npm |
| **Browser client** | `app/protocol/` | Dashboard/PWA consumption of Worker APIs |

`packages/platform-contracts` and `packages/client-core` are the **typed** client
contracts today; `app/protocol/` documents how they map to HTTP until the
`app/dashboard/` peel is complete.

## Protocol index

| Protocol | Spec | Implementation |
|----------|------|----------------|
| Agent Client Protocol (ACP) | [`acp.md`](./acp.md) | `backend/agentsam/acp/`, `src/api/acp/` |
| Agent Sam memory | [`memory.md`](./memory.md) | `backend/services/memory/`, `src/core/catalog-tool-memory.js` |
| Semantic Knowledge (SKP) | [`knowledge.md`](./knowledge.md) | `backend/services/knowledge/` |
| SDK tool dual-home | [`../agentsam-sdk/protocol/README.md`](../agentsam-sdk/protocol/README.md) | `agentsam-sdk/python/`, npm publish |

## Rules

1. **No custom framing** where an official SDK exists (ACP → `@agentclientprotocol/sdk`).
2. **Session vs run** — `sessionId` is conversation scope; each prompt creates
   `agentsam_agent_run` (never `arun_*` as sessionId).
3. **Two execution planes** — ACP client FS/terminal (editor-provided) ≠ IAM
   `client_fs` / `terminal_exec` (governed execution). See plan
   `plans/active/AGENTSAM-ACP-SDK-E2E-2026-08.md`.
4. **Spec before drift** — change this tree (or `agentsam-sdk/protocol/`) in the
   same PR as wire or JSON shape changes.

Plan: `plans/active/AGENTSAM-ACP-SDK-E2E-2026-08.md` · Ownership:
`docs/platform/repo-ownership-2026-08.md`
