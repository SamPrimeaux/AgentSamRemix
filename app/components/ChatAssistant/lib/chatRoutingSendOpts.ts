/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { QuickstartThreadDetail } from '../../../agentChatConstants';

export type ChatRoutingSendOpts = {
  modelKey?: string;
  subagent_slug?: string;
  task_type?: string;
  route_key?: string;
  quickstart_batch?: string;
  quickstart_card?: string;
  apply_eto_after_run?: boolean;
  workspace_id?: string;
  force_plan_mode?: boolean;
  project_slug?: string;
  page_id?: string | null;
  bootstrap_cache_key?: string | null;
  collab_room?: string | null;
  live_session_id?: string | null;
  /** Voice turn: synthesize the completed assistant response after SSE. */
  voiceTurn?: boolean;
  /** Handoff child session — bypass stale React conversationId on auto-continue. */
  conversationIdOverride?: string;
  handoffResume?: boolean;
};

export function routingSendOptsFromDetail(detail?: QuickstartThreadDetail | null): ChatRoutingSendOpts | undefined {
  if (!detail) return undefined;
  const opts: ChatRoutingSendOpts = {};
  if (detail.modelKey?.trim()) opts.modelKey = detail.modelKey.trim();
  // Explicit compose/quickstart pins only (e.g. CAD Studio operator button id → task_type).
  // Never invent these from message text or ambient surface refs in handleSend.
  if (detail.task_type?.trim()) opts.task_type = detail.task_type.trim();
  if (detail.route_key?.trim()) opts.route_key = detail.route_key.trim();
  if (detail.quickstart_batch?.trim()) opts.quickstart_batch = detail.quickstart_batch.trim();
  if (detail.quickstart_card?.trim()) opts.quickstart_card = detail.quickstart_card.trim();
  if (detail.apply_eto_after_run) opts.apply_eto_after_run = true;
  if (detail.workspace_id?.trim()) opts.workspace_id = detail.workspace_id.trim();
  if (detail.force_plan_mode) opts.force_plan_mode = true;
  if (detail.project_slug?.trim()) opts.project_slug = detail.project_slug.trim();
  if (detail.page_id != null && String(detail.page_id).trim()) {
    opts.page_id = String(detail.page_id).trim();
  }
  if (detail.bootstrap_cache_key?.trim()) {
    opts.bootstrap_cache_key = detail.bootstrap_cache_key.trim();
  }
  if (detail.collab_room?.trim()) opts.collab_room = detail.collab_room.trim();
  if (detail.live_session_id?.trim()) opts.live_session_id = detail.live_session_id.trim();
  return Object.keys(opts).length ? opts : undefined;
}

/** Map SSE subagent row slugs onto agent-presence AgentPresenceState. */
