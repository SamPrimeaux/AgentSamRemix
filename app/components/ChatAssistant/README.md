# ChatAssistant — File Tree & Architecture

> Powers `/dashboard/agent` — the primary Agent Sam chat interface.

---

## Directory Structure

```
app/dashboard/components/
├── ChatAssistant.tsx                        ← re-export shim (19 lines, back-compat entrypoint)
│
└── ChatAssistant/
    ├── ChatAssistant.tsx                    ← REAL implementation (~2800 lines)
    ├── index.ts                             ← barrel exports
    ├── types.ts                             ← shared types + constants
    ├── streamParsing.ts                     ← SSE + text normalization helpers
    ├── streamDebug.ts                       ← window.__IAM_AGENT_LAST_STREAM_DEBUG helpers
    ├── mentionContext.ts                    ← @mention context builder
    ├── composerLayout.ts                    ← composer sizing/layout helpers
    │
    ├── hooks/
    │   └── useAgentChatStream.ts            ← SSE stream consumer (consumeAgentChatSseBody)
    │
    ├── components/
    │   ├── AgentMessageList.tsx
    │   ├── AgentChatMarkdown.tsx
    │   ├── AgentCodeFencePreview.tsx
    │   ├── AgentCodeDiffPreview.tsx
    │   ├── DiffViewer.tsx
    │   ├── AgentPlanChecklist.tsx
    │   └── WorkflowRunBoard.tsx
    │
    ├── execution/
    │   ├── index.ts                         ← barrel (types + components)
    │   ├── types.ts                         ← AgentToolTraceRow, AgentToolTraceStatus, etc.
    │   ├── shShellQuote.ts                  ← shellSingleQuote util
    │   ├── ExecutionTimeline.tsx
    │   ├── ArtifactChipList.tsx
    │   ├── ToolTraceRow.tsx
    │   ├── ScrollablePreviewPanel.tsx
    │   └── ScriptDraftPanel.tsx
    │
    └── artifacts/
        └── EmailArtifactCard.tsx
```

---

## Public Surface

### `ChatAssistant.tsx` (shim) — re-exports
| Export | Source |
|---|---|
| `ChatAssistant` | `./ChatAssistant/ChatAssistant` |
| `IAM_AGENT_CHAT_CONVERSATION_CHANGE` | `./ChatAssistant/types` |
| `IAM_AGENT_CHAT_NEW_THREAD` | `./ChatAssistant/types` |
| `normalizeAssistantSseText` | `./ChatAssistant/streamParsing` |
| `looksLikeRawProviderLeak` | `./ChatAssistant/streamParsing` |
| `ssePayloadLooksReasoningOnly` | `./ChatAssistant/streamParsing` |
| `isStreamErrorPayload` | `./ChatAssistant/streamParsing` |
| `extractMonacoInvokesFromBuffer` | `./ChatAssistant/streamParsing` |
| `hideIncompleteMonacoInvokeTail` | `./ChatAssistant/streamParsing` |
| `looksLikeEmbeddedFileDumpStart` | `./ChatAssistant/streamParsing` |
| `formatHttpErrorMessage` | `./ChatAssistant/streamParsing` |

### `index.ts` (folder barrel) — re-exports
| Export | Notes |
|---|---|
| `ChatAssistant` | main component |
| `IAM_AGENT_CHAT_CONVERSATION_CHANGE` | event constant |
| `* from ./streamParsing` | all parsing helpers |
| Types: `ChatAssistantProps`, `Message`, `MessageAttachmentPreview`, `ChatModelRow`, `ExecPanelState`, `WorkflowLedgerState` | |

---

## Key Modules

### `streamParsing.ts`
Core SSE normalization layer. All raw provider output runs through here before render.
- `normalizeAssistantSseText(parsed)`
- `looksLikeRawProviderLeak(data)`
- `ssePayloadLooksReasoningOnly(data)`
- `isStreamErrorPayload(data)`
- `extractMonacoInvokesFromBuffer(buf)`
- `hideIncompleteMonacoInvokeTail(buf)`
- `looksLikeEmbeddedFileDumpStart(data)`
- `formatHttpErrorMessage(data)`
- `IMAGE_GENERATION_SSE_TYPES` (constant)

### `hooks/useAgentChatStream.ts`
- `consumeAgentChatSseBody(ctx)` — main SSE consumer, drives all stream state

### `streamDebug.ts`
Dev/debug utilities. Exposed on `window.__IAM_AGENT_LAST_STREAM_DEBUG`.
- `initIamAgentStreamDebug(debugId)`
- `patchIamAgentStreamDebug(patch)`
- `markStreamParserError(msg)`

### `mentionContext.ts`
- `buildMentionContext(...)` — assembles context payload for @mentions
- `getEditorLightweightPath(af)`
- `getEditorDisplayPath(af, activeFileName?)`

### `execution/index.ts`
- `shellSingleQuote`
- `ScrollablePreviewPanel`, `ToolTraceRow`, `ExecutionTimeline`, `ArtifactChipList`, `ScriptDraftPanel`
- Types: `AgentToolTraceRow`, `AgentToolTraceStatus`, `ArtifactChipListProps`

---

## SSE Events Handled (ChatAssistant.tsx internal)

| Event | Description |
|---|---|
| `thinking_start` | Opens ThinkingCard, starts live timer |
| `thinking` | Streams reasoning text into ThinkingCard |
| `tool_start` | Opens ToolTraceRow |
| `tool_done` | Closes ToolTraceRow with result |
| `tool_error` | Marks trace row failed |
| `tool_blocked` | Triggers ToolApprovalModal → sets `activeCommandRunId` |
| `workflow_step` | Updates WorkflowRunBoard ledger |
| `workflow_complete` | Finalizes WorkflowRunBoard |
| `done` | Closes stream, finalizes message |
| `error` | Renders stream error state |
| `approval_required` | Fires `onApprovalRequired(runId)` → `setAgentIsStreaming` |

---

## Filesystem Notes

- **Mac filesystem is case-insensitive** — `chatAssistant/` and `ChatAssistant/` resolve to the same directory.
  Git tracks the canonical casing: `ChatAssistant/`. Never import using lowercase path.
- The top-level shim `app/dashboard/components/ChatAssistant.tsx` **may not exist on disk** if it was never recreated. If missing, recreate it as the 19-line re-export wrapper.
- Never import directly from `ChatAssistant/ChatAssistant.tsx`. Always go through the barrel (`ChatAssistant/index.ts`) or the shim.
