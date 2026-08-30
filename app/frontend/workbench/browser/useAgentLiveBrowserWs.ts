/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebSocket subscription to AgentBrowserLiveV1 /ws for agentLive surface.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { BrowserLiveTimelineEvent } from './BrowserLiveTimeline.tsx';

export type AgentLiveBrowserSnapshot = {
  browser_session_id?: string;
  agent_run_id?: string;
  session_id?: string;
  url?: string | null;
  title?: string | null;
  devtools_frontend_url?: string | null;
  status?: string;
  expires_at?: string | null;
};

type WsMessage = {
  type?: string;
  live_session?: AgentLiveBrowserSnapshot | null;
  events?: BrowserLiveTimelineEvent[];
  event_type?: string;
  devtools_frontend_url?: string;
  live_view_url?: string;
  reason?: string;
  tool_name?: string;
  url?: string;
  title?: string;
  verified?: boolean;
  session_id?: string;
  browser_session_id?: string;
};

export type UseAgentLiveBrowserWsOptions = {
  browserSessionId?: string | null;
  enabled?: boolean;
  onSnapshot?: (snap: AgentLiveBrowserSnapshot | null) => void;
  onLiveViewUrl?: (url: string) => void;
  onHumanInputRequired?: (detail: { reason?: string; live_view_url?: string; url?: string }) => void;
  onHumanInputCleared?: () => void;
};

function wsUrl(browserSessionId: string): string {
  const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : '';
  return `${proto}//${host}/api/browser/live/ws?browser_session_id=${encodeURIComponent(browserSessionId)}`;
}

export function useAgentLiveBrowserWs(opts: UseAgentLiveBrowserWsOptions) {
  const {
    browserSessionId,
    enabled = true,
    onSnapshot,
    onLiveViewUrl,
    onHumanInputRequired,
    onHumanInputCleared,
  } = opts;

  const [connected, setConnected] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<BrowserLiveTimelineEvent[]>([]);
  const [liveSession, setLiveSession] = useState<AgentLiveBrowserSnapshot | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const appendEvent = useCallback((ev: BrowserLiveTimelineEvent) => {
    setTimelineEvents((prev) => {
      const id = ev.id ?? `${ev.event_type}-${prev.length}`;
      if (prev.some((r) => String(r.id) === String(id))) return prev;
      return [...prev, { ...ev, id }];
    });
  }, []);

  const handleMessage = useCallback(
    (raw: WsMessage) => {
      const type = String(raw.type || raw.event_type || '').toLowerCase();
      if (type === 'session_snapshot' && raw.live_session) {
        setLiveSession(raw.live_session);
        onSnapshot?.(raw.live_session);
        const lv = raw.live_session.devtools_frontend_url;
        if (lv) onLiveViewUrl?.(lv);
        return;
      }
      if (type === 'events_bootstrap' && Array.isArray(raw.events)) {
        setTimelineEvents(raw.events);
        return;
      }
      if (type === 'browser_live_view_ready' || type === 'browser_live_view_refresh') {
        const lv = raw.devtools_frontend_url || raw.live_view_url;
        if (lv) onLiveViewUrl?.(lv);
      }
      if (type === 'browser_url_committed') {
        const lv = raw.live_view_url || raw.devtools_frontend_url;
        if (lv) onLiveViewUrl?.(lv);
        if (typeof window !== 'undefined' && raw.url) {
          window.dispatchEvent(
            new CustomEvent('iam-browser-url-committed', {
              detail: {
                url: raw.url,
                title: raw.title,
                verified: raw.verified !== false,
                session_id: raw.session_id,
                live_view_url: lv,
                browser_session_id: raw.browser_session_id,
              },
            }),
          );
        }
      }
      if (type === 'browser_human_input_required') {
        onHumanInputRequired?.({
          reason: raw.reason,
          live_view_url: raw.live_view_url || raw.devtools_frontend_url,
          url: raw.url,
        });
      }
      if (
        type === 'browser_human_input_resumed' ||
        type === 'browser_human_input_cancelled'
      ) {
        onHumanInputCleared?.();
      }
      if (type) {
        appendEvent({
          event_type: type,
          type,
          tool_name: raw.tool_name,
          url: raw.url,
          title: raw.title,
          reason: raw.reason,
          payload_json: JSON.stringify(raw),
          id: `${type}-${Date.now()}`,
        });
      }
      if (raw.live_session) {
        setLiveSession(raw.live_session);
        onSnapshot?.(raw.live_session);
      }
    },
    [appendEvent, onHumanInputCleared, onHumanInputRequired, onLiveViewUrl, onSnapshot],
  );

  useEffect(() => {
    const bsid = browserSessionId?.trim();
    if (!enabled || !bsid) {
      setConnected(false);
      return undefined;
    }

    let cancelled = false;
    let retryMs = 1500;

    const connect = () => {
      if (cancelled) return;
      try {
        const ws = new WebSocket(wsUrl(bsid));
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          setConnected(true);
          retryMs = 1500;
          pingRef.current = setInterval(() => {
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch {
              /* ignore */
            }
          }, 25_000);
        };

        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(String(evt.data || '{}')) as WsMessage;
            handleMessage(data);
          } catch {
            /* ignore */
          }
        };

        ws.onclose = () => {
          setConnected(false);
          if (pingRef.current) {
            clearInterval(pingRef.current);
            pingRef.current = null;
          }
          if (!cancelled) {
            setTimeout(connect, retryMs);
            retryMs = Math.min(retryMs * 1.5, 15_000);
          }
        };

        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        };
      } catch {
        if (!cancelled) setTimeout(connect, retryMs);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [browserSessionId, enabled, handleMessage]);

  return { connected, timelineEvents, liveSession, setTimelineEvents };
}
