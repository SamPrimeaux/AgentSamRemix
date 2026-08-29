/** Workspace display labels + toast seed (Wave 2). */
import React, { useMemo, useState } from 'react';
import { formatWorkspaceStatusLine, type IdeWorkspaceSnapshot } from '../src/ideWorkspace';
import { databaseStudioPathForWorkspace } from '../src/lib/databaseStudioRoute';
import { resolveWorkspaceContextLabel } from '../src/workspaceContextLabel';
import { coalesceLabel } from '../src/lib/coalesceLabel';
import type { AgentSamFsSourceContext } from '../src/lib/agentSamFilesystemTypes';

export function useAppWorkspaceIdentityLabels(opts: {
  authWorkspaceId: string | null | undefined;
  workspaceRows: any[];
  ideWorkspace: IdeWorkspaceSnapshot;
  filesSourceContext: AgentSamFsSourceContext | null;
  gitRepoFullName: string;
  sessionUserName: string | null | undefined;
  sessionUserId: string | null | undefined;
}) {
  const {
    authWorkspaceId, workspaceRows, ideWorkspace, filesSourceContext,
    gitRepoFullName, sessionUserName, sessionUserId,
  } = opts;

  const workspaceDisplayFallback = useMemo(() => {
    const id = authWorkspaceId?.trim();
    if (id && workspaceRows.length > 0) {
      const row = workspaceRows.find((w) => w.id === id);
      if (row?.slug?.trim()) return row.slug.trim();
      if (row?.name?.trim()) return row.name.trim();
      return id;
    }
    return formatWorkspaceStatusLine(ideWorkspace);
  }, [authWorkspaceId, workspaceRows, ideWorkspace]);

  const activeWorkspaceRow = useMemo(
    () => workspaceRows.find((w) => w.id === authWorkspaceId) ?? null,
    [workspaceRows, authWorkspaceId],
  );

  const databaseStudioPath = useMemo(
    () => databaseStudioPathForWorkspace(activeWorkspaceRow),
    [activeWorkspaceRow],
  );

  const workspaceContextLabel = useMemo(
    () =>
      resolveWorkspaceContextLabel({
        // Files rail label is SSOT when published; else explorer GitHub / workspace slug.
        filesLabel: filesSourceContext?.label ?? null,
        githubRepo:
          filesSourceContext?.source === 'github'
            ? coalesceLabel(filesSourceContext.github_repo ?? gitRepoFullName, '')
            : coalesceLabel(gitRepoFullName, ''),
        workspaceSlug: coalesceLabel(activeWorkspaceRow?.slug ?? null, ''),
        workspaceId: authWorkspaceId,
        ideWorkspace,
      }),
    [activeWorkspaceRow, authWorkspaceId, ideWorkspace, gitRepoFullName, filesSourceContext],
  );

  const userProfileLabel = useMemo(() => {
    const name = sessionUserName?.trim();
    if (name) return name;
    const id = sessionUserId?.trim();
    return id || 'Account';
  }, [sessionUserName, sessionUserId]);

  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const workspaceDisplayLine = coalesceLabel(
    workspaceContextLabel || workspaceDisplayFallback,
    'No workspace',
  );

  return {
    workspaceDisplayFallback,
    activeWorkspaceRow,
    databaseStudioPath,
    workspaceContextLabel,
    userProfileLabel,
    toastMsg,
    setToastMsg,
    workspaceDisplayLine,
  };
}
