# ChatAssistant — File Tree & Architecture

> Powers `/dashboard/agent` — the primary Agent Sam chat interface.

---

## Directory Structure

```
app/components/ChatAssistant/
├── ChatAssistant.tsx                    ← real implementation
├── index.ts                             ← public barrel / compatibility entrypoint
├── types.ts                             ← shared types + constants
├── streamParsing.ts                     ← SSE + text normalization helpers
├── streamDebug.ts                       ← stream debug helpers
├── mentionContext.ts                    ← @mention context builder
├── composerLayout.ts                    ← composer sizing/layout helpers
├── hooks/
│   └── useAgentChatStream.ts            ← SSE stream consumer
├── components/                          ← message, diff, workflow, mobile UI
├── composer/                            ← composer controls, sources, voice
├── execution/                           ← tool timeline/output panels
└── artifacts/
    └── EmailArtifactCard.tsx
```

---

## Public Surface

### `index.ts` (folder barrel) — public surface
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
- The top-level shim `app/components/ChatAssistant.tsx` **may not exist on disk** if it was never recreated. If missing, recreate it as the 19-line re-export wrapper.
- Never import directly from `ChatAssistant/ChatAssistant.tsx`. Always go through the barrel (`ChatAssistant/index.ts`) or the shim.
