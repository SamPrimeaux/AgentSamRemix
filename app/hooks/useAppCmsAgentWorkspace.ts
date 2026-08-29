/** CMS workbench packet + agent workspace context + route atmospheric (Wave 2). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentWorkspaceContextPacket, IdeWorkspaceSnapshot, DevServerState } from '../src/ideWorkspace';
import { resolveDashboardRouteAgentContext } from '../lib/dashboardRouteContext';
import { startNewAgentChat } from '../lib/openAgentConversation';
import type { ActiveFile } from '../types';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppCmsAgentWorkspace(opts: {
  browserUrl: string;
  cmsWorkspaceContext: any;
  cmsRouteParsed: { pageId?: string | null; panel?: string | null; siteSlug?: string | null } | null;
  isCmsRoute: boolean;
  authWorkspaceId: string | null | undefined;
  activeTab: ShellTabId;
  agentWorkbenchOpenFiles: string[];
  activePlanIdForChat: string | null;
  locationPathname: string;
  locationSearch: string;
  isDrawRoute: boolean;
  isSketchRoute: boolean;
  designStudioEntryPhase: boolean;
  drawEntryPhase: boolean;
  sketchEntryPhase: boolean;
  setDesignStudioEntryPhase: React.Dispatch<React.SetStateAction<boolean>>;
  setDesignStudioComposerHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setDesignStudioMessagesHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setDrawEntryPhase: React.Dispatch<React.SetStateAction<boolean>>;
  setDrawComposerHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setDrawMessagesHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setSketchEntryPhase: React.Dispatch<React.SetStateAction<boolean>>;
  setSketchComposerHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  setSketchMessagesHost: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>;
  isNarrowViewport: boolean;
  ensureAgentSidePanel: () => void;
  setAgentPosition: React.Dispatch<React.SetStateAction<'right' | 'left' | 'off'>>;
  activeFile: ActiveFile | null;
  activeWorkspaceRow: any;
  ideWorkspace: IdeWorkspaceSnapshot;
  devServer: DevServerState | null;
  shellOutputLines: string[];
}) {
  const {
    browserUrl, cmsWorkspaceContext, cmsRouteParsed, isCmsRoute, authWorkspaceId, activeTab,
    agentWorkbenchOpenFiles, activePlanIdForChat, locationPathname, locationSearch,
    isDrawRoute, isSketchRoute, designStudioEntryPhase, drawEntryPhase, sketchEntryPhase,
    setDesignStudioEntryPhase, setDesignStudioComposerHost, setDesignStudioMessagesHost,
    setDrawEntryPhase, setDrawComposerHost, setDrawMessagesHost,
    setSketchEntryPhase, setSketchComposerHost, setSketchMessagesHost,
    isNarrowViewport, ensureAgentSidePanel, setAgentPosition,
    activeFile, activeWorkspaceRow, ideWorkspace, devServer, shellOutputLines,
  } = opts;

  const [cmsAgentPageId, setCmsAgentPageId] = useState<string | null>(null);
  const [cmsAgentPanel, setCmsAgentPanel] = useState<string>('pages');
  const [cmsLiveSessionId, setCmsLiveSessionId] = useState<string | null>(null);

  const cmsWorkbenchContext = useMemo<AgentWorkspaceContextPacket | null>(() => {
    const slug = cmsWorkspaceContext?.project_slug || cmsRouteParsed?.siteSlug || null;
    const ws = (authWorkspaceId || '').trim();
    if (!slug && !isCmsRoute) return null;
    const pageId = isCmsRoute ? cmsRouteParsed?.pageId ?? null : cmsAgentPageId;
    const panel = isCmsRoute ? cmsRouteParsed?.panel ?? 'pages' : cmsAgentPanel;
    const publicDomain = cmsWorkspaceContext?.public_domain || null;
    const workerBase = cmsWorkspaceContext?.worker_base_url || null;
    const previewUrl = publicDomain
      ? `https://${publicDomain.replace(/^https?:\/\//, '')}`
      : workerBase || null;
    return {
      activeTab: activeTab === 'cms' || isCmsRoute ? 'cms' : String(activeTab),
      browserUrl: browserUrl?.trim() || null,
      openFiles: agentWorkbenchOpenFiles,
      plan_id: activePlanIdForChat,
      workflow_run_id: null,
      project_slug: slug,
      page_id: pageId,
      studio_panel: panel,
      live_session_id: cmsLiveSessionId,
      collab_room: pageId ? `cms:${pageId}` : null,
      bootstrap_cache_key: slug && ws ? `cms:bootstrap:${ws}:${slug}` : null,
      preview_url: previewUrl,
      public_domain: publicDomain,
      cms_hosting: cmsWorkspaceContext?.cms_hosting || null,
      api_profile: cmsWorkspaceContext?.api_profile || null,
      capabilities: slug ? ['cms'] : null,
      r2_bucket:
        (cmsWorkspaceContext as { r2_bucket?: string | null } | null)?.r2_bucket ||
        (cmsWorkspaceContext as { agent_site_context?: { r2_bucket?: string } } | null)
          ?.agent_site_context?.r2_bucket ||
        null,
      r2_key: null,
      agent_site_context:
        (cmsWorkspaceContext as { agent_site_context?: Record<string, unknown> } | null)
          ?.agent_site_context || null,
      d1_database_id:
        (cmsWorkspaceContext as { d1_database_id?: string | null } | null)?.d1_database_id ||
        null,
    };
  }, [
    cmsWorkspaceContext,
    cmsRouteParsed,
    isCmsRoute,
    authWorkspaceId,
    cmsAgentPageId,
    cmsAgentPanel,
    cmsLiveSessionId,
    activeTab,
    browserUrl,
    agentWorkbenchOpenFiles,
    activePlanIdForChat,
  ]);

  useEffect(() => {
    const pageId = cmsWorkbenchContext?.page_id?.trim();
    if (!pageId || isCmsRoute) return;
    let cancelled = false;
    void fetch('/api/cms/live-session/join', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_id: pageId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { session_id?: string } | null) => {
        if (cancelled || !data?.session_id?.trim()) return;
        setCmsLiveSessionId(data.session_id.trim());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cmsWorkbenchContext?.page_id, isCmsRoute]);

  const isDesignStudioRoute = locationPathname.startsWith('/dashboard/designstudio');
  const designStudioEntryAtmospheric = isDesignStudioRoute && designStudioEntryPhase;
  const drawEntryAtmospheric = isDrawRoute && drawEntryPhase;
  const sketchEntryAtmospheric = isSketchRoute && sketchEntryPhase;
  const routeEntryAtmospheric =
    designStudioEntryAtmospheric || drawEntryAtmospheric || sketchEntryAtmospheric;

  /** Entering Draw / Sketch / Design Studio: detach prior agent thread so entry
   *  portals stay a clean startup center (not the previous /agent chat dump). */
  const prevProductEntryRef = useRef(false);
  useEffect(() => {
    const onProductEntry =
      isDrawRoute || isSketchRoute || isDesignStudioRoute;
    if (onProductEntry && !prevProductEntryRef.current) {
      startNewAgentChat({ stayOnPage: true });
    }
    prevProductEntryRef.current = onProductEntry;
  }, [isDrawRoute, isSketchRoute, isDesignStudioRoute]);

  useEffect(() => {
    if (!isDesignStudioRoute) {
      setDesignStudioEntryPhase(true);
      setDesignStudioComposerHost(null);
      setDesignStudioMessagesHost(null);
    }
  }, [isDesignStudioRoute]);

  useEffect(() => {
    if (!isDrawRoute) {
      setDrawEntryPhase(true);
      setDrawComposerHost(null);
      setDrawMessagesHost(null);
    }
  }, [isDrawRoute]);

  useEffect(() => {
    if (!isSketchRoute) {
      setSketchEntryPhase(true);
      setSketchComposerHost(null);
      setSketchMessagesHost(null);
    }
  }, [isSketchRoute]);

  useEffect(() => {
    if (!isDesignStudioRoute || isNarrowViewport) return;
    if (designStudioEntryPhase) {
      setAgentPosition('off');
    } else {
      ensureAgentSidePanel();
    }
  }, [isDesignStudioRoute, designStudioEntryPhase, isNarrowViewport, ensureAgentSidePanel]);

  useEffect(() => {
    if (!isDrawRoute || isNarrowViewport) return;
    if (drawEntryPhase) {
      setAgentPosition('off');
    } else {
      ensureAgentSidePanel();
    }
  }, [isDrawRoute, drawEntryPhase, isNarrowViewport, ensureAgentSidePanel]);

  useEffect(() => {
    if (!isSketchRoute || isNarrowViewport) return;
    if (sketchEntryPhase) {
      setAgentPosition('off');
    }
  }, [isSketchRoute, sketchEntryPhase, isNarrowViewport]);

  const agentWorkspaceContext = useMemo<AgentWorkspaceContextPacket>(() => {
    const routeCtx = resolveDashboardRouteAgentContext({
      pathname: locationPathname,
      search: locationSearch,
      workspaceId: authWorkspaceId,
      cmsContext: cmsWorkspaceContext,
      activeTab: String(activeTab),
      browserUrl,
      openFiles: agentWorkbenchOpenFiles,
      planId: activePlanIdForChat,
    });
    const activePath =
      activeFile?.workspacePath ||
      activeFile?.githubPath ||
      activeFile?.r2Key ||
      activeFile?.name ||
      null;
    const wsGithub = activeWorkspaceRow?.github_repo?.trim() || null;
    const wsR2Prefix =
      (activeWorkspaceRow as { r2_prefix?: string | null } | null)?.r2_prefix?.trim() || null;
    const wsRoot =
      (activeWorkspaceRow as { root_path?: string | null } | null)?.root_path?.trim() ||
      (ideWorkspace?.source === 'local'
        ? ideWorkspace.folderName
        : ideWorkspace?.source === 'pinned'
          ? ideWorkspace.pathHint
          : null);
    const workspaceSource = (() => {
      const gh = !!wsGithub;
      const r2 = !!wsR2Prefix;
      if (gh && r2) return 'mixed';
      if (gh) return 'github';
      if (r2) return 'r2';
      if (wsRoot || ideWorkspace?.source === 'local') return 'local';
      return 'general';
    })();
    return {
      activeTab: isDesignStudioRoute ? 'designstudio' : String(activeTab),
      browserUrl: browserUrl?.trim() || null,
      openFiles: agentWorkbenchOpenFiles,
      plan_id: activePlanIdForChat,
      workflow_run_id: null,
      dashboard_path: locationPathname,
      dashboard_route_key: routeCtx.route_key,
      ide_workspace: ideWorkspace,
      dev_server_url: devServer?.url ?? null,
      active_file: activePath,
      terminal_tail: shellOutputLines.slice(-8),
      workspace_id: authWorkspaceId?.trim() || null,
      workspace_source: workspaceSource,
      github_repo: wsGithub,
      r2_prefix: wsR2Prefix,
      root_path: wsRoot,
      ...routeCtx.workspaceContext,
      // CMS packet wins on slug/page/preview_url; browserUrl is identical in both today —
      // keep a single host browserUrl source so this spread cannot desync after peels.
      ...(cmsWorkbenchContext || {}),
    };
  }, [
    locationPathname,
    locationSearch,
    authWorkspaceId,
    cmsWorkspaceContext,
    isDesignStudioRoute,
    activeTab,
    browserUrl,
    agentWorkbenchOpenFiles,
    activePlanIdForChat,
    cmsWorkbenchContext,
    activeFile,
    ideWorkspace,
    devServer,
    shellOutputLines,
    activeWorkspaceRow,
  ]);

  const routeAgentMeta = useMemo(
    () =>
      resolveDashboardRouteAgentContext({
        pathname: locationPathname,
        search: locationSearch,
        workspaceId: authWorkspaceId,
        cmsContext: cmsWorkspaceContext,
        activeTab: String(activeTab),
        browserUrl,
        openFiles: agentWorkbenchOpenFiles,
        planId: activePlanIdForChat,
      }),
    [
      locationPathname,
      locationSearch,
      authWorkspaceId,
      cmsWorkspaceContext,
      activeTab,
      browserUrl,
      agentWorkbenchOpenFiles,
      activePlanIdForChat,
    ],
  );

  return {
    cmsAgentPageId, setCmsAgentPageId,
    cmsAgentPanel, setCmsAgentPanel,
    cmsLiveSessionId, setCmsLiveSessionId,
    cmsWorkbenchContext,
    isDesignStudioRoute,
    designStudioEntryAtmospheric,
    drawEntryAtmospheric,
    sketchEntryAtmospheric,
    routeEntryAtmospheric,
    agentWorkspaceContext,
    routeAgentMeta,
  };
}
