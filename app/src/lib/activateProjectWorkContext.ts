/**
 * Align dashboard + agent session to a projects.id build lane (repo/worker/D1).
 * Server POST /api/projects/:id/activate sets auth_users.active_workspace_id;
 * client mirrors workspace + session project for chat/todos.
 */
import { writeChatGithubContext } from '../../components/ChatAssistant/types';
import {
  EXECUTION_GITHUB_REPO_KEY,
  EXECUTION_PROJECT_ID_KEY,
  EXECUTION_PROJECT_NAME_KEY,
  EXECUTION_WORKSPACE_ID_KEY,
} from './sessionStorageKeys';

export type ProjectWorkBindings = {
  workspaceId: string | null;
  slug: string | null;
  name: string | null;
  projectId: string | null;
  githubRepo: string | null;
  rootPath: string | null;
  workerName: string | null;
  deployUrl: string | null;
  d1DatabaseId: string | null;
};

export type ActivateProjectWorkContextResult = {
  ok: boolean;
  executionWorkspaceId: string | null;
  bindings: ProjectWorkBindings | null;
  workspaceActivated: boolean;
  error?: string;
};

export function readExecutionWorkspaceId(): string | null {
  try {
    return sessionStorage.getItem(EXECUTION_WORKSPACE_ID_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/** Project activate pin that survives fresh-chat session-project wipe. */
export function readExecutionProject(): { id: string; name: string } | null {
  try {
    const id = sessionStorage.getItem(EXECUTION_PROJECT_ID_KEY)?.trim() || '';
    if (!id) return null;
    const name = sessionStorage.getItem(EXECUTION_PROJECT_NAME_KEY)?.trim() || id;
    return { id, name };
  } catch {
    return null;
  }
}

function writeExecutionWorkspaceId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(EXECUTION_WORKSPACE_ID_KEY, id);
    else sessionStorage.removeItem(EXECUTION_WORKSPACE_ID_KEY);
  } catch {
    /* ignore */
  }
}

function writeExecutionProject(project: { id: string; name: string } | null) {
  try {
    if (project?.id) {
      sessionStorage.setItem(EXECUTION_PROJECT_ID_KEY, project.id);
      sessionStorage.setItem(EXECUTION_PROJECT_NAME_KEY, project.name || project.id);
    } else {
      sessionStorage.removeItem(EXECUTION_PROJECT_ID_KEY);
      sessionStorage.removeItem(EXECUTION_PROJECT_NAME_KEY);
    }
  } catch {
    /* ignore */
  }
}

function writeExecutionGithubRepo(repo: string | null) {
  try {
    const r = repo != null ? String(repo).trim() : '';
    if (r) sessionStorage.setItem(EXECUTION_GITHUB_REPO_KEY, r);
    else sessionStorage.removeItem(EXECUTION_GITHUB_REPO_KEY);
  } catch {
    /* ignore */
  }
}

export function readExecutionGithubRepo(): string | null {
  try {
    return sessionStorage.getItem(EXECUTION_GITHUB_REPO_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/** Drop project-activate pin so chat/approval/terminal follow auth workspace again. */
export function clearExecutionWorkContext(): void {
  writeExecutionWorkspaceId(null);
  writeExecutionProject(null);
  writeExecutionGithubRepo(null);
  try {
    window.dispatchEvent(new CustomEvent('iam_execution_work_context_cleared'));
  } catch {
    /* ignore */
  }
}

function normalizeBindings(raw: unknown): ProjectWorkBindings | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  return {
    workspaceId: b.workspaceId != null ? String(b.workspaceId).trim() || null : null,
    slug: b.slug != null ? String(b.slug).trim() || null : null,
    name: b.name != null ? String(b.name).trim() || null : null,
    projectId: b.projectId != null ? String(b.projectId).trim() || null : null,
    githubRepo: b.githubRepo != null ? String(b.githubRepo).trim() || null : null,
    rootPath: b.rootPath != null ? String(b.rootPath).trim() || null : null,
    workerName: b.workerName != null ? String(b.workerName).trim() || null : null,
    deployUrl: b.deployUrl != null ? String(b.deployUrl).trim() || null : null,
    d1DatabaseId: b.d1DatabaseId != null ? String(b.d1DatabaseId).trim() || null : null,
  };
}

export type SwitchWorkspaceFn = (
  id: string,
  meta?: { displayName?: string; slug?: string; github_repo?: string | null; sync?: boolean },
) => Promise<void>;

export type PersistGithubRepoFn = (repoFullName: string, workspaceIdOverride?: string | null) => Promise<void>;

/**
 * POST activate + sync client workspace/session/github context.
 */
export async function activateProjectWorkContext(
  projectId: string,
  projectName: string,
  opts: {
    switchWorkspace: SwitchWorkspaceFn;
    persistGithubRepo?: PersistGithubRepoFn;
    currentWorkspaceId?: string | null;
    githubContextStorageKey?: string;
  },
): Promise<ActivateProjectWorkContextResult> {
  const pid = projectId.trim();
  if (!pid) return { ok: false, executionWorkspaceId: null, bindings: null, workspaceActivated: false, error: 'missing_project_id' };

  const r = await fetch(`/api/projects/${encodeURIComponent(pid)}/activate`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    execution_workspace_id?: string | null;
    workspace_activated?: boolean;
    bindings?: unknown;
    project?: { name?: string };
  };

  if (!r.ok || !data.ok) {
    return {
      ok: false,
      executionWorkspaceId: null,
      bindings: null,
      workspaceActivated: false,
      error: data.error || `HTTP ${r.status}`,
    };
  }

  const bindings = normalizeBindings(data.bindings);
  const executionWorkspaceId =
    (data.execution_workspace_id && String(data.execution_workspace_id).trim()) ||
    bindings?.workspaceId ||
    null;
  const displayName = data.project?.name?.trim() || projectName.trim() || pid;

  // Do not writeSessionProject here — that ambient-pins Agent Sam. Execution lane only.
  writeExecutionWorkspaceId(executionWorkspaceId);
  writeExecutionProject({ id: pid, name: displayName });
  writeExecutionGithubRepo(bindings?.githubRepo || null);

  // Do not change global workspace — only the launcher/status bar may switch workspace.
  // executionWorkspaceId is scoped to project/agent work via sessionStorage + KV cache.
  // Never persistGithubRepo here: that PATCH clobbers shared workspaces.github_repo
  // (e.g. ws_inneranimalmedia ← agentsam-sdk) for every project on the same workspace.

  if (bindings?.githubRepo && opts.githubContextStorageKey) {
    try {
      writeChatGithubContext(opts.githubContextStorageKey, {
        repo: bindings.githubRepo,
        path: null,
        branch: null,
        content: null,
        content_truncated: false,
        content_sha: null,
      });
    } catch {
      /* optional */
    }
  }

  window.dispatchEvent(
    new CustomEvent('iam_project_work_context', {
      detail: { projectId: pid, projectName: displayName, executionWorkspaceId, bindings },
    }),
  );

  return {
    ok: true,
    executionWorkspaceId,
    bindings,
    workspaceActivated: Boolean(data.workspace_activated),
  };
}
