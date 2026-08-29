# Agent Sam Mobile UX — visual source of truth

These references define the prioritized mobile UX for AgentSamRemix. The implementation should preserve the interaction model while using real AgentSam runtime data only — no simulated mission, terminal, browser, file, test, or approval results.

## Reference screens

1. `01-mission-timeline-light` — active mission summary, execution timeline, pending approval, fixed composer.
2. `02-chat-plan-files-dark` — conversational plan, live progress, edited-file summary, repo/branch context chips.
3. `03-chat-work-progress-dark` — Chat / Work navigation, work-in-progress timeline, edited files.
4. `04-chat-home-light` — mobile home, quick actions, recent conversations, fixed safe-area composer.
5. `05-terminal-bottom-sheet-dark` — conversation + draggable terminal bottom sheet with explicit execution lane.

## Product rules captured by these references

- Mobile-first; `Chat | Work` is the primary product navigation.
- Chat remains the primary surface. Work presents the current artifact or execution context.
- Agent work renders as compact structured activity, expandable for detail.
- Terminal is a bottom sheet, not a separate IDE screen.
- Local / VM / Sandbox (and future Environment) remain explicit execution lanes with no silent lane failover.
- Repository, branch, and other context use compact chips near the composer rather than permanent heavy chrome.
- Composer remains available and respects mobile safe-area / keyboard behavior.
- File edits, diffs, browser sessions, approvals, tests, and environment lifecycle are backed by real runtime events.

The five visual files are intentionally treated as design fixtures, not application runtime assets.
