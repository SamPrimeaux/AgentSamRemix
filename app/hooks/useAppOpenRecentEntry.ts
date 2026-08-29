/** App open recent file entry (Wave 2). */
import React, { useCallback, useEffect } from 'react';
import type { ActiveFile } from '../types';
import type { RecentFileEntry } from '../src/ideWorkspace';
import { mergeRecentFromActiveFile } from '../src/ideWorkspace';
import { prepareActiveFileForEditor } from '../src/lib/prepareActiveFileForEditor';
import { persistRecentFileToLocalStorage } from '../lib/appShellRecentFiles';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppOpenRecentEntry(opts: {
  activeFile: ActiveFile | null;
  setActiveFile: any;
  setRecentFiles: React.Dispatch<React.SetStateAction<RecentFileEntry[]>>;
  setRecentFilesLsTick: React.Dispatch<React.SetStateAction<number>>;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
  revealMainWorkspaceIfNarrow: () => void;
  setOpenTabs: React.Dispatch<React.SetStateAction<ShellTabId[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
}) {
  const {
    activeFile, setActiveFile, setRecentFiles, setRecentFilesLsTick, setToastMsg,
    revealMainWorkspaceIfNarrow, setOpenTabs, setActiveTab,
  } = opts;

  useEffect(() => {
    if (!activeFile) return;
    const t = window.setTimeout(() => {
      setRecentFiles((prev) => mergeRecentFromActiveFile(prev, activeFile));
    }, 450);
    return () => window.clearTimeout(t);
  }, [activeFile]);

  const openRecentEntry = useCallback(
    async (entry: RecentFileEntry) => {
      persistRecentFileToLocalStorage({ ...entry, openedAt: Date.now() });
      setRecentFilesLsTick((t) => t + 1);

      const applySnapshots = (msg?: string) => {
        const work = entry.snapshotWorking || '';
        const orig = entry.snapshotOriginal !== null ? entry.snapshotOriginal : work;
        setActiveFile(
          prepareActiveFileForEditor({
            name: entry.name,
            content: work,
            originalContent: orig,
            workspacePath: entry.workspacePath,
            githubRepo: entry.githubRepo,
            githubPath: entry.githubPath,
            githubBranch: entry.githubBranch,
            r2Key: entry.r2Key,
            r2Bucket: entry.r2Bucket,
            driveFileId: entry.driveFileId,
          }),
        );
        if (msg) setToastMsg(msg);
        revealMainWorkspaceIfNarrow();
        setOpenTabs((p) => (p.includes('code') ? p : [...p, 'code']));
        setActiveTab('code');
      };

      try {
        if (entry.githubRepo && entry.githubPath && entry.githubBranch) {
          const [owner, repo] = entry.githubRepo.split('/');
          if (!owner || !repo) throw new Error('bad repo');
          const qs = new URLSearchParams({ path: entry.githubPath, ref: entry.githubBranch });
          const res = await fetch(
            `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${qs}`,
            { credentials: 'same-origin' },
          );
          const data = await res.json();
          if (!res.ok || data.type !== 'file' || typeof data.content !== 'string') throw new Error('github');
          const raw = String(data.content).replace(/\n/g, '');
          const binary = atob(raw);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const text = new TextDecoder().decode(bytes);
          setActiveFile(
            prepareActiveFileForEditor({
              name: data.name || entry.name,
              content: text,
              originalContent: text,
              githubPath: entry.githubPath,
              githubRepo: entry.githubRepo,
              githubSha: typeof data.sha === 'string' ? data.sha : undefined,
              githubBranch: entry.githubBranch,
              source_type: 'github',
            }),
          );
        } else if (entry.r2Bucket && entry.r2Key) {
          const { openR2KeyInEditor } = await import('../src/lib/mediaPreview');
          const opened = await openR2KeyInEditor(entry.r2Bucket, entry.r2Key, (f) => {
            setActiveFile(prepareActiveFileForEditor({ ...f, source_type: 'r2' }));
          });
          if (!opened) throw new Error('r2');
        } else if (entry.driveFileId) {
          const res = await fetch(
            `/api/integrations/gdrive/file?fileId=${encodeURIComponent(entry.driveFileId)}`,
            { credentials: 'same-origin' },
          );
          if (!res.ok) throw new Error('drive');
          const data = await res.json();
          const content = typeof data.content === 'string' ? data.content : '';
          setActiveFile(
            prepareActiveFileForEditor({
              name: entry.name,
              content,
              originalContent: content,
              driveFileId: entry.driveFileId,
              source_type: 'drive',
            }),
          );
        } else {
          applySnapshots();
          return;
        }
        revealMainWorkspaceIfNarrow();
        setOpenTabs((p) => (p.includes('code') ? p : [...p, 'code']));
        setActiveTab('code');
      } catch {
        applySnapshots('Opened from cached snapshot. Use Repos or Files to refresh from remote if needed.');
      }
    },
    [revealMainWorkspaceIfNarrow],
  );


  return { openRecentEntry };
}
