/**
 * Context Envelope v1 — user-picked focus artifact per chat turn (Sprint 1a: GitHub).
 */

export const CONTEXT_ENVELOPE_CONTENT_MAX = 48_000;

export type ContextEnvelopeFocusLane =
  | 'github'
  | 'r2'
  | 'drive'
  | 'local_buffer'
  | 'attachment'
  | null;

export type ContextEnvelopeV1 = {
  version: 1;
  conversation_id?: string | null;
  workspace_id?: string | null;
  exec_lane?: 'remote' | 'local' | 'sandbox' | null;
  focus: {
    lane: ContextEnvelopeFocusLane;
    github?: {
      repo: string;
      path: string;
      branch?: string;
      sha?: string | null;
    };
  };
  content?: {
    text: string;
    truncated: boolean;
    sha?: string | null;
  };
};

export type GithubFileHydration = {
  content: string;
  sha?: string | null;
  truncated: boolean;
};

/** Eager-read file body after picker selection (canonical GitHub path casing). */
export async function fetchGithubFileContent(
  repoFull: string,
  path: string,
  branch: string,
): Promise<GithubFileHydration | null> {
  const [owner, repo] = repoFull.split('/');
  if (!owner?.trim() || !repo?.trim() || !path?.trim()) return null;
  const qs = new URLSearchParams();
  qs.set('path', path.trim());
  if (branch.trim()) qs.set('ref', branch.trim());
  try {
    const res = await fetch(
      `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${qs}`,
      { credentials: 'same-origin' },
    );
    const data = (await res.json()) as { type?: string; content?: string; sha?: string };
    if (!res.ok || data?.type !== 'file' || typeof data.content !== 'string') return null;
    const decoded = atob(data.content.replace(/\n/g, ''));
    const max = CONTEXT_ENVELOPE_CONTENT_MAX;
    return {
      content: decoded.slice(0, max),
      sha: data.sha ?? null,
      truncated: decoded.length > max,
    };
  } catch {
    return null;
  }
}

export function buildGithubContextEnvelope(params: {
  conversationId?: string | null;
  workspaceId?: string | null;
  repo: string;
  path?: string | null;
  branch?: string;
  content?: string | null;
  contentSha?: string | null;
  contentTruncated?: boolean;
  execLane?: 'remote' | 'local' | 'sandbox' | null;
}): ContextEnvelopeV1 | null {
  const repo = params.repo?.trim();
  if (!repo) return null;
  const path = params.path?.trim() || null;
  const branch = params.branch?.trim() || null;

  const envelope: ContextEnvelopeV1 = {
    version: 1,
    conversation_id: params.conversationId?.trim() || null,
    workspace_id: params.workspaceId?.trim() || null,
    exec_lane: params.execLane ?? null,
    focus: { lane: null },
  };

  if (path) {
    envelope.focus = {
      lane: 'github',
      github: {
        repo,
        path,
        ...(branch ? { branch } : {}),
        sha: params.contentSha?.trim() || null,
      },
    };
  }

  if (params.content?.trim()) {
    envelope.content = {
      text: params.content.slice(0, CONTEXT_ENVELOPE_CONTENT_MAX),
      truncated:
        !!params.contentTruncated || params.content.length > CONTEXT_ENVELOPE_CONTENT_MAX,
      sha: params.contentSha?.trim() || null,
    };
  }

  return envelope;
}

/** User-message block — mirrors server formatActiveFileForAgent for locked GitHub focus. */
export function buildContextEnvelopeMessageBlock(envelope: ContextEnvelopeV1): string {
  const gh = envelope.focus?.github;
  if (!gh?.repo || !gh.path) return '';

  const lines = [
    '[Context envelope v1 — locked user selection. Use exact github path below; do NOT guess casing.]',
    `source: github`,
    `path: ${gh.repo}/${gh.path}`,
    `github_repo: ${gh.repo}`,
    `github_path: ${gh.path}`,
    ...(gh.branch ? [`github_branch: ${gh.branch}`] : ['github_branch: (unset — never invent main)']),
    '',
    '### Tool targets (locked)',
    gh.branch
      ? `- Read: agentsam_github_read({ repo: "${gh.repo}", path: "${gh.path}", ref: "${gh.branch}" })`
      : `- Read: agentsam_github_read — pass ref/branch explicitly (never invent main).`,
    `- Write: agentsam_github_write with the same repo, path, and branch (fail if branch unset).`,
  ];

  const content = envelope.content?.text?.trim();
  if (content) {
    lines.push('', `Pinned file: ${gh.repo}/${gh.path}`, '```', content, '```');
    lines.push(
      'Answer from the fenced content above — do NOT re-fetch via GitHub unless the user asks to compare with remote.',
    );
  }

  return lines.join('\n');
}
