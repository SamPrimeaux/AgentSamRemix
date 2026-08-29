/**
 * Inline SVG loaders extracted from Agent Sam Loading States Lab.
 * R2 mirror: static/templates/ui/agent-sam-loading-states-lab/
 */

import type { AgentPresenceIcon, AgentPresenceState } from './iamPresenceStateMap';

export const PRESENCE_ICON_SVG: Record<AgentPresenceIcon, string> = {
  // Legacy "surface" icons (100x100 viewbox)
  spark: `<svg class="spark iam-presence-icon" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"><path class="ray" d="M50 7v18"/><path class="ray" d="M80.4 19.6 67.7 32.3"/><path class="ray" d="M93 50H75"/><path class="ray" d="M80.4 80.4 67.7 67.7"/><path class="ray" d="M50 93V75"/><path class="ray" d="M19.6 80.4 32.3 67.7"/><path class="ray" d="M7 50h18"/><path class="ray" d="M19.6 19.6 32.3 32.3"/></g><circle class="core" cx="50" cy="50" r="9" fill="currentColor"/></svg>`,
  scan: `<svg class="scan-ring iam-presence-icon" viewBox="0 0 100 100" aria-hidden="true"><circle class="frame" cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="5"/><circle class="ring" cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><g class="crosshair" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><path d="M50 31v38"/><path d="M31 50h38"/></g><circle cx="50" cy="50" r="5" fill="currentColor"/></svg>`,
  terminal: `<svg class="terminal-icon iam-presence-icon" viewBox="0 0 100 100" aria-hidden="true"><rect x="18" y="24" width="64" height="52" rx="12" fill="none" stroke="currentColor" stroke-width="5" opacity="0.42"/><path class="prompt" d="M31 43l10 8-10 8" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path class="cursor" d="M50 61h20" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>`,
  diff: `<svg class="diff-icon iam-presence-icon" viewBox="0 0 100 100" aria-hidden="true"><g class="line" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"><path d="M24 31h52"/><path d="M24 50h52"/><path d="M24 69h52"/></g><path d="M28 31h20M52 50h22M34 69h26" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><rect class="sweep" x="38" y="18" width="18" height="64" rx="9" fill="currentColor" opacity="0.22"/></svg>`,
  pixel: `<svg class="pixel-icon iam-presence-icon" viewBox="0 0 100 100" aria-hidden="true"><rect class="px" x="24" y="24" width="18" height="18" rx="4" fill="currentColor"/><rect class="px" x="48" y="20" width="14" height="14" rx="4" fill="currentColor"/><rect class="px" x="61" y="43" width="18" height="18" rx="4" fill="currentColor"/><rect class="px" x="39" y="45" width="16" height="16" rx="4" fill="currentColor"/><rect class="px" x="22" y="63" width="14" height="14" rx="4" fill="currentColor"/><rect class="px" x="49" y="67" width="22" height="12" rx="4" fill="currentColor"/></svg>`,
  path: `<svg class="path-icon iam-presence-icon" viewBox="0 0 100 100" aria-hidden="true"><path class="draw" d="M18 68C28 26 51 83 62 39c5-18 16-23 23-12" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path class="pen" d="M72 66l14-14 7 7-14 14-9 2 2-9z" fill="currentColor" opacity="0.86"/></svg>`,
  files: `<svg class="files-icon iam-presence-icon" viewBox="0 0 100 100" aria-hidden="true"><path class="file-b" d="M28 20h30l14 14v39H28z" fill="none" stroke="currentColor" stroke-width="5" opacity="0.42"/><path class="file-a" d="M20 30h30l14 14v39H20z" fill="none" stroke="currentColor" stroke-width="5"/><path d="M50 30v14h14" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  browser: `<svg class="browser-icon iam-presence-icon" viewBox="0 0 100 100" aria-hidden="true"><rect class="viewport" x="16" y="22" width="68" height="56" rx="11" fill="none" stroke="currentColor" stroke-width="5"/><path d="M16 38h68" stroke="currentColor" stroke-width="5" opacity="0.28"/><path class="scanline" d="M25 50h50" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle class="node" cx="35" cy="58" r="3" fill="currentColor"/><circle class="node" cx="61" cy="58" r="3" fill="currentColor" style="animation-delay:-.5s"/></svg>`,

  // Agent-work loading states lab icons (48x48 viewbox)
  'agent-spark': `<svg viewBox="0 0 48 48" class="agent-spark iam-presence-icon" aria-hidden="true"><line class="stroke ray" x1="24" y1="5" x2="24" y2="11"></line><line class="stroke ray" x1="24" y1="37" x2="24" y2="43"></line><line class="stroke ray" x1="5" y1="24" x2="11" y2="24"></line><line class="stroke ray" x1="37" y1="24" x2="43" y2="24"></line><line class="stroke ray" x1="11" y1="11" x2="15" y2="15"></line><line class="stroke ray" x1="33" y1="33" x2="37" y2="37"></line><line class="stroke ray" x1="37" y1="11" x2="33" y2="15"></line><line class="stroke ray" x1="15" y1="33" x2="11" y2="37"></line><circle class="fill core" cx="24" cy="24" r="3"></circle></svg>`,
  'subagent-swarm': `<svg viewBox="0 0 48 48" class="subagent-swarm iam-presence-icon" aria-hidden="true"><line class="stroke link" x1="24" y1="24" x2="13" y2="15"></line><line class="stroke link" x1="24" y1="24" x2="35" y2="15"></line><line class="stroke link" x1="24" y1="24" x2="10" y2="32"></line><line class="stroke link" x1="24" y1="24" x2="38" y2="32"></line><line class="stroke link" x1="24" y1="24" x2="24" y2="8"></line><rect class="node a" x="21" y="21" width="6" height="6" rx="1.5"></rect><rect class="node b" x="10" y="12" width="6" height="6" rx="1.5"></rect><rect class="node c" x="32" y="12" width="6" height="6" rx="1.5"></rect><rect class="node b" x="7" y="29" width="6" height="6" rx="1.5"></rect><rect class="node a" x="35" y="29" width="6" height="6" rx="1.5"></rect><rect class="node c" x="21" y="5" width="6" height="6" rx="1.5"></rect></svg>`,
  'fanout-orbit': `<svg viewBox="0 0 48 48" class="fanout-orbit iam-presence-icon" aria-hidden="true"><circle class="stroke orbit" cx="24" cy="24" r="14"></circle><circle class="fill sat" cx="24" cy="10" r="3"></circle><circle class="fill sat" cx="38" cy="24" r="3"></circle><circle class="fill sat" cx="24" cy="38" r="3"></circle><circle class="fill sat" cx="10" cy="24" r="3"></circle><circle class="fill" cx="24" cy="24" r="4"></circle></svg>`,
  'delegate-chain': `<svg viewBox="0 0 48 48" class="delegate-chain iam-presence-icon" aria-hidden="true"><line class="stroke dash" x1="15" y1="24" x2="33" y2="24"></line><rect class="stroke box" x="6" y="16" width="12" height="16" rx="4"></rect><rect class="stroke box" x="18" y="16" width="12" height="16" rx="4"></rect><rect class="stroke box" x="30" y="16" width="12" height="16" rx="4"></rect></svg>`,
  'work-queue': `<svg viewBox="0 0 48 48" class="work-queue iam-presence-icon" aria-hidden="true"><rect class="fill bar" x="9" y="11" width="30" height="5" rx="2.5"></rect><rect class="fill bar" x="9" y="20" width="24" height="5" rx="2.5"></rect><rect class="fill bar" x="9" y="29" width="32" height="5" rx="2.5"></rect><rect class="fill bar" x="9" y="38" width="18" height="5" rx="2.5"></rect></svg>`,
  'tool-router': `<svg viewBox="0 0 48 48" class="tool-router iam-presence-icon" aria-hidden="true"><circle class="fill hub" cx="24" cy="24" r="4"></circle><line class="stroke route" x1="24" y1="24" x2="12" y2="13"></line><line class="stroke route" x1="24" y1="24" x2="36" y2="13"></line><line class="stroke route" x1="24" y1="24" x2="36" y2="35"></line><circle class="stroke end" cx="12" cy="13" r="4"></circle><circle class="stroke end" cx="36" cy="13" r="4"></circle><circle class="stroke end" cx="36" cy="35" r="4"></circle></svg>`,
  'review-gate': `<svg viewBox="0 0 48 48" class="review-gate iam-presence-icon" aria-hidden="true"><rect class="stroke gate" x="12" y="11" width="24" height="26" rx="6"></rect><path class="stroke check" d="M18 25l4 4 9-11"></path></svg>`,
  'merge-weave': `<svg viewBox="0 0 48 48" class="merge-weave iam-presence-icon" aria-hidden="true"><path class="stroke" d="M8 14c10 0 10 20 20 20s10-20 12-20"></path><path class="stroke" d="M8 34c10 0 10-20 20-20s10 20 12 20"></path><circle class="fill dot" cx="8" cy="14" r="2.5"></circle><circle class="fill dot" cx="24" cy="24" r="3"></circle><circle class="fill dot" cx="40" cy="34" r="2.5"></circle></svg>`,
  'approval-wait': `<svg viewBox="0 0 48 48" class="approval-wait iam-presence-icon" aria-hidden="true"><circle class="stroke ring" cx="24" cy="24" r="15"></circle><line class="stroke pause" x1="20" y1="17" x2="20" y2="31"></line><line class="stroke pause" x1="28" y1="17" x2="28" y2="31"></line></svg>`,
  'done-bloom': `<svg viewBox="0 0 48 48" class="done-bloom iam-presence-icon" aria-hidden="true"><circle class="stroke burst" cx="24" cy="24" r="15"></circle><path class="stroke tick" d="M16 25l6 6 12-15"></path></svg>`,
  'error-signal': `<svg viewBox="0 0 48 48" class="error-signal iam-presence-icon" aria-hidden="true"><g class="shake"><circle class="stroke pulse" cx="24" cy="24" r="15"></circle><line class="stroke" x1="18" y1="18" x2="30" y2="30"></line><line class="stroke" x1="30" y1="18" x2="18" y2="30"></line></g></svg>`,
  'skeleton-plan': `<svg viewBox="0 0 48 48" class="skeleton-plan iam-presence-icon" aria-hidden="true"><defs><linearGradient id="iam-skel" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="currentColor" stop-opacity="0.12"/><stop offset="50%" stop-color="currentColor" stop-opacity="0.26"/><stop offset="100%" stop-color="currentColor" stop-opacity="0.12"/></linearGradient></defs><rect class="skel box" x="10" y="10" width="28" height="10" rx="4" fill="url(#iam-skel)"/><rect class="skel line l1" x="10" y="24" width="30" height="4" rx="2" fill="url(#iam-skel)"/><rect class="skel line l2" x="10" y="31" width="24" height="4" rx="2" fill="url(#iam-skel)"/><rect class="skel line l3" x="10" y="38" width="18" height="4" rx="2" fill="url(#iam-skel)"/></svg>`,
};

/** Semantic table: presence state → animated icon key. */
export function presenceStateToIcon(state: string | null | undefined): AgentPresenceIcon {
  switch (String(state || 'idle').toLowerCase()) {
    // Agent-work phases
    case 'thinking':
    case 'planning':
      return 'agent-spark';
    case 'subagent_spawn':
      return 'subagent-swarm';
    case 'delegate_subtask':
      return 'delegate-chain';
    case 'multitask_fanout':
    case 'parallel_work':
      return 'fanout-orbit';
    case 'task_queue':
      return 'work-queue';
    case 'tool_routing':
      return 'tool-router';
    case 'waiting_approval':
      return 'review-gate';
    case 'approval_required':
      return 'approval-wait';
    case 'merge_results':
    case 'summarizing_subagents':
      return 'merge-weave';
    case 'complete':
      return 'done-bloom';
    case 'failed':
      return 'error-signal';
    case 'loading_panel':
      return 'skeleton-plan';

    // Legacy surface states
    case 'reading':
    case 'database':
    case 'web_search':
    case 'web_fetch':
    case 'tool':
      return 'scan';
    case 'writing':
      return 'diff';
    case 'terminal':
      return 'terminal';
    case 'browser':
    case 'browser_live':
      return 'browser';
    case 'browser_debug':
      return 'scan';
    case 'browser_capture':
    case 'filing':
    case 'files':
      return 'files';
    case 'browser_human_input':
      return 'approval-wait';
    case 'drawing':
      return 'path';
    case 'imaging':
      return 'pixel';
    case 'idle':
    default:
      return 'spark';
  }
}

export function presenceIconMarkup(icon: AgentPresenceIcon): string {
  return PRESENCE_ICON_SVG[icon] || PRESENCE_ICON_SVG.spark;
}
