/** App shell active-file save + agent R2 open (Wave 2 E6). */
import React, { useCallback, useRef } from 'react';
import type { ActiveFile } from '../types';
import {
  inferActiveFileSourceType,
  isNonPersistableEditorBuffer,
} from '../src/lib/prepareActiveFileForEditor';
import {
  localSaveRelPath,
  writeConnectedLocalFile,
} from '../src/lib/library/writeConnectedLocalFile';
import { guessMimeForDrive } from '../lib/guessMimeForDrive';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppFileSave(opts: {
  activeFile: ActiveFile | null;
  setActiveFile: (
    updates: Partial<ActiveFile> | ((prev: ActiveFile | null) => ActiveFile | null),
  ) => void;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
  setOpenTabs: React.Dispatch<React.SetStateAction<ShellTabId[]>>;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
  revealMainWorkspaceIfNarrow: () => void;
  isNarrowViewport: boolean;
}) {
  const {
    activeFile,
    setActiveFile,
    setToastMsg,
    setOpenTabs,
    setActiveTab,
    revealMainWorkspaceIfNarrow,
    isNarrowViewport,
  } = opts;

  const saveInFlightRef = useRef(false);
  const isDirty =
    !!activeFile &&
    activeFile.originalContent !== undefined &&
    activeFile.content !== activeFile.originalContent;

  const handleR2FileUpdatedFromAgent = useCallback(
    async (event: { type: 'r2_file_updated'; bucket: string; key: string }) => {
      if (event.type !== 'r2_file_updated' || !event.bucket || !event.key) return;
      try {
        const res = await fetch(
          `/api/r2/file?bucket=${encodeURIComponent(event.bucket)}&key=${encodeURIComponent(event.key)}`,
          { credentials: 'same-origin' },
        );
        if (!res.ok) return;
        const data = await res.json();
        const content = typeof data.content === 'string' ? data.content : '';
        const baseName = event.key.split('/').pop() || event.key;
        setActiveFile({
          name: baseName,
          content,
          originalContent: content,
          r2Key: event.key,
          r2Bucket: event.bucket,
        });
        revealMainWorkspaceIfNarrow();
        setOpenTabs((prev) => (prev.includes('code') ? prev : [...prev, 'code']));
        setActiveTab('code');
        if (isNarrowViewport) {
          setToastMsg('Opened R2 file in editor. Tap Chat to return.');
        }
      } catch (e) {
        console.error(e);
      }
    },
    [
      isNarrowViewport,
      revealMainWorkspaceIfNarrow,
      setActiveFile,
      setOpenTabs,
      setActiveTab,
      setToastMsg,
    ],
  );

  const handleSaveFile = useCallback(
    async (content: string) => {
      if (!activeFile) return;
      if (saveInFlightRef.current) {
        setToastMsg('Save already in progress');
        return;
      }
      if (isNonPersistableEditorBuffer(activeFile)) {
        setToastMsg('Cannot save: tool output tab — open the real file from Files');
        return;
      }
      const sourceType =
        activeFile.source_type != null
          ? activeFile.source_type
          : inferActiveFileSourceType(activeFile);

      const clearDirty = (extra?: Partial<ActiveFile>) => {
        setActiveFile((prev) =>
          prev
            ? { ...prev, content, originalContent: content, source_type: sourceType, ...extra }
            : null,
        );
      };

      saveInFlightRef.current = true;
      try {
        if (sourceType === 'mcp_tool' || sourceType === 'plan_d1' || sourceType === 'ephemeral') {
          setToastMsg(
            sourceType === 'mcp_tool'
              ? 'Cannot save: MCP tool config is not a file — use Settings'
              : sourceType === 'plan_d1'
                ? 'Cannot save: plan buffer is not a file destination'
                : 'Cannot save: reopen the real file from Files (Local / GitHub / R2 / Drive)',
          );
          return;
        }

        if (sourceType === 'drive') {
          if (!activeFile.driveFileId) {
            setToastMsg('Cannot save: missing Drive file id — reopen from Drive');
            return;
          }
          try {
            const res = await fetch('/api/drive/file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                fileId: activeFile.driveFileId,
                content,
                mimeType: guessMimeForDrive(activeFile.name || 'file.txt'),
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              setToastMsg(typeof data.error === 'string' ? data.error : 'Drive save failed');
              return;
            }
            clearDirty();
            setToastMsg('Saved to Google Drive');
          } catch (e) {
            setToastMsg(e instanceof Error ? e.message : 'Drive save failed');
          }
          return;
        }

        if (sourceType === 'local') {
          if (activeFile.handle) {
            try {
              const writable = await activeFile.handle.createWritable();
              await writable.write(content);
              await writable.close();
              clearDirty({ source_type: 'local' });
              setToastMsg('Saved');
            } catch (err) {
              setToastMsg(err instanceof Error ? err.message : 'Local file save failed');
            }
            return;
          }
          const rel = localSaveRelPath(activeFile);
          if (!rel) {
            setToastMsg('Cannot save: no path under Local — reopen from the Files tree');
            return;
          }
          const written = await writeConnectedLocalFile(rel, content, { createDirs: true });
          if (written.ok === false) {
            setToastMsg(
              written.hint ||
                (written.error === 'local_folder_not_connected'
                  ? 'Connect a Local folder in Files, then Save again'
                  : written.error),
            );
            return;
          }
          clearDirty({
            handle: written.handle,
            workspacePath: written.workspacePath,
            source_type: 'local',
            name: written.workspacePath.split('/').pop() || activeFile.name,
            githubRepo: undefined,
            githubPath: undefined,
            githubSha: undefined,
            githubBranch: undefined,
          });
          setToastMsg(`Saved to Local (${written.rootName})`);
          return;
        }

        if (sourceType === 'r2') {
          if (!activeFile.r2Key) {
            setToastMsg('Cannot save: missing R2 key — reopen from Files');
            return;
          }
          try {
            const res = await fetch('/api/r2/file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                bucket: activeFile.r2Bucket ?? 'DASHBOARD',
                key: activeFile.r2Key,
                content,
              }),
            });
            if (!res.ok) {
              const detail = await res.text().catch(() => '');
              setToastMsg(detail ? `R2 save failed: ${detail.slice(0, 160)}` : 'R2 save failed');
              return;
            }
            clearDirty({ source_type: 'r2' });
            setToastMsg('Saved to R2');
          } catch (e) {
            setToastMsg(e instanceof Error ? e.message : 'R2 save failed');
          }
          return;
        }

        if (sourceType === 'github') {
          if (!activeFile.githubPath || !activeFile.githubRepo) {
            setToastMsg('Cannot save: missing GitHub repo/path — reopen from GitHub Files');
            return;
          }
          const parts = activeFile.githubRepo.split('/');
          const owner = parts[0];
          const repo = parts[1];
          if (!owner || !repo) {
            setToastMsg('Cannot save: invalid GitHub repo');
            return;
          }
          let branch = activeFile.githubBranch?.trim() || '';
          if (!branch) {
            try {
              const statusQs = new URLSearchParams({ repo: activeFile.githubRepo });
              const statusRes = await fetch(`/api/agent/git/status?${statusQs}`, {
                credentials: 'same-origin',
              });
              const statusBody = (await statusRes.json().catch(() => ({}))) as {
                default_branch?: string | null;
                error?: string;
              };
              if (!statusRes.ok) {
                throw new Error(
                  statusBody.error || `github_default_branch_status_failed:${statusRes.status}`,
                );
              }
              branch =
                statusBody.default_branch != null
                  ? String(statusBody.default_branch).trim()
                  : '';
              if (!branch) throw new Error(`github_default_branch_unresolved:${activeFile.githubRepo}`);
            } catch {
              setToastMsg(
                'Cannot save: no branch stamped and repo default_branch unresolved — reopen from GitHub Files',
              );
              return;
            }
          }
          let sha = activeFile.githubSha;
          if (!sha) {
            try {
              const qs = new URLSearchParams({ path: activeFile.githubPath, ref: branch });
              const head = await fetch(
                `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${qs}`,
                { credentials: 'same-origin' },
              );
              const headData = await head.json().catch(() => ({}));
              if (!head.ok || typeof headData.sha !== 'string') {
                setToastMsg('Cannot save: missing GitHub file sha — reopen the file from GitHub');
                return;
              }
              sha = headData.sha;
            } catch {
              setToastMsg('Cannot save: could not load GitHub file sha — reopen from GitHub');
              return;
            }
          }
          const base64 = btoa(unescape(encodeURIComponent(content)));
          const postOnce = async (useSha: string) =>
            fetch(
              `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                  path: activeFile.githubPath,
                  message: 'Update via Agent Sam',
                  content: base64,
                  sha: useSha,
                  branch,
                }),
              },
            );
          try {
            let res = await postOnce(sha);
            let data = await res.json().catch(() => ({}));
            if (!res.ok && (res.status === 409 || res.status === 422)) {
              const qs = new URLSearchParams({ path: activeFile.githubPath, ref: branch });
              const head = await fetch(
                `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${qs}`,
                { credentials: 'same-origin' },
              );
              const headData = await head.json().catch(() => ({}));
              if (!head.ok || typeof headData.sha !== 'string') {
                setToastMsg(
                  typeof data.error === 'string'
                    ? data.error
                    : `GitHub save conflict (${res.status}) — reopen the file`,
                );
                return;
              }
              res = await postOnce(headData.sha);
              data = await res.json().catch(() => ({}));
            }
            if (!res.ok) {
              setToastMsg(
                typeof data.error === 'string' ? data.error : `GitHub save failed (${res.status})`,
              );
              return;
            }
            const newSha = data.content?.sha || data.sha;
            clearDirty({
              source_type: 'github',
              githubSha: newSha || sha,
              handle: undefined,
              workspacePath: undefined,
            });
            setToastMsg('Saved to GitHub');
          } catch (e) {
            setToastMsg(e instanceof Error ? e.message : 'GitHub save failed');
          }
          return;
        }

        setToastMsg(
          'Cannot save: unknown buffer source — reopen from Files (Local / GitHub / R2 / Drive)',
        );
      } finally {
        saveInFlightRef.current = false;
      }
    },
    [activeFile, setActiveFile, setToastMsg],
  );

  return {
    isDirty,
    handleSaveFile,
    handleR2FileUpdatedFromAgent,
  };
}
