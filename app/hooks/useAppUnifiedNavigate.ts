/** App unified search navigate handler (Wave 2). */
import React, { useCallback } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { UnifiedSearchNavigate } from '../components/UnifiedSearchBar';
import { databaseStudioPathForWorkspace } from '../src/lib/databaseStudioRoute';
import { dispatchDbApplySql, dispatchDbOpenTable } from '../src/lib/databaseStudioEvents';
import { resolveConnectedLocalFile } from '../src/lib/searchConnectedLocalFiles';
import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  LS_AGENT_CHAT_CONVERSATION_ID,
} from '../agentChatConstants';
import type { AgentPanelPosition } from './useAppPanelLayout';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppUnifiedNavigate(opts: {
  navigate: NavigateFunction;
  gitRepoFullName: string;
  activeWorkspaceRow: any;
  revealMainWorkspaceIfNarrow: () => void;
  setActiveFile: any;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
  setBrowserPreviewSource: React.Dispatch<React.SetStateAction<'editor' | 'agent'>>;
  setBrowserAddressDisplay: React.Dispatch<React.SetStateAction<string | null>>;
  setBrowserTabTitle: React.Dispatch<React.SetStateAction<string | null>>;
  setBrowserUrl: React.Dispatch<React.SetStateAction<string>>;
  setOpenTabs: React.Dispatch<React.SetStateAction<ShellTabId[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
  setActiveActivity: React.Dispatch<React.SetStateAction<any>>;
}) {
  const {
    navigate, gitRepoFullName, activeWorkspaceRow, revealMainWorkspaceIfNarrow, setActiveFile,
    setAgentPosition, setBrowserPreviewSource, setBrowserAddressDisplay, setBrowserTabTitle,
    setBrowserUrl, setOpenTabs, setActiveTab, setActiveActivity,
  } = opts;

  const handleUnifiedNavigate = useCallback(
    (nav: UnifiedSearchNavigate) => {
      if (nav.kind === 'table') {
        const table = String(nav.name || '').trim();
        if (!table) return;
        const base = databaseStudioPathForWorkspace(activeWorkspaceRow);
        const url = new URL(base, window.location.origin);
        url.searchParams.set('studio', '1');
        url.searchParams.set('table', table);
        if (!url.searchParams.get('source')) url.searchParams.set('source', 'd1');
        navigate(`${url.pathname}${url.search}`);
        window.setTimeout(() => {
          dispatchDbOpenTable({ datasource: 'd1', table, tab: 'data' });
        }, 200);
        return;
      }
      if (nav.kind === 'conversation') {
        try {
          localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, nav.id);
        } catch {
          /* ignore */
        }
        window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, { detail: { id: nav.id } }));
        setAgentPosition((p) => (p === 'off' ? 'right' : p));
        return;
      }
      if (nav.kind === 'knowledge') {
        if (nav.url && /^https?:\/\//i.test(nav.url)) {
          window.open(nav.url, '_blank', 'noopener,noreferrer');
          return;
        }
        navigate('/dashboard/chats');
        return;
      }
      if (nav.kind === 'file') {
        const path = String(nav.path || '').trim();
        if (!path) return;
        // Search results (R2 asset URLs, knowledge hits) carry an absolute URL in `path`,
        // not a repo-relative or FSA path — resolveConnectedLocalFile/GitHub contents both
        // 404 silently on these. Route them to the browser tab instead of failing quietly.
        // Inline setters (do not call openBrowserTab here): that callback is declared later in
        // this component, and referencing it in this useCallback's deps triggers TDZ
        // ("Cannot access 'Rr' before initialization") and white-screens the dashboard.
        if (/^https?:\/\//i.test(path)) {
          setBrowserPreviewSource('editor');
          setBrowserAddressDisplay(path);
          setBrowserTabTitle(path.split('/').pop() || 'Preview');
          setBrowserUrl(path);
          setOpenTabs((prev) => (prev.includes('browser') ? prev : [...prev, 'browser']));
          setActiveTab('browser');
          revealMainWorkspaceIfNarrow();
          return;
        }
        const revealLine = nav.line != null && Number(nav.line) > 0 ? Math.floor(Number(nav.line)) : null;
        const revealCol =
          nav.column != null && Number(nav.column) > 0 ? Math.floor(Number(nav.column)) : 1;
        const scheduleReveal = () => {
          if (!revealLine) return;
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('iam-editor-reveal', {
                detail: { line: revealLine, column: revealCol, path },
              }),
            );
          }, 120);
        };
        void (async () => {
          try {
            const { openLocalFileInEditor } = await import('../src/lib/mediaPreview');
            const resolved = await resolveConnectedLocalFile(path);
            if (resolved) {
              await openLocalFileInEditor(resolved.file, resolved.handle, resolved.workspacePath, (f) => {
                setActiveFile(f);
              });
              setActiveActivity('files');
              revealMainWorkspaceIfNarrow();
              setOpenTabs((p) => (p.includes('code') ? p : [...p, 'code']));
              setActiveTab('code');
              scheduleReveal();
              return;
            }
          } catch {
            /* fall through */
          }
          // Fallback: open via GitHub contents for connected repo context.
          try {
            const repoHint = String(
              gitRepoFullName || activeWorkspaceRow?.github_repo || '',
            ).trim();
            if (!repoHint) return;
            const [owner, repo] = repoHint.split('/');
            if (!owner || !repo) return;
            const qs = new URLSearchParams({ path });
            const res = await fetch(
              `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${qs}`,
              { credentials: 'same-origin' },
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.type !== 'file' || typeof data.content !== 'string') return;
            const raw = String(data.content).replace(/\n/g, '');
            const binary = atob(raw);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const text = new TextDecoder().decode(bytes);
            setActiveFile({
              name: data.name || path.split('/').pop() || path,
              content: text,
              originalContent: text,
              githubPath: path,
              githubRepo: repoHint,
              githubSha: typeof data.sha === 'string' ? data.sha : undefined,
              githubBranch: typeof data.ref === 'string' ? data.ref : 'main',
              workspacePath: path,
            });
            setActiveActivity('files');
            revealMainWorkspaceIfNarrow();
            setOpenTabs((p) => (p.includes('code') ? p : [...p, 'code']));
            setActiveTab('code');
            scheduleReveal();
          } catch {
            /* ignore */
          }
        })();
        return;
      }
      if (nav.kind === 'sql' || nav.kind === 'column') {
        const sql = nav.sql?.trim();
        if (!sql) return;
        const base = databaseStudioPathForWorkspace(activeWorkspaceRow);
        const url = new URL(base, window.location.origin);
        url.searchParams.set('studio', '1');
        if (!url.searchParams.get('source')) url.searchParams.set('source', 'd1');
        navigate(`${url.pathname}${url.search}`);
        window.setTimeout(() => {
          dispatchDbApplySql({ datasource: 'd1', sql, mode: 'replace', run: false });
        }, 200);
        return;
      }
      if (nav.kind === 'deployment') {
        const t = nav.summary?.trim();
        if (t) {
          void navigator.clipboard?.writeText(t).catch(() => {});
        }
      }
    },
    [navigate, gitRepoFullName, activeWorkspaceRow, revealMainWorkspaceIfNarrow, setActiveFile],
  );


  return { handleUnifiedNavigate };
}
