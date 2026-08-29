/**
 * Shared GitHub clone-into-workspace flow for App library + Files rail.
 * Always surfaces toast/status — never silent.
 */

export type CloneGithubResult =
  | { ok: true; github_repo: string; workspace_root: string }
  | { ok: false; error: string; cancelled?: boolean };

function parseGithubCloneRef(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const urlMatch = s.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i,
  );
  if (urlMatch?.[1]) return urlMatch[1].replace(/\.git$/i, '');
  const short = s.replace(/^github:/i, '').replace(/\.git$/i, '').trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(short)) return short;
  return null;
}

/**
 * Prompt for owner/repo (or URL), POST /api/agent/git/clone, emit workspace event.
 */
export async function cloneGithubIntoWorkspace(opts: {
  workspaceId?: string | null;
  initialRef?: string | null;
  /** Skip window.prompt when initialRef is already a valid owner/repo. */
  skipPrompt?: boolean;
}): Promise<CloneGithubResult> {
  const ws = String(opts.workspaceId || '').trim();
  let raw = String(opts.initialRef || '').trim();
  if (!opts.skipPrompt || !raw) {
    const prompted = window.prompt(
      'Clone into workspace — GitHub owner/repo (or URL):',
      raw || '',
    );
    if (prompted == null) return { ok: false, error: 'cancelled', cancelled: true };
    raw = prompted;
  }
  const ref = parseGithubCloneRef(raw);
  if (!ref) {
    console.warn('[cloneGithubIntoWorkspace] invalid_ref', raw);
    return { ok: false, error: 'Invalid GitHub ref — use owner/repo or a github.com URL' };
  }

  console.info('[cloneGithubIntoWorkspace] start', { ref, workspace_id: ws || null });
  try {
    const res = await fetch('/api/agent/git/clone', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(ws ? { 'X-IAM-Workspace-Id': ws } : {}),
      },
      body: JSON.stringify({ repo: ref, workspace_id: ws || undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      repo_path?: string;
      workspace_root?: string;
      github_repo?: string;
      body?: { user_message?: string };
    };
    if (!res.ok || !data.ok) {
      const err =
        data.body?.user_message || data.error || `Clone failed (${res.status})`;
      console.warn('[cloneGithubIntoWorkspace] failed', { ref, status: res.status, err });
      return { ok: false, error: err };
    }
    const root = String(data.workspace_root || data.repo_path || '').trim();
    if (!root) {
      console.warn('[cloneGithubIntoWorkspace] missing_workspace_root', data);
      return { ok: false, error: 'Clone returned without workspace_root — refusing silent success' };
    }
    const githubRepo = String(data.github_repo || ref).trim();
    console.info('[cloneGithubIntoWorkspace] ok', { github_repo: githubRepo, workspace_root: root });
    window.dispatchEvent(
      new CustomEvent('iam_workspace_github_repo', {
        detail: {
          workspaceId: ws || null,
          github_repo: githubRepo,
          workspace_root: root,
        },
      }),
    );
    return { ok: true, github_repo: githubRepo, workspace_root: root };
  } catch (e) {
    const err = e instanceof Error ? e.message : 'Clone failed';
    console.warn('[cloneGithubIntoWorkspace] exception', err);
    return { ok: false, error: err };
  }
}
