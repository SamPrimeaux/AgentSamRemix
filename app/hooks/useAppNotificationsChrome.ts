/** Notifications deep-link + mobile chrome / health labels (Wave 2). */
import React, { useCallback, useEffect, useMemo } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  IAM_OPEN_STATUS_NOTIF,
  IAM_PUSH_NAVIGATE,
  IAM_PUSH_RECEIVED,
  resolveNotificationDeepLink,
  toRouterPath,
} from '../lib/notificationDeepLink';
import {
  AGENT_EDITOR_PATH,
  AGENT_HOME_PATH,
  isAgentShellPath,
} from '../lib/agentRoutes';
import { buildPlatformHealthIssues } from '../src/lib/platformHealth';
import { mobileNavBackLabel } from '../components/shell/mobileNavBackLabel';
import type { AgentNotificationRow } from '../components/StatusBar';
import type { EditorModelMeta } from '../types/editorModel';
import type { AgentPanelPosition } from './useAppPanelLayout';
import { IAM_PALETTE_OPEN_R2 } from '../src/lib/agentSamFilesystemTypes';

export function useAppNotificationsChrome(opts: {
  navigate: NavigateFunction;
  locationPathname: string;
  locationSearch: string;
  setAgentNotifications: React.Dispatch<React.SetStateAction<AgentNotificationRow[]>>;
  setFocusNotificationId: React.Dispatch<React.SetStateAction<string | null>>;
  isNarrowViewport: boolean;
  activeActivity: any;
  setActiveActivity: React.Dispatch<React.SetStateAction<any>>;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
  engageAgentEditorWorkbench: () => void;
  agentChatLayout: string;
  agentPosition: AgentPanelPosition;
  isDesignStudioRoute: boolean;
  mobileSwipeStartRef: React.MutableRefObject<{ x: number; y: number } | null>;
  narrowBackToCenter: () => void;
  editorMeta: EditorModelMeta;
  healthOk: boolean | null;
  tunnelHealthy: boolean | null;
  tunnelStale: boolean;
  terminalOk: boolean | null;
  sandboxOk: boolean | null;
  workspaceDrift: any;
}) {
  const {
    navigate, locationPathname, locationSearch, setAgentNotifications, setFocusNotificationId,
    isNarrowViewport, activeActivity, setActiveActivity, setAgentPosition,
    engageAgentEditorWorkbench, agentChatLayout, agentPosition, isDesignStudioRoute,
    mobileSwipeStartRef, narrowBackToCenter, editorMeta,
    healthOk, tunnelHealthy, tunnelStale, terminalOk, sandboxOk, workspaceDrift,
  } = opts;

  const markNotificationRead = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/agent/notifications/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        credentials: 'same-origin',
      });
      if (r.ok) setAgentNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch {
      /* ignore */
    }
  }, []);

  const openNotificationDestination = useCallback(
    async (n: AgentNotificationRow) => {
      const path = toRouterPath(
        resolveNotificationDeepLink({
          entityType: n.entity_type,
          entityId: n.entity_id,
          data: n.data,
          href: n.href,
          url: n.url,
          fallback: '/dashboard/agent',
        }),
      );
      navigate(path);
      const notifId = String(n.id || '').trim();
      if (notifId) setFocusNotificationId(notifId);
    },
    [navigate],
  );

  // Push notification click → land on the deep-linked route (and optional notif highlight).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === IAM_PUSH_RECEIVED) {
        void fetch('/api/agent/notifications', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (payload && Array.isArray(payload.notifications)) {
              setAgentNotifications(payload.notifications as AgentNotificationRow[]);
            }
          })
          .catch(() => undefined);
        return;
      }
      if (data.type !== IAM_PUSH_NAVIGATE) return;
      const path = toRouterPath(String(data.url || '/dashboard/agent'));
      navigate(path);
      const nid = data.notificationId != null ? String(data.notificationId).trim() : '';
      if (nid) setFocusNotificationId(nid);
      // Also honor ?notif= on the target URL
      try {
        const u = new URL(path, window.location.origin);
        const q = u.searchParams.get('notif');
        if (q) setFocusNotificationId(q);
      } catch {
        /* ignore */
      }
    };

    const onOpenStatus = (ev: Event) => {
      const d = (ev as CustomEvent<{ id?: string }>).detail;
      const id = d?.id != null ? String(d.id).trim() : '';
      if (id) setFocusNotificationId(id);
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    window.addEventListener(IAM_OPEN_STATUS_NOTIF, onOpenStatus as EventListener);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      window.removeEventListener(IAM_OPEN_STATUS_NOTIF, onOpenStatus as EventListener);
    };
  }, [navigate, setAgentNotifications]);

  // Cold start / openWindow path: ?notif= on current URL opens status panel.
  useEffect(() => {
    const q = new URLSearchParams(locationSearch).get('notif');
    if (q) setFocusNotificationId(q);
  }, [locationPathname, locationSearch]);

  useEffect(() => {
    if (!isNarrowViewport || activeActivity == null) return;
    setAgentPosition('off');
  }, [activeActivity, isNarrowViewport]);

  useEffect(() => {
    if (activeActivity === 'files' && !isAgentShellPath(locationPathname)) {
      setActiveActivity(null);
    }
  }, [locationPathname, activeActivity]);

  useEffect(() => {
    const onSidebarToggle = (e: Event) => {
      const detail = (e as CustomEvent<{ activity?: string; r2Bucket?: string }>).detail;
      const act = detail?.activity;
      if (!act) return;
      if (act === 'files' && !isAgentShellPath(locationPathname) && locationPathname !== '/dashboard/meet') {
        navigate(AGENT_EDITOR_PATH);
        engageAgentEditorWorkbench();
      }
      if (act === 'remote') {
        if (!isAgentShellPath(locationPathname) && locationPathname !== '/dashboard/meet') {
          navigate(AGENT_HOME_PATH);
        }
        setActiveActivity('files');
        const paletteBucket = detail?.r2Bucket?.trim();
        if (paletteBucket) {
          window.dispatchEvent(new CustomEvent(IAM_PALETTE_OPEN_R2, { detail: { bucket: paletteBucket } }));
        }
        return;
      }
      setActiveActivity(act as typeof activeActivity);
    };
    window.addEventListener('iam-sidebar-toggle', onSidebarToggle as EventListener);
    return () => window.removeEventListener('iam-sidebar-toggle', onSidebarToggle as EventListener);
  }, [locationPathname, navigate, engageAgentEditorWorkbench]);

  const cycleAgentPosition = useCallback(() => {
    setAgentPosition((p) => (p === 'right' ? 'left' : p === 'left' ? 'off' : 'right'));
  }, []);

  const onChatLayoutToggle = useCallback(() => {
    if (!isNarrowViewport) {
      cycleAgentPosition();
      return;
    }
    if (activeActivity) {
      setActiveActivity(null);
      return;
    }
    cycleAgentPosition();
  }, [isNarrowViewport, activeActivity, cycleAgentPosition]);

  /** Mobile bottom Chat tab: open agent home + chat overlay (not only toggle panel on other routes). */
  const onMobileBottomChatTab = useCallback(() => {
    if (!isNarrowViewport) {
      onChatLayoutToggle();
      return;
    }
    if (activeActivity) setActiveActivity(null);
    if (!isAgentShellPath(locationPathname)) {
      navigate(AGENT_HOME_PATH);
      setAgentPosition((p) => (p === 'off' ? 'right' : p));
      return;
    }
    onChatLayoutToggle();
  }, [
    isNarrowViewport,
    activeActivity,
    locationPathname,
    navigate,
    onChatLayoutToggle,
  ]);

  const mobileEdgeSwipeHandlers = useMemo(
    () => ({
      onTouchStart: (e: React.TouchEvent) => {
        if (!isNarrowViewport) return;
        const t = e.touches[0];
        mobileSwipeStartRef.current = t.clientX <= 28 ? { x: t.clientX, y: t.clientY } : null;
      },
      onTouchEnd: (e: React.TouchEvent) => {
        if (!isNarrowViewport || !mobileSwipeStartRef.current) return;
        const t = e.changedTouches[0];
        const s = mobileSwipeStartRef.current;
        if (t.clientX - s.x > 56 && Math.abs(t.clientY - s.y) < 80) narrowBackToCenter();
        mobileSwipeStartRef.current = null;
      },
    }),
    [isNarrowViewport, narrowBackToCenter],
  );

  const handleMainFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const glb = files.find((f) => f.name.toLowerCase().endsWith('.glb'));
    if (!glb) return;
    const url = URL.createObjectURL(glb);
    navigate('/dashboard/designstudio', {
      state: { pendingGlb: { url, name: glb.name.replace(/\.glb$/i, '') } },
    });
  };

  const handleMainDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  /** Mobile: only fullscreen agent chat hides the editor; activity drawer is a side panel. */
  // Studio needs full canvas on mobile — never let agent panel hide it
  const narrowBlocksCenter =
    isNarrowViewport && agentChatLayout !== 'center' && agentPosition !== 'off' && !isDesignStudioRoute;
  /** Explorer drawer has its own close control — no floating back pill while files panel is open. */
  const narrowNeedsBack =
    isNarrowViewport &&
    (agentChatLayout === 'center' || agentPosition !== 'off' || (!!activeActivity && activeActivity !== 'files'));

  const mobileBackLabel = useMemo(
    () =>
      narrowNeedsBack
        ? mobileNavBackLabel({
            agentChatOpen: agentChatLayout === 'center' || agentPosition !== 'off',
            activeActivity,
            pathname: locationPathname,
          })
        : null,
    [narrowNeedsBack, agentChatLayout, agentPosition, activeActivity, locationPathname],
  );

  const statusIndentLabel = useMemo(
    () => `${editorMeta.insertSpaces ? 'Spaces' : 'Tabs'}: ${editorMeta.tabSize}`,
    [editorMeta.insertSpaces, editorMeta.tabSize],
  );

  const platformHealthIssues = useMemo(
    () =>
      buildPlatformHealthIssues({
        healthOk,
        tunnelHealthy,
        tunnelStale,
        terminalOk,
        sandboxOk,
        workspaceDrift,
      }),
    [healthOk, tunnelHealthy, tunnelStale, terminalOk, sandboxOk, workspaceDrift],
  );

  return {
    markNotificationRead,
    openNotificationDestination,
    cycleAgentPosition,
    onChatLayoutToggle,
    onMobileBottomChatTab,
    mobileEdgeSwipeHandlers,
    handleMainFileDrop,
    handleMainDragOver,
    narrowBlocksCenter,
    narrowNeedsBack,
    mobileBackLabel,
    statusIndentLabel,
    platformHealthIssues,
  };
}
