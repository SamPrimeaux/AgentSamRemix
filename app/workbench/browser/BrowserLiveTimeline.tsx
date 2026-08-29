/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Timeline cards from AgentBrowserLiveV1 live_browser_events outbox.
 */

import React from 'react';
import { Check, Loader2, AlertTriangle, Globe, Camera, User } from 'lucide-react';

export type BrowserLiveTimelineEvent = {
  id?: number | string;
  event_type: string;
  payload_json?: string;
  created_at?: number | string;
  type?: string;
  tool_name?: string;
  url?: string;
  title?: string;
  reason?: string;
  created_at_iso?: string;
};

function parsePayload(raw: BrowserLiveTimelineEvent): Record<string, unknown> {
  if (raw.payload_json) {
    try {
      return JSON.parse(raw.payload_json) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
}

export function labelBrowserLiveEvent(ev: BrowserLiveTimelineEvent): string {
  const type = String(ev.event_type || ev.type || '').toLowerCase();
  const payload = parsePayload(ev);
  const tool = String(payload.tool_name || ev.tool_name || '').toLowerCase();

  switch (type) {
    case 'browser_session_starting':
      return 'Starting live browser session';
    case 'browser_session_ready':
      return 'Live browser session ready';
    case 'browser_live_view_ready':
      return 'Live browser view ready';
    case 'browser_live_view_refresh':
      return 'Refreshed live browser view';
    case 'browser_live_view_refresh_failed':
      return 'Live view refresh failed';
    case 'browser_action_started':
      if (tool.includes('navigate')) return 'Navigating in live browser';
      if (tool.includes('click')) return 'Clicking in live browser';
      if (tool.includes('fill')) return 'Filling form in live browser';
      return 'Working in live browser';
    case 'browser_action_done':
      return 'Browser action complete';
    case 'browser_human_input_required':
      return 'Waiting for you in the live browser';
    case 'browser_human_input_resumed':
      return 'Continued in live browser';
    case 'browser_human_input_cancelled':
      return 'Human input cancelled';
    case 'browser_session_closed':
      return 'Live browser session closed';
    default:
      return type.replace(/_/g, ' ') || 'Browser update';
  }
}

function previewForEvent(ev: BrowserLiveTimelineEvent): string | undefined {
  const payload = parsePayload(ev);
  const url = payload.url != null ? String(payload.url) : ev.url;
  const title = payload.title != null ? String(payload.title) : ev.title;
  const reason = payload.reason != null ? String(payload.reason) : ev.reason;
  if (reason) return reason.slice(0, 120);
  if (title) return title.slice(0, 120);
  if (url) return url.slice(0, 120);
  return undefined;
}

function iconForEvent(type: string) {
  const t = type.toLowerCase();
  if (t.includes('human_input')) return User;
  if (t.includes('capture') || t.includes('screenshot')) return Camera;
  if (t.includes('closed') || t.includes('failed') || t.includes('cancelled')) return AlertTriangle;
  if (t.includes('done') || t.includes('ready') || t.includes('resumed')) return Check;
  if (t.includes('starting') || t.includes('started') || t.includes('refresh')) return Loader2;
  return Globe;
}

export type BrowserLiveTimelineProps = {
  events: BrowserLiveTimelineEvent[];
  className?: string;
};

export function BrowserLiveTimeline({ events, className = '' }: BrowserLiveTimelineProps) {
  if (!events.length) return null;

  const rows = [...events]
    .sort((a, b) => {
      const ai = Number(a.id ?? 0);
      const bi = Number(b.id ?? 0);
      return ai - bi;
    })
    .slice(-12);

  return (
    <div
      className={`shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/60 max-h-28 overflow-y-auto ${className}`}
    >
      <div className="px-3 py-1.5 text-[9px] font-mono uppercase tracking-widest text-muted">
        Live browser timeline
      </div>
      <ul className="px-2 pb-2 space-y-1">
        {rows.map((ev, idx) => {
          const type = String(ev.event_type || ev.type || 'event');
          const Icon = iconForEvent(type);
          const preview = previewForEvent(ev);
          return (
            <li
              key={String(ev.id ?? `${type}-${idx}`)}
              className="flex items-start gap-2 px-1 py-0.5 rounded text-[10px] text-muted"
            >
              <Icon size={11} className="shrink-0 mt-0.5 text-[var(--color-primary)]" />
              <div className="min-w-0">
                <div className="text-[var(--text-primary)] leading-snug">{labelBrowserLiveEvent(ev)}</div>
                {preview ? (
                  <div className="truncate opacity-80 font-mono text-[9px]">{preview}</div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
