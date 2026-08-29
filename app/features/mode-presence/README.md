# Mode Presence UI Library

Source of truth for **Agent Sam presence / loading states** across the dashboard and future CMS surfaces.

## What this is

This package provides:

- A **canonical state model** (`AgentPresenceState`) shared across surfaces (chat, workflows, approvals, subagents).
- A **stable mapping** from `mode + state → iconKey` and `state → iconKey` with safe fallbacks.
- Reusable UI components:
  - `AgentModePresenceIcon` (just the animated icon)
  - `AgentPresenceInline` (row/header)
  - `AgentPresenceCard` (card/panel)
- A runtime resolver `resolveAgentPresenceState()` for turning raw runtime signals into a state.

## Modes

`AgentMode`:

- `agent`
- `ask`
- `plan`
- `debug`
- `multitask`

## States (canonical)

See `AgentPresenceState` in `agentModePresenceMap.ts`.

## Mapping

### Mode-scoped (when you know `mode`)

- Agent: `tool_routing → tool-route`, `executing → execute-pulse`, `writing → patch-sweep`, `verifying → verify-bloom`
- Ask: `reading_context → context-scan`, `tracing_sources → source-thread`, `answering → answer-forming`, `clarifying → clarify-gate`
- Plan: `mapping → map-build`, `task_stack → task-stack`, `risk_scan → risk-radar`, `handoff_ready → handoff-ready`, `planning → agent-spark`
- Debug: `trace_probe → trace-probe`, `fault_isolate → fault-isolate`, `hypothesis → patch-hypothesis`, `regression_check → regression-check`
- Multitask: `subagent_spawn → subagent-swarm`, `delegate_subtask → delegate-chain`, `parallel_work → parallel-orbit`, `multitask_fanout → fanout-orbit`, `merge_results → merge-weave`, `summarizing_subagents → merge-weave`

### Global states

- `thinking → agent-spark`
- `planning → agent-spark`
- `task_queue → work-queue`
- `tool_routing → tool-router`
- `waiting_approval → review-gate`
- `approval_required → approval-wait`
- `complete → done-bloom`
- `failed → error-signal`
- `loading_panel → skeleton-plan`

### Legacy concrete tool states (compat)

Maps existing surface/tool classification states:

- `reading → scan`
- `database → scan`
- `tool → scan`
- `writing → diff`
- `terminal → terminal`
- `browser → browser`
- `files → files`
- `drawing → path`
- `imaging → pixel`

## When to use what

### `AgentModePresenceIcon`

Use when you only need the glyph.

```tsx
<AgentModePresenceIcon mode="debug" state="trace_probe" size={18} aria-label="Debugging" />
```

### `AgentPresenceInline`

Use for headers/rows (ThinkingCard, active task row, subagent row).

```tsx
<AgentPresenceInline
  mode="multitask"
  state="subagent_spawn"
  title="Spawning focused subagents"
  meta="4 delegates · streaming"
/>
```

### `AgentPresenceCard`

Use for cards/panels (subagent status cards, workflow progress).

```tsx
<AgentPresenceCard
  mode="agent"
  state="verifying"
  title="Verifying build"
  meta="vite build · gzip sizes"
/>
```

## CSS installation

Animations are global and loaded by the dashboard root:

- `app/dashboard/index.css` imports `./features/mode-presence/agentModePresenceMotion.css`

Do not rely on ChatAssistant-only imports for global availability.

