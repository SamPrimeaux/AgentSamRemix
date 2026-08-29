/** App agent surface_open / artifact / R2 palette bridges (Wave 2). */
import React, { useCallback, useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { resolveAgentSurfaceTarget } from '../lib/resolveAgentSurfaceTarget';
import { sanitizeBrowserNavigateUrl } from '../lib/sanitizeBrowserUrl';
import { prepareActiveFileForEditor } from '../src/lib/prepareActiveFileForEditor';
import { buildR2ObjectUrl } from '../src/lib/r2Urls';
import { AGENT_HOME_PATH, isAgentShellPath } from '../lib/agentRoutes';
import { IAM_ARTIFACT_OPEN_BUILDER, type ArtifactOpenBuilderDetail } from '../agentChatConstants';
import {
  IAM_PALETTE_OPEN_R2,
  IAM_PALETTE_OPEN_R2_REQUEST,
} from '../src/lib/agentSamFilesystemTypes';
import type { ActiveFile } from '../types';
import type { DevServerState } from '../src/ideWorkspace';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppAgentSurfaceOpen(opts: {
  revealMainWorkspaceIfNarrow: () => void;
  isNarrowViewport: boolean;
  setCmsAgentPageId: React.Dispatch<React.SetStateAction<string | null>>;
  setCmsAgentPanel: React.Dispatch<React.SetStateAction<string>>;
  openTab: (t: ShellTabId) => void;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
  shellOpenDraw: (detail?: { load_url?: string | null; artifact_id?: string | null }) => void;
  shellOpenSketch: (detail?: any) => void;
  navigate: NavigateFunction;
  locationPathname: string;
  devServer: DevServerState | null;
  setBrowserPreviewSource: React.Dispatch<React.SetStateAction<'editor' | 'agent'>>;
  setBrowserAddressDisplay: React.Dispatch<React.SetStateAction<string | null>>;
  setBrowserTabTitle: React.Dispatch<React.SetStateAction<string | null>>;
  setBrowserUrl: React.Dispatch<React.SetStateAction<string>>;
  openFile: (f: ActiveFile) => void;
  setIsTerminalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveActivity: React.Dispatch<React.SetStateAction<any>>;
  setGithubExpandRepo: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const {
    revealMainWorkspaceIfNarrow, isNarrowViewport, setCmsAgentPageId, setCmsAgentPanel,
    openTab, setToastMsg, shellOpenDraw, shellOpenSketch, navigate, locationPathname,
    devServer, setBrowserPreviewSource, setBrowserAddressDisplay, setBrowserTabTitle,
    setBrowserUrl, openFile, setIsTerminalOpen, setActiveActivity, setGithubExpandRepo,
  } = opts;

  /** Agent Sam SSE `surface_open` / orchestration — open the right workspace tab without new buttons. */
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<Record<string, unknown>>).detail;
      if (!d || typeof d !== 'object') return;
      const resolved = resolveAgentSurfaceTarget(d as Parameters<typeof resolveAgentSurfaceTarget>[0]);
      if (!resolved.surface) return;
      revealMainWorkspaceIfNarrow();

      if (resolved.cms) {
        if (resolved.cms.page_id) setCmsAgentPageId(resolved.cms.page_id);
        if (resolved.cms.panel) setCmsAgentPanel(resolved.cms.panel);
        openTab('cms');
        if (isNarrowViewport) setToastMsg('CMS panel opened in Agent workbench.');
        return;
      }

      if (resolved.surface === 'excalidraw') {
        shellOpenDraw({
          load_url: resolved.excalidraw?.load_url ?? null,
          artifact_id: resolved.excalidraw?.artifact_id ?? null,
        });
        if (isNarrowViewport) setToastMsg('Draw opened. Tap Chat to return to Agent Sam.');
        return;
      }

      if (resolved.surface === 'sketch') {
        shellOpenSketch(resolved.sketch ?? undefined);
        if (isNarrowViewport) setToastMsg('Sketch studio opened. Tap Chat to return to Agent Sam.');
        return;
      }

      if (resolved.surface === 'moviemode') {
        navigate('/dashboard/moviemode');
        if (isNarrowViewport) setToastMsg('MovieMode opened. Tap Chat to return to Agent Sam.');
        return;
      }

      if (resolved.surface === 'browser') {
        const devUrl = devServer?.url?.trim();
        const safeUrl = sanitizeBrowserNavigateUrl(
          resolved.browserUrl ||
            (resolved.reason === 'devserver' && devUrl ? devUrl : null) ||
            (typeof d.url === 'string' ? d.url : ''),
        );
        setBrowserPreviewSource('agent');
        if (safeUrl) {
          setBrowserAddressDisplay(null);
          setBrowserTabTitle(null);
          setBrowserUrl(safeUrl);
        }
        openTab('browser');
        if (isNarrowViewport) setToastMsg('Browser tab opened. Tap Chat to return to Agent Sam.');
        return;
      }

      if (resolved.surface === 'code') {
        // Explicit SSE surface_open for code is still agent-directed (monaco_edit tasks).
        // Fence / monaco_file_generated / monaco_invoke must not reach here without a
        // real surface_open — and never navigate the editor for assistant_code_block.
        if (resolved.reason === 'assistant_code_block' || resolved.reason === 'monaco_invoke') {
          return;
        }
        if (resolved.localFile?.workspace_path) {
          openFile(
            prepareActiveFileForEditor({
              name: resolved.localFile.workspace_path.split('/').pop() || 'untitled',
              workspacePath: resolved.localFile.workspace_path,
              content: '',
              source_type: 'local',
            }),
          );
        }
        openTab('code');
        if (isNarrowViewport) setToastMsg('Code editor opened. Tap Chat to return to Agent Sam.');
        return;
      }

      if (resolved.surface === 'r2') {
        if (resolved.r2?.bucket && resolved.r2?.key && resolved.r2.preview) {
          const bucket = resolved.r2.bucket;
          const key = resolved.r2.key;
          if (/\.(?:html?|dc\.html)$/i.test(key)) {
            void (async () => {
              const { openR2KeyInEditor } = await import('../src/lib/mediaPreview');
              const opened = await openR2KeyInEditor(bucket, key, (f) => {
                const prepared = prepareActiveFileForEditor(f);
                openFile(prepared);
                openTab('code');
                window.setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent('iam:open-editor-preview', { detail: { file: prepared } }),
                  );
                }, 0);
              });
              if (!opened) {
                setToastMsg('Could not open HTML artifact for preview.');
              }
              return;
            })();
            return;
          }
          const previewUrl = buildR2ObjectUrl(bucket, key);
          setBrowserPreviewSource('agent');
          setBrowserUrl(previewUrl);
          openTab('browser');
          return;
        }
        window.dispatchEvent(
          new CustomEvent(IAM_PALETTE_OPEN_R2_REQUEST, {
            detail: { bucket: resolved.r2?.bucket || undefined },
          }),
        );
        return;
      }

      if (resolved.surface === 'terminal') {
        setIsTerminalOpen(true);
      }
    };
    window.addEventListener('iam:agent-open-surface', h as EventListener);
    return () => window.removeEventListener('iam:agent-open-surface', h as EventListener);
  }, [openTab, revealMainWorkspaceIfNarrow, isNarrowViewport, shellOpenDraw, navigate, devServer, openFile]);

  /** Artifacts → category/builder: open Agent workbench tab without leaving chat-first flow on phone. */
  useEffect(() => {
    const onOpenBuilder = (e: Event) => {
      const detail = (e as CustomEvent<ArtifactOpenBuilderDetail>).detail;
      const tab = detail?.tab ?? 'code';
      if (tab === 'moviemode') {
        navigate('/dashboard/moviemode');
        if (isNarrowViewport) setToastMsg('Movie Mode opened. Tap Chat to return to Agent Sam.');
        return;
      }
      if (tab === 'excalidraw') {
        shellOpenDraw();
        if (isNarrowViewport) setToastMsg('Draw opened. Tap Chat to return to Agent Sam.');
        return;
      }
      if (!isAgentShellPath(locationPathname)) navigate(AGENT_HOME_PATH);
      revealMainWorkspaceIfNarrow();
      openTab(tab === 'Workspace' || tab === 'code' || tab === 'browser' ? tab : 'code');
      if (isNarrowViewport) setToastMsg('Builder opened. Tap Chat to return to Agent Sam.');
    };
    window.addEventListener(IAM_ARTIFACT_OPEN_BUILDER, onOpenBuilder);
    return () => window.removeEventListener(IAM_ARTIFACT_OPEN_BUILDER, onOpenBuilder);
  }, [locationPathname, navigate, openTab, revealMainWorkspaceIfNarrow, isNarrowViewport, shellOpenDraw]);

  /** Browser tab: open only on SSE `surface_open` / `agent_surface_open` (tool_start must not dispatch iam:agent-open-surface). */

  const consumeGithubExpandRepo = useCallback(() => setGithubExpandRepo(null), []);

  useEffect(() => {
    const handleOpenR2Palette = (e: Event) => {
      const r2BucketName = (e as CustomEvent<{ bucket?: string }>).detail?.bucket?.trim();
      revealMainWorkspaceIfNarrow();
      if (!isAgentShellPath(locationPathname) && locationPathname !== '/dashboard/meet') {
        navigate(AGENT_HOME_PATH);
      }
      setActiveActivity('files');
      window.dispatchEvent(
        new CustomEvent(IAM_PALETTE_OPEN_R2, { detail: { bucket: r2BucketName || undefined } }),
      );
    };
    window.addEventListener(IAM_PALETTE_OPEN_R2_REQUEST, handleOpenR2Palette as EventListener);
    return () => window.removeEventListener(IAM_PALETTE_OPEN_R2_REQUEST, handleOpenR2Palette as EventListener);
  }, [revealMainWorkspaceIfNarrow, locationPathname, navigate, setActiveActivity]);

  return { consumeGithubExpandRepo };
}
