# Agent Sam Mobile UX — visual source of truth

These references define the prioritized mobile UX for AgentSamRemix. The implementation should preserve the interaction model while using real AgentSam runtime data only — no simulated mission, terminal, browser, file, test, or approval results.

## Reference screens

1. `01-mission-timeline-light` — active mission summary, execution timeline, pending approval, fixed composer.
2. `02-chat-plan-files-dark` — conversational plan, live progress, edited-file summary, repo/branch context chips.
3. `03-chat-work-progress-dark` — Chat / Work navigation, work-in-progress timeline, edited files.
4. `04-chat-home-light` — mobile home, quick actions, recent conversations, fixed safe-area composer.
5. `05-terminal-bottom-sheet-dark` — conversation + draggable terminal bottom sheet with explicit execution lane.

## Product rules captured by these references

- Mobile-first. A persistent `Chat | Work` segmented pill is **not** part of the active-conversation chrome.
- Once a conversation exists, the active chat header should mirror the ChatGPT mobile interaction pattern closely: a floating circular/bubble hamburger control at the top-left and a compact floating `•••` conversation-options pill at the top-right. These controls are the stable mobile chrome; do not replace them with workspace, mode, context, or execution selectors.
- The hamburger opens the global navigation/history drawer. The `•••` pill manages the current conversation (for example Pin, Add to project, uploaded files, find, archive, delete as those behaviors are implemented).
- Chat remains the primary conversational surface. Work/execution detail is contextual and must not become a permanent mode switch occupying the active-chat header.
- Agent work renders as compact structured activity, expandable for detail.
- Terminal is a bottom sheet, not a separate IDE screen.
- Local / VM / Sandbox (and future Environment) remain explicit execution lanes with no silent lane failover.
- Repository, branch, and other context use compact chips near the composer rather than permanent heavy chrome.
- Composer remains available and respects mobile safe-area / keyboard behavior.
- The active-conversation composer follows the ChatGPT iOS interaction model closely: one calm rounded floating input, `+` at the lower-left, text input as the dominant element, microphone at the lower-right, and one primary circular action at the far-right that changes between Voice/Send/Stop based on state.
- Do not permanently expose Agent mode, RuntimeProfile, workspace, repo, execution lane, tool profile, or context selectors in the mobile composer. Model choice is conversation configuration, not permanent composer chrome; expose it through conversation/options or an explicit secondary sheet.
- `+` is the single entry to turn-scoped additions: upload/photo, generated-image prompt, web/deep search, connectors, and other explicit sources. Voice/persona settings belong in a secondary sheet/settings; the composer keeps only the primary microphone/voice affordance.
- Explicitly attached sources/files may appear as removable compact chips/previews above the text field. They are ephemeral turn inputs by default and must not become Library/Artifacts merely because they passed through chat.
- The composer uses neutral conversation styling rather than mode-colored borders/glows. Send is enabled only when there is sendable text/input; while Agent Sam is working the primary action becomes Stop without changing the rest of the composer layout.
- File edits, diffs, browser sessions, approvals, tests, and environment lifecycle are backed by real runtime events.

The five visual files are intentionally treated as design fixtures, not application runtime assets.
