/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Map SSE / tool events to user-facing ThinkingCard step labels (not raw tool_name).
 */

export type ThinkingStepEvent = {
  type?: string;
  tool_name?: string;
  node_key?: string;
  title?: string;
  label?: string;
  execution_lane?: string;
  lane?: string;
};

/** Raw tool_name → short inline label (e.g. agentsam_github_read → github read). */
export function simplifyToolName(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return 'working';
  return t.replace(/^agentsam_/i, '').replace(/_/g, ' ').toLowerCase();
}

export function formatThinkingStepName(ev: ThinkingStepEvent): string {
  const tool = String(ev.tool_name || ev.node_key || '').toLowerCase();
  const lane = String(ev.execution_lane || ev.lane || '').toLowerCase();

  if (lane === 'open_web_search' || tool.includes('search_web') || tool.includes('tavily'))
    return 'Searching the web';

  if (lane === 'web_fetch' || tool.includes('web_fetch'))
    return 'Reading source page';

  if (tool.includes('browser_human_input') || tool.includes('hitl'))
    return 'Waiting for human input';

  if (tool.includes('browser_verify') || tool.includes('verify_current_page'))
    return 'Verifying current page';

  if (tool.includes('browser_scroll')) return 'Scrolling live browser page';

  if (tool.includes('browser_navigate') || tool.includes('cdt_navigate'))
    return 'Navigating in live browser';

  if (tool.includes('browser_content') || tool.includes('cdt_take_snapshot'))
    return 'Inspecting page state';

  if (tool.includes('live_view') || tool.includes('browser_session'))
    return 'Starting live browser session';

  if (tool.includes('cdt_') || tool.includes('playwright'))
    return 'Working in live browser';

  if (tool.includes('screenshot') || tool.includes('capture'))
    return 'Capturing requested proof';

  return ev.title || ev.label || ev.tool_name || ev.node_key || 'Working';
}

/** User-facing labels for agent live browser SSE events. */
export function formatBrowserLiveSseStepName(eventType: string): string {
  switch (eventType) {
    case 'browser_session_starting':
      return 'Starting live browser session';
    case 'browser_session_ready':
      return 'Live browser session ready';
    case 'browser_live_view_ready':
      return 'Live browser ready';
    case 'browser_action_started':
      return 'Working in live browser';
    case 'browser_action_done':
      return 'Browser action complete';
    case 'browser_human_input_required':
      return 'Waiting for you in the live browser';
    case 'browser_human_input_resumed':
      return 'Continued in live browser';
    case 'browser_live_view_refresh':
      return 'Refreshed live browser view';
    case 'browser_url_committed':
      return 'URL verified in live browser';
    case 'browser_verification_failed':
      return 'Navigation not confirmed';
    case 'browser_navigated':
      return 'Navigated in live browser';
    case 'browser_scrolled':
      return 'Scrolled live browser page';
    case 'browser_human_input_cancelled':
      return 'Human input cancelled';
    case 'browser_session_closed':
      return 'Live browser session closed';
    default:
      return 'Browser session update';
  }
}

export function upsertThinkingStep<T extends { id: string; name: string; status: string; preview?: string }>(
  steps: T[],
  step: T,
): T[] {
  const idx = steps.findIndex((s) => s.id === step.id);
  if (idx >= 0) {
    const next = [...steps];
    next[idx] = { ...next[idx], ...step };
    return next;
  }
  return [...steps, step];
}
