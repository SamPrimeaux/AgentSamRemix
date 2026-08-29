/** App open Monaco / editor / explorer helpers (Wave 2). */
import React, { useCallback, useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { ActiveFile } from '../types';
import { prepareActiveFileForEditor } from '../src/lib/prepareActiveFileForEditor';
import { writeConnectedLocalFile } from '../src/lib/library/writeConnectedLocalFile';
import { AGENT_EDITOR_PATH, isAgentEditorPath } from '../lib/agentRoutes';
import { IAM_AGENT_MOBILE_CODE_FOCUS } from '../agentChatConstants';
import type { IdeWorkspaceSnapshot } from '../src/ideWorkspace';
import type { AgentPanelPosition } from './useAppPanelLayout';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';
type MergeRecent = (prev: any[], opened: ActiveFile) => any[];

export function useAppOpenHelpers(opts: {
  agentPosition: AgentPanelPosition;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
  setActiveFile: (f: ActiveFile | Partial<ActiveFile> | ((prev: ActiveFile | null) => ActiveFile | null)) => void;
  setRecentFiles: React.Dispatch<React.SetStateAction<any[]>>;
  mergeRecentFromActiveFile: MergeRecent;
  revealMainWorkspaceIfNarrow: () => void;
  setOpenTabs: React.Dispatch<React.SetStateAction<ShellTabId[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
  setActiveActivity: React.Dispatch<React.SetStateAction<any>>;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setNativeFolderOpenSignal: React.Dispatch<React.SetStateAction<number>>;
  isNarrowViewport: boolean;
  openFile: (f: ActiveFile) => void;
  openTab: (t: ShellTabId) => void;
  navigate: NavigateFunction;
  locationPathname: string;
  isAgentEditorWorkbench: boolean;
  activeFile: ActiveFile | null;
  setIdeWorkspace: React.Dispatch<React.SetStateAction<IdeWorkspaceSnapshot>>;
  authWorkspaceId: string | null | undefined;
  workspaceRows: Array<{ id: string; name?: string; slug?: string; github_repo?: string | null }>;
  switchWorkspace: (id: string, opts?: any) => Promise<void>;
}) {
  const {
    agentPosition, setAgentPosition, setActiveFile, setRecentFiles, mergeRecentFromActiveFile,
    revealMainWorkspaceIfNarrow, setOpenTabs, setActiveTab, setActiveActivity, setToastMsg,
    setNativeFolderOpenSignal,     isNarrowViewport, openFile, openTab, navigate, locationPathname,
    isAgentEditorWorkbench, activeFile, setIdeWorkspace, authWorkspaceId, workspaceRows, switchWorkspace,
  } = opts;

  const openInMonacoFromChat = useCallback(
    (file: Pick<ActiveFile, 'name' | 'content'> & Partial<ActiveFile>) => {
      // Never let editor open crash wipe the in-memory chat (reload then only
      // shows DO history — which used to miss assistant text after timeout).
      try {
        const opened = prepareActiveFileForEditor({
          name: file.name,
          content: file.content,
          originalContent: file.originalContent !== undefined ? file.originalContent : file.content ?? '',
          workspacePath: file.workspacePath || file.name,
          source_type: file.source_type,
          handle: file.handle,
          fileKind: file.fileKind,
          isImage: file.isImage,
          isBinary: file.isBinary,
          previewUrl: file.previewUrl,
          contentType: file.contentType,
          size: file.size,
          binaryMessage: file.binaryMessage,
          localObjectUrl: file.localObjectUrl,
          githubPath: file.githubPath,
          githubSha: file.githubSha,
          r2Key: file.r2Key,
          r2Bucket: file.r2Bucket,
        });
        setActiveFile(opened);
        setRecentFiles((prev) => mergeRecentFromActiveFile(prev, opened));
        revealMainWorkspaceIfNarrow();
        setOpenTabs((prev) => (prev.includes('code') ? prev : [...prev, 'code']));
        setActiveTab('code');
        if (isNarrowViewport) {
          setToastMsg('Opened in code editor. Tap Chat (bottom) to return to Agent Sam.');
        }
        // Single-file HTML apps should land in live preview, not as a chat wall of source.
        const ext = String(opened.name || '').split('.').pop()?.toLowerCase() || '';
        if (ext === 'html' || ext === 'htm') {
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent('iam:open-editor-preview', {
                detail: { file: opened },
              }),
            );
          }, 0);
        }
      } catch (e) {
        console.warn('[openInMonacoFromChat]', e);
        setToastMsg(
          e instanceof Error && e.message
            ? `Could not open in editor: ${e.message.slice(0, 120)}`
            : 'Could not open that snippet in the editor — chat left intact.',
        );
      }
    },
    [revealMainWorkspaceIfNarrow, isNarrowViewport, mergeRecentFromActiveFile],
  );

  const focusMobileCodeContext = useCallback(() => {
    if (agentPosition === 'off') setAgentPosition('right');
    window.dispatchEvent(new CustomEvent(IAM_AGENT_MOBILE_CODE_FOCUS));
  }, [agentPosition]);

  const engageAgentEditorWorkbench = useCallback(() => {
    setAgentPosition((p) => (p === 'off' ? 'right' : p));
    setOpenTabs((prev) => {
      // Workspace only by default — Browser is opt-in when the user opens it.
      return prev.includes('Workspace') ? prev : ['Workspace', ...prev];
    });
    // Always land on Workspace when no file — stale `code` without Monaco was a blank charcoal canvas.
    setActiveTab((t) => (t === 'browser' || t === 'cms' || t === 'glb' ? t : 'Workspace'));
    // Do not auto-open Files: lazy AgentSamFilesystem errors would unmount the whole shell (no ErrorBoundary).
    // Users open Files via the Files tab / ⌘B / Workspace "Local folder".
  }, [setAgentPosition, setOpenTabs, setActiveTab]);

  const openNewEditorFile = useCallback(async () => {
    const name = window.prompt('File name (under Local folder):', 'untitled.html');
    if (!name?.trim()) return;
    const written = await writeConnectedLocalFile(name.trim(), '', { createDirs: true });
    if (written.ok === false) {
      if (written.error === 'local_folder_not_connected' || written.error === 'local_folder_permission_denied') {
        setNativeFolderOpenSignal((n) => n + 1);
        setActiveActivity('files');
        setToastMsg(
          written.hint ||
            (written.error === 'local_folder_not_connected'
              ? 'Connect a Local folder first, then create the file'
              : 'Reconnect Local to grant write access, then create again'),
        );
        return;
      }
      setToastMsg(written.hint || written.error || 'Could not create local file');
      return;
    }
    openFile(
      prepareActiveFileForEditor({
        name: written.workspacePath.split('/').pop() || name.trim(),
        content: '',
        originalContent: '',
        handle: written.handle,
        workspacePath: written.workspacePath,
        source_type: 'local',
      }),
    );
    window.dispatchEvent(
      new CustomEvent('iam:local_fs_file_written', {
        detail: { path: written.workspacePath, rootName: written.rootName },
      }),
    );
    setOpenTabs((p) => (p.includes('code') ? p : [...p, 'code']));
    setActiveTab('code');
    revealMainWorkspaceIfNarrow();
    setToastMsg(`Created on Local (${written.rootName})`);
  }, [openFile, revealMainWorkspaceIfNarrow]);

  const focusCodeEditorFromChat = useCallback(() => {
    if (isNarrowViewport) {
      focusMobileCodeContext();
      return;
    }
    revealMainWorkspaceIfNarrow();
    if (activeFile) {
      openTab('code');
      return;
    }
    setActiveActivity('files');
    setOpenTabs((p) => (p.includes('code') ? p : [...p, 'code']));
    setActiveTab('code');
  }, [focusMobileCodeContext, isNarrowViewport, revealMainWorkspaceIfNarrow, openTab, activeFile]);

  const openEditorFromChat = useCallback(() => {
    if (!isAgentEditorPath(locationPathname)) {
      navigate(AGENT_EDITOR_PATH);
    }
    engageAgentEditorWorkbench();
  }, [locationPathname, navigate, engageAgentEditorWorkbench]);

  useEffect(() => {
    if (!isAgentEditorWorkbench) return;
    engageAgentEditorWorkbench();
  }, [isAgentEditorWorkbench, engageAgentEditorWorkbench]);

  const openInEditorFromExplorer = useCallback(
    (file: ActiveFile) => {
      openFile(prepareActiveFileForEditor(file));
      openTab('code');
      revealMainWorkspaceIfNarrow();
    },
    [openFile, openTab, revealMainWorkspaceIfNarrow],
  );

  const onExplorerWorkspaceRootChange = useCallback(
    ({ folderName }: { folderName: string }) => {
      const name = String(folderName || '').trim();
      setIdeWorkspace({ source: 'local', folderName: name });
      if (!name) return; // disconnect — keep active product workspace for phone continuity

      // Explicit: curated match → server bind + active workspace; scratch → no D1 write.
      void (async () => {
        try {
          const res = await fetch('/api/workspace/local-bind', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderName: name, device_hint: 'local_explorer' }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            bound?: boolean;
            workspace_id?: string;
            reason?: string;
            detail?: string;
          };
          if (!res.ok || !data.bound || !data.workspace_id) {
            return; // scratch / no match — browser-local only
          }
          // Already on this workspace — skip switch + toast (prevents Files tree freeze/spam).
          if (authWorkspaceId === data.workspace_id) {
            return;
          }
          const row = workspaceRows.find((w) => w.id === data.workspace_id);
          await switchWorkspace(data.workspace_id, {
            displayName: row?.name,
            slug: row?.slug,
            github_repo: row?.github_repo ?? null,
            sync: true,
          });
          setToastMsg(`Workspace → ${row?.name || data.workspace_id} (synced for all devices)`);
        } catch {
          /* offline — keep local IDE folder only */
        }
      })();
    },
    [workspaceRows, switchWorkspace, setToastMsg, authWorkspaceId],
  );


  return {
    openInMonacoFromChat,
    focusMobileCodeContext,
    engageAgentEditorWorkbench,
    openNewEditorFile,
    focusCodeEditorFromChat,
    openEditorFromChat,
    openInEditorFromExplorer,
    onExplorerWorkspaceRootChange,
  };
}
