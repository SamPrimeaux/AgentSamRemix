/** App shell editor preview + browser tab open (Wave 2 E5). */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ActiveFile } from '../types';
import { sanitizeBrowserNavigateUrl } from '../lib/sanitizeBrowserUrl';
import {
  isRenderablePreviewFilename,
  previewAddressBarLabel,
  PREVIEW_WARN_BYTES,
} from '../lib/appShellPreview';
import { resolvePreviewMode, probeDevServerUrl } from '../lib/resolvePreviewMode';
import { buildPreviewSrcDoc } from '../lib/buildPreviewSrcDoc';
import { buildR2ObjectUrl } from '../src/lib/r2Urls';
import type { DevServerState, IdeWorkspaceSnapshot } from '../src/ideWorkspace';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppEditorPreview(opts: {
  activeFile: ActiveFile | null;
  ideWorkspace: IdeWorkspaceSnapshot;
  devServer: DevServerState | null;
  /** Bound after terminal bridge mounts — preview start-dev-server path. */
  runInTerminalRef: React.MutableRefObject<(cmd: string) => void>;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setOpenTabs: React.Dispatch<React.SetStateAction<ShellTabId[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
  revealMainWorkspaceIfNarrow: () => void;
  isNarrowViewport: boolean;
  activeAgentRunId: string | null;
  onDevServerUrlRef: React.MutableRefObject<((url: string) => void) | null>;
  setBrowserUrl: React.Dispatch<React.SetStateAction<string>>;
}) {
  const {
    activeFile,
    ideWorkspace,
    devServer,
    runInTerminalRef,
    setToastMsg,
    setOpenTabs,
    setActiveTab,
    revealMainWorkspaceIfNarrow,
    isNarrowViewport,
    activeAgentRunId,
    onDevServerUrlRef,
    setBrowserUrl,
  } = opts;

  const [browserAddressDisplay, setBrowserAddressDisplay] = useState<string | null>(null);
  const [browserTabTitle, setBrowserTabTitle] = useState<string | null>(null);
  const [browserPreviewSource, setBrowserPreviewSource] = useState<'editor' | 'agent'>('agent');
  const [editorPreviewOpen, setEditorPreviewOpen] = useState(false);
  const [mdViewMode, setMdViewMode] = useState<'source' | 'split' | 'preview'>('split');
  const [editorPreviewMode, setEditorPreviewMode] = useState<'srcdoc' | 'devserver'>('srcdoc');
  const [editorPreviewSrcDoc, setEditorPreviewSrcDoc] = useState<string | null>(null);
  const [editorPreviewUrl, setEditorPreviewUrl] = useState<string | null>(null);
  const [editorPreviewLoading, setEditorPreviewLoading] = useState(false);
  const [editorPreviewStatus, setEditorPreviewStatus] = useState<string | null>(null);
  const editorPreviewLoadingRef = useRef(false);
  const htmlPreviewBlobRef = useRef<string | null>(null);

  useEffect(() => {
    setMdViewMode('split');
  }, [activeFile?.name, activeFile?.workspacePath, activeFile?.githubPath, activeFile?.r2Key]);

  useEffect(() => {
    editorPreviewLoadingRef.current = editorPreviewLoading;
  }, [editorPreviewLoading]);

  useEffect(() => {
    onDevServerUrlRef.current = (url: string) => {
      if (!editorPreviewLoadingRef.current) return;
      setEditorPreviewUrl(url);
      setEditorPreviewLoading(false);
      setEditorPreviewStatus(null);
    };
    return () => {
      onDevServerUrlRef.current = null;
    };
  }, [onDevServerUrlRef]);

  useEffect(() => {
    return () => {
      if (htmlPreviewBlobRef.current) {
        URL.revokeObjectURL(htmlPreviewBlobRef.current);
        htmlPreviewBlobRef.current = null;
      }
    };
  }, []);

  const handleBrowserNavigateFromAgent = useCallback(
    (event: {
      type: 'browser_navigate';
      url: string;
      automation?: boolean;
      agent_live?: boolean;
      live_view_url?: string;
      session_id?: string;
      screenshot_url?: string;
      page_text?: string;
      title?: string;
    }) => {
      if (event.type !== 'browser_navigate' || !event.url?.trim()) return;
      const url = sanitizeBrowserNavigateUrl(event.url);
      if (!url) return;
      if (/\/api\/r2\/file\b/i.test(url)) {
        return;
      }
      const onAgentRoute = browserPreviewSource === 'agent';
      const agentLive =
        onAgentRoute &&
        (event.agent_live === true ||
          event.automation === true ||
          Boolean(activeAgentRunId?.trim()));
      const automation = onAgentRoute && !agentLive && event.automation === true;
      window.dispatchEvent(
        new CustomEvent('iam:agent-open-surface', {
          detail: { surface: 'browser', url, automation, agent_live: agentLive },
        }),
      );
      window.dispatchEvent(
        new CustomEvent('iam-browser-navigate', {
          detail: {
            url,
            automation,
            agent_live: agentLive,
            live_view_url: event.live_view_url,
            session_id: event.session_id,
            ...(event.screenshot_url ? { screenshot_url: event.screenshot_url } : {}),
            page_text: event.page_text,
            title: event.title,
          },
        }),
      );
      if (agentLive && activeAgentRunId?.trim()) {
        window.dispatchEvent(
          new CustomEvent('iam-browser-agent-live', {
            detail: {
              url,
              agent_run_id: activeAgentRunId.trim(),
              live_view_url: event.live_view_url,
              session_id: event.session_id,
            },
          }),
        );
      }
      revealMainWorkspaceIfNarrow();
      setBrowserPreviewSource('agent');
      setBrowserAddressDisplay(null);
      setBrowserTabTitle(null);
      setBrowserUrl(url);
      setOpenTabs((prev) => (prev.includes('browser') ? prev : [...prev, 'browser']));
      setActiveTab('browser');
      if (isNarrowViewport) {
        setToastMsg('Browser tab opened. Tap Chat to return to Agent Sam.');
      }
    },
    [
      revealMainWorkspaceIfNarrow,
      isNarrowViewport,
      browserPreviewSource,
      activeAgentRunId,
      setOpenTabs,
      setActiveTab,
      setToastMsg,
    ],
  );

  const openBrowserTab = useCallback(
    (
      url: string,
      tabOpts?: {
        addressDisplay?: string | null;
        tabTitle?: string | null;
        previewSource?: 'editor' | 'agent';
      },
    ) => {
      if (htmlPreviewBlobRef.current && !url.startsWith('blob:')) {
        URL.revokeObjectURL(htmlPreviewBlobRef.current);
        htmlPreviewBlobRef.current = null;
      }
      setBrowserPreviewSource(tabOpts?.previewSource ?? 'agent');
      setBrowserAddressDisplay(tabOpts?.addressDisplay ?? null);
      setBrowserTabTitle(tabOpts?.tabTitle ?? null);
      setBrowserUrl(url);
      setOpenTabs((prev) => (prev.includes('browser') ? prev : [...prev, 'browser']));
      setActiveTab('browser');
    },
    [setOpenTabs, setActiveTab],
  );

  const openPreviewBlob = useCallback(
    (blob: Blob, file: ActiveFile) => {
      if (htmlPreviewBlobRef.current) {
        URL.revokeObjectURL(htmlPreviewBlobRef.current);
        htmlPreviewBlobRef.current = null;
      }
      const u = URL.createObjectURL(blob);
      htmlPreviewBlobRef.current = u;
      openBrowserTab(u, {
        addressDisplay: previewAddressBarLabel(file),
        tabTitle: file.name?.trim() ? `Preview · ${file.name.trim()}` : 'Preview',
        previewSource: 'editor',
      });
    },
    [openBrowserTab],
  );

  const closeEditorPreview = useCallback(() => {
    setEditorPreviewOpen(false);
    setEditorPreviewSrcDoc(null);
    setEditorPreviewUrl(null);
    setEditorPreviewLoading(false);
    setEditorPreviewStatus(null);
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new CustomEvent('iam:monaco-layout'));
    }, 50);
  }, []);

  const openEditorPreviewForFile = useCallback(
    (file: ActiveFile) => {
      const name = file.name || '';
      if (!isRenderablePreviewFilename(name)) return;
      if (!file.content?.trim() && !(file.r2Bucket?.trim() && file.r2Key?.trim())) return;

      const content = file.content ?? '';
      const bytes = new TextEncoder().encode(content).length;
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      const mode = resolvePreviewMode({ fileName: name, workspace: ideWorkspace, bytes });
      const r2Bucket = file.r2Bucket?.trim();
      const r2Key = file.r2Key?.trim();
      const isHtml = ext === 'html' || ext === 'htm';

      setEditorPreviewOpen(true);
      setOpenTabs((prev) => (prev.includes('code') ? prev : [...prev, 'code']));
      setActiveTab('code');

      if (isHtml && r2Bucket && r2Key) {
        const hasRelativeAssets =
          Boolean(content.trim()) &&
          (/<script[^>]+src=["'](?!https?:\/\/|\/\/|data:|blob:)[^"']+["']/i.test(content) ||
            /<link[^>]+href=["'](?!https?:\/\/|\/\/|data:|blob:)[^"']*\.(?:css|js)["']/i.test(
              content,
            ));
        if (!content.trim() || hasRelativeAssets) {
          if (bytes >= PREVIEW_WARN_BYTES) {
            setToastMsg(`Large file (${(bytes / 1e6).toFixed(1)} MB) — preview may be slow.`);
          }
          setEditorPreviewMode('devserver');
          setEditorPreviewSrcDoc(null);
          setEditorPreviewUrl(buildR2ObjectUrl(r2Bucket, r2Key));
          setEditorPreviewLoading(false);
          setEditorPreviewStatus(
            hasRelativeAssets
              ? 'Serving from R2 so linked assets resolve — use a dev server for full fidelity.'
              : null,
          );
          setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new CustomEvent('iam:monaco-layout'));
          }, 50);
          return;
        }
      }

      if (mode === 'srcdoc') {
        if (ext === 'svg' && !content.trim()) {
          setToastMsg('SVG is empty — nothing to preview.');
          return;
        }
        if (bytes >= PREVIEW_WARN_BYTES && (isHtml || ext === 'md')) {
          setToastMsg(`Large file (${(bytes / 1e6).toFixed(1)} MB) — preview may be slow.`);
        }
        const hasRelativeAssets =
          isHtml &&
          (/<script[^>]+src=["'](?!https?:\/\/|\/\/|data:|blob:)[^"']+["']/i.test(content) ||
            /<link[^>]+href=["'](?!https?:\/\/|\/\/|data:|blob:)[^"']*\.(?:css|js)["']/i.test(
              content,
            ));
        setEditorPreviewMode('srcdoc');
        setEditorPreviewSrcDoc(buildPreviewSrcDoc(name, content));
        setEditorPreviewUrl(null);
        setEditorPreviewLoading(false);
        setEditorPreviewStatus(
          hasRelativeAssets
            ? 'Relative assets may not resolve in inline preview — use a dev server for full fidelity.'
            : null,
        );
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
          window.dispatchEvent(new CustomEvent('iam:monaco-layout'));
        }, 50);
        return;
      }

      setEditorPreviewMode('devserver');
      setEditorPreviewSrcDoc(null);
      void (async () => {
        if (devServer?.url) {
          const ok = await probeDevServerUrl(devServer.url);
          if (ok) {
            setEditorPreviewUrl(devServer.url);
            setEditorPreviewLoading(false);
            setEditorPreviewStatus('Using running dev server');
            return;
          }
        }
        setEditorPreviewLoading(true);
        setEditorPreviewStatus('Starting dev server in terminal…');
        const cmd =
          ext === 'jsx' || ext === 'tsx' || ext === 'vue' || ext === 'js'
            ? 'npm run dev'
            : 'npx --yes serve . -l 3000';
        runInTerminalRef.current(cmd);
      })();
    },
    [ideWorkspace, devServer, runInTerminalRef, setOpenTabs, setActiveTab, setToastMsg],
  );

  const openEditorPreview = useCallback(() => {
    if (!activeFile) return;
    openEditorPreviewForFile(activeFile);
  }, [activeFile, openEditorPreviewForFile]);

  useEffect(() => {
    const onOpenPreview = (e: Event) => {
      const file = (e as CustomEvent<{ file?: ActiveFile }>).detail?.file;
      if (file) {
        openEditorPreviewForFile(file);
        return;
      }
      if (activeFile) openEditorPreviewForFile(activeFile);
    };
    window.addEventListener('iam:open-editor-preview', onOpenPreview);
    return () => window.removeEventListener('iam:open-editor-preview', onOpenPreview);
  }, [activeFile, openEditorPreviewForFile]);

  return {
    browserAddressDisplay,
    setBrowserAddressDisplay,
    browserTabTitle,
    setBrowserTabTitle,
    browserPreviewSource,
    setBrowserPreviewSource,
    editorPreviewOpen,
    setEditorPreviewOpen,
    mdViewMode,
    setMdViewMode,
    editorPreviewMode,
    setEditorPreviewMode,
    editorPreviewSrcDoc,
    editorPreviewUrl,
    setEditorPreviewUrl,
    editorPreviewLoading,
    editorPreviewStatus,
    handleBrowserNavigateFromAgent,
    openBrowserTab,
    openPreviewBlob,
    closeEditorPreview,
    openEditorPreviewForFile,
    openEditorPreview,
  };
}
