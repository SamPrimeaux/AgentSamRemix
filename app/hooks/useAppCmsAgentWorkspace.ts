/** CMS workbench packet + agent workspace context + route atmospheric (Wave 2). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentWorkspaceContextPacket, IdeWorkspaceSnapshot, DevServerState } from '../src/ideWorkspace';
import { resolveDashboardRouteAgentContext } from '../lib/dashboardRouteContext';
import { startNewAgentChat } from '../lib/openAgentConversation';
import type { ActiveFile } from '../types';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppCmsAgentWorkspace(opts: {
  browserUrl: string;
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
    browserUrl, cmsRouteParsed, isCmsRoute, authWorkspaceId, activeTab,
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

  const cmsWorkbenchContext = useMemo<AgentWorkspaceContextPacket | null>(() => {
    const slug = cmsRouteParsed?.siteSlug || null;
    const pageId = isCmsRoute ? cmsRouteParsed?.pageId ?? null : cmsAgentPageId;
    const panel = isCmsRoute ? cmsRouteParsed?.panel ?? 'pages' : cmsAgentPanel;
    if (!isCmsRoute && !slug && !pageId) return null;
    return {
      activeTab: 'cms',
      browserUrl: browserUrl?.trim() || null,
      openFiles: agentWorkbenchOpenFiles,
      plan_id: activePlanIdForChat,
      workflow_run_id: null,
      workspace_id: authWorkspaceId?.trim() || null,
      project_slug: slug,
      page_id: pageId,
      studio_panel: panel,
      capabilities: ['cms'],
    };
  }, [
    cmsRouteParsed,
    isCmsRoute,
    authWorkspaceId,
    cmsAgentPageId,
    cmsAgentPanel,
    activeTab,
    browserUrl,
    agentWorkbenchOpenFiles,
    activePlanIdForChat,
  ]);

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
        activeTab: String(activeTab),
        browserUrl,
        openFiles: agentWorkbenchOpenFiles,
        planId: activePlanIdForChat,
      }),
    [
      locationPathname,
      locationSearch,
      authWorkspaceId,
      activeTab,
      browserUrl,
      agentWorkbenchOpenFiles,
      activePlanIdForChat,
    ],
  );

  return {
    cmsAgentPageId, setCmsAgentPageId,
    cmsAgentPanel, setCmsAgentPanel,
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
