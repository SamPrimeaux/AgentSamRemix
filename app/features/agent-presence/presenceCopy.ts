/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentPresenceState } from './presenceTypes';

/** Short pools — pick deterministically via `pickPresenceLine` (no random chaos). */
export const presenceCopy: Record<
  AgentPresenceState,
  readonly string[]
> = {
  idle: ['Ready when you are.', 'Standing by in this workspace.'],
  thinking: ['Reading the context before acting.', 'Mapping the next safe step.'],
  planning: ['Turning this into a trackable plan.', 'Breaking the work into clean steps.'],
  reading: ['Inspecting the workspace.', 'Checking the source before guessing.'],
  web_search: ['Searching the web in the background.', 'Finding current sources without opening a browser.'],
  web_fetch: ['Reading the linked page.', 'Fetching source text for the answer.'],
  writing: ['Drafting the file-backed change.', 'Writing this where it can be reviewed.'],
  tool: ['Using a tool with live feedback.', 'Executing a checked workspace action.'],
  terminal: ['Running in the workspace terminal.', 'Watching stdout and stderr.'],
  browser: ['Inspecting browser context.', 'Checking the page state.'],
  browser_live: ['Navigating in the live browser.', 'Driving the page you can watch.'],
  browser_debug: ['Verifying current page state.', 'Checking URL and visible content.'],
  browser_human_input: ['Waiting for you in the live browser.', 'Paused for human input in the browser.'],
  browser_capture: ['Capturing a requested browser proof.', 'Saving the requested browser artifact.'],
  filing: ['Saving generated artifact.', 'Uploading proof to storage.'],
  database: ['Reading live schema and rows.', 'Checking IDs before writing.'],
  waiting_approval: ['Waiting for approval before risky action.', 'Nothing runs until you confirm.'],
  complete: ['Done, with proof attached.', 'Completed and logged.'],
  failed: ['Stopped safely with an error to inspect.', 'Failed before making unsafe assumptions.'],
};

function hashToIndex(seed: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return modulo ? h % modulo : 0;
}

export function pickPresenceLine(state: AgentPresenceState, seed: string): string {
  const pool = presenceCopy[state];
  if (!pool?.length) return '';
  return pool[hashToIndex(seed, pool.length)] ?? pool[0];
}

/** Optional operational one-liner from tool name (witty but concrete). */
export function toolPersonaLine(toolName: string): string | null {
  const t = toolName.toLowerCase();
  if (t.includes('d1') || t.includes('sql') || t.includes('supabase'))
    return 'Reading the schema before touching rows.';
  if (t.includes('py_compile') || t.includes('python3'))
    return 'Syntax-checking the generated Python file.';
  if (t.includes('terminal') || t === 'terminal_run')
    return 'Running safely in the workspace terminal.';
  if (t.includes('tavily') || t.includes('search_web') || t.includes('open_web_search'))
    return 'Searching the web in the background.';
  if (t.includes('web_fetch') || t.includes('fetch_url') || t.includes('markdown'))
    return 'Reading source text without opening a browser.';
  if (t.includes('screenshot') || t.includes('capture') || t.includes('quality_report'))
    return 'Capturing proof only because it was requested.';
  if (t.includes('human_input') || t.includes('hitl'))
    return 'Paused so you can finish this step in the live browser.';
  if (t.includes('browser_verify') || t.includes('verify_current_page'))
    return 'Verifying navigation in the live browser.';
  if (t.includes('browser_scroll'))
    return 'Scrolling the live browser page.';
  if (t.includes('browser_navigate') || t.includes('cdt_navigate'))
    return 'Navigating in the live browser.';
  if (t.includes('browser_content') || t.includes('cdt_take_snapshot') || t.includes('console') || t.includes('network'))
    return 'Inspecting page state in the live browser.';
  if (t.includes('live_view') || t.includes('browser_session') || t.startsWith('cdt_') || t.includes('playwright'))
    return 'Working in the same live browser session you can watch.';
  if (t.includes('r2') || t.includes('artifact'))
    return 'Collecting generated artifacts.';
  if (t.includes('monaco') || t.includes('file'))
    return 'Opening the draft for review.';
  if (t.includes('excalidraw') || t.includes('draw'))
    return 'Opening a visual scratchpad.';
  return null;
}
