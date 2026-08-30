# Adoption matrix

The target is **AgentSamRemix with better presentation**, not Cloudflare OS transplanted into AgentSamRemix.

| agentsam-os pattern | Upstream reference | AgentSamRemix owner to evolve | Adoption rule |
| --- | --- | --- | --- |
| Calm two-pane workspace + draggable chat width | `GadgetEditor.tsx` | `app/components/shell/AppShellFrame.tsx`, `app/components/ChatAssistant/components/ChatSplitLayout.tsx` | Reuse current shell/runtime; port proportions, chrome, and resize behavior only. |
| Quiet left conversation while work happens | `ChatInterface.tsx` | `ChatAssistantView.tsx`, `components/AgentMessageList.tsx`, `execution/*` | Keep AgentSam SSE/tool state. Replace presentation incrementally. |
| Compact expandable work/tool rows | `ChatInterface.tsx` | `execution/ExecutionTimeline.tsx`, `execution/ToolTraceRow.tsx` | Strong first migration candidate. Existing AgentSam tool data should drive the new row. |
| Generated output/artifact card in chat | `CreatedGadgetChatCard` in `ChatInterface.tsx` | AgentSam artifact cards + `execution/ArtifactChipList.tsx` | Adopt the visual/card contract, not Gadget RPC. |
| Generic right work surface with dynamic label (`Slides`, `Document`, `App`) | `rightTabs()` in `GadgetEditor.tsx`, `components/format/*` | Existing preview/editor/browser/artifact surfaces | Introduce an AgentSam output descriptor instead of adding more hard-coded product modes. |
| Sandboxed generated UI preview | `GadgetUI.tsx` | `app/components/EditorPreviewPane.tsx` + existing sandbox/browser lanes | Preserve AgentSam sandbox policy; borrow loading, framing, and fullscreen UX. |
| Code as a peer of output instead of a separate product | `GadgetCodeInterface.tsx` | Existing Monaco editor workbench | Keep current Monaco/files/runtime. Simplify the surrounding chrome. |
| Connections as a peer tab | `Connections.tsx` | Existing composer connectors + settings/integration authority | Never create a second connection authority. Surface the existing one contextually. |
| Multiple generated outputs in a compact rail | `WorkpiecePicker.tsx` | Existing artifacts/open tabs/scratchpad concepts | Later phase, after the primary workspace shell is stable. |
| Neutral surfaces + one intent accent | `styles.css` | AgentSam theme/dashboard tokens | Port tokens deliberately; never paste the upstream stylesheet globally. |
| Small consistent controls | `components/WorkshopControls.tsx` | Existing shared UI primitives | Improve primitives first, then screens. Avoid screen-by-screen one-off styling. |
| Token-aware resource composer | upstream composer helpers | Current AgentSam composer/source chips | Preserve modes, voice, sources, and iOS behavior; borrow rendering mechanics selectively. |

## Do not bulk-port

- Cloudflare OS workspace identity/security semantics.
- `Overseer`, `GadgetClient`, Gatekeeper RPC, Cap'n Web, or Yjs simply because the reference files use them.
- The `/workspace/$id` route as a new product root.
- Kumo as a mandatory dependency before evaluating whether its primitives actually improve our current system.
- Gadget runtime as a replacement for MYBROWSER, AgentSam terminal lanes, artifacts, or current sandbox/container execution.
- Any UI change that hides AgentSam capabilities merely to look closer to the screenshot.

## Recommended migration order

1. **Workspace chrome** — calmer top bar, proportions, right-pane tab strip, resize behavior.
2. **Execution transcript** — compact expandable work rows and cleaner markdown hierarchy.
3. **Artifact contract** — generated-output cards + dynamic output labels/thumbnails.
4. **Work surface shell** — consistent Output / Code / Connections presentation around existing AgentSam capabilities.
5. **Theme pass** — neutral surface tokens, borders, shadows, motion, reduced visual noise.
6. **Mobile translation** — only after desktop structure is stable; retain existing iOS/PWA constraints and mobile composer behavior.

Each phase should be its own small commit or PR-sized migration. The old implementation stays until the replacement is
visibly working, so we never end up with a half-converted Agent UI.
