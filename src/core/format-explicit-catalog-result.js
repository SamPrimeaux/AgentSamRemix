/**
 * Format explicit-catalog preinvoke results for chat (not raw JSON dumps).
 * Preinvoke stays (deterministic tool call); this is presentation only.
 */

import {
  isInternalAgentErrorText,
  synthesizeUserVisibleAgentFailure,
} from '../../shared/agent-runtime/user-visible-agent-error.js';

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>|null}
 */
function parseJsonObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return /** @type {Record<string, unknown>} */ (raw);
  }
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(t);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} commits
 * @param {{ repo?: string, ref?: string }} meta
 */
function formatCommitsMarkdown(commits, meta = {}) {
  const rows = Array.isArray(commits) ? commits : [];
  if (!rows.length) {
    return `No commits returned for **${meta.repo || 'repo'}** (${meta.ref || 'main'}).`;
  }
  const lines = [
    `Recent commits on **${meta.repo || 'repo'}** (\`${meta.ref || 'main'}\`):`,
    '',
  ];
  for (const c of rows.slice(0, 20)) {
    if (!c || typeof c !== 'object') continue;
    const sha = String(c.short_sha || (c.sha != null ? String(c.sha).slice(0, 7) : '')).trim();
    const msg = String(c.message || '').trim() || '(no message)';
    const author = c.author != null ? String(c.author).trim() : '';
    const date = c.date != null ? String(c.date).trim() : '';
    const metaBits = [author, date].filter(Boolean).join(' · ');
    lines.push(`- \`${sha || '?'}\` ${msg}${metaBits ? ` — ${metaBits}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Prefer human-readable GitHub failures (404 / rate limit) over bare error codes.
 * @param {Record<string, unknown>} parsed
 * @param {string} actionLabel
 */
function formatGithubToolErrorMarkdown(parsed, actionLabel = 'request') {
  const body =
    parsed.body && typeof parsed.body === 'object' && !Array.isArray(parsed.body)
      ? /** @type {Record<string, unknown>} */ (parsed.body)
      : parsed;
  const status = Number(body.status ?? parsed.status ?? 0) || null;
  const code = String(parsed.error || body.error || 'github_api_error');
  const userMsg =
    (body.user_message != null && String(body.user_message).trim()) ||
    (parsed.user_message != null && String(parsed.user_message).trim()) ||
    '';
  const detail =
    userMsg ||
    (body.message != null ? String(body.message).trim() : '') ||
    (parsed.message != null ? String(parsed.message).trim() : '') ||
    code;
  const repo =
    (body.repo != null && String(body.repo).trim()) ||
    (parsed.repo != null && String(parsed.repo).trim()) ||
    '';
  const lines = [`GitHub ${actionLabel} failed${repo ? ` for **${repo}**` : ''}.`];
  if (status === 404 || code === 'github_repo_not_found') {
    lines.push('');
    lines.push(detail.includes('404') || detail.includes('not find') ? detail : `Repository not found (404). ${detail}`);
    lines.push('');
    lines.push('Try checking the owner/name spelling, or call `agentsam_github_repo_list` for similar repos.');
  } else {
    lines.push('');
    lines.push(detail);
    if (code && detail !== code) lines.push(`\n_(${code}${status ? `, HTTP ${status}` : ''})_`);
  }
  return lines.join('\n');
}

/**
 * @param {Record<string, unknown>} parsed
 */
function formatFsReadMarkdown(parsed) {
  const path = String(parsed.path || 'file').trim();
  const exitCode = Number(parsed.exit_code ?? 0);
  const ok = parsed.success !== false && exitCode === 0 && !parsed.error;
  const content = parsed.content != null ? String(parsed.content) : '';
  if (!ok) {
    const err =
      (parsed.error != null ? String(parsed.error) : '') ||
      content.slice(0, 500) ||
      'read failed';
    return `Could not read \`${path}\`.\n\n${err}`;
  }
  const fence = path.endsWith('.json')
    ? 'json'
    : path.endsWith('.md')
      ? 'markdown'
      : path.endsWith('.ts') || path.endsWith('.tsx')
        ? 'typescript'
        : path.endsWith('.js') || path.endsWith('.jsx')
          ? 'javascript'
          : '';
  const body = content.length > 12000 ? `${content.slice(0, 12000)}\n…` : content;
  const meta = [];
  if (parsed.truncated === true || parsed.next_byte_offset != null) {
    meta.push(
      `truncated — pass byte_offset:${parsed.next_byte_offset ?? '?'} (or narrow line_start/line_end) for the next page`,
    );
  }
  if (parsed.line_start != null && parsed.line_end != null) {
    meta.push(`lines ${parsed.line_start}–${parsed.line_end}`);
  }
  const suffix = meta.length ? `\n\n_(${meta.join('; ')})_` : '';
  return `Contents of \`${path}\`:\n\n\`\`\`${fence}\n${body}\n\`\`\`${suffix}`;
}

/**
 * @param {string} toolName
 * @param {unknown} toolOutput
 * @returns {string}
 */
export function formatExplicitCatalogToolResult(toolName, toolOutput) {
  const name = String(toolName || '')
    .trim()
    .toLowerCase();
  const parsed = parseJsonObject(toolOutput);

  if (name === 'agentsam_github_list_commits' && parsed) {
    if (parsed.ok === false || parsed.error) {
      return formatGithubToolErrorMarkdown(parsed, 'list commits');
    }
    return formatCommitsMarkdown(parsed.commits, {
      repo: parsed.repo != null ? String(parsed.repo) : undefined,
      ref: parsed.ref != null ? String(parsed.ref) : undefined,
    });
  }

  if (name.startsWith('agentsam_github_') && parsed && (parsed.ok === false || parsed.error)) {
    return formatGithubToolErrorMarkdown(parsed, name.replace(/^agentsam_github_/, ''));
  }

  if (name === 'fs_read_file' && parsed) {
    return formatFsReadMarkdown(parsed);
  }

  if (name === 'fs_search_files' && parsed) {
    const matches = Array.isArray(parsed.matches)
      ? parsed.matches
      : Array.isArray(parsed.results)
        ? parsed.results
        : Array.isArray(parsed.files)
          ? parsed.files
          : [];
    if (matches.length) {
      const lines = matches.slice(0, 30).map((m) => {
        if (typeof m === 'string') return `- ${m}`;
        if (m && typeof m === 'object') {
          const p = m.path || m.file || m.name;
          return p ? `- ${p}` : `- ${JSON.stringify(m).slice(0, 120)}`;
        }
        return `- ${String(m)}`;
      });
      return `Search results:\n\n${lines.join('\n')}`;
    }
  }

  if (
    (name === 'agentsam_github_tree' || name === 'agentsam_github_read') &&
    parsed &&
    parsed.ok !== false
  ) {
    if (typeof parsed.text === 'string' && parsed.text.trim()) {
      const body = parsed.text.length > 12000 ? `${parsed.text.slice(0, 12000)}\n…` : parsed.text;
      const path = parsed.path != null ? String(parsed.path) : 'file';
      return `Contents of \`${path}\`:\n\n\`\`\`\n${body}\n\`\`\``;
    }
    if (Array.isArray(parsed.tree)) {
      const sample = parsed.tree.slice(0, 40).map((e) => {
        const p = e?.path != null ? String(e.path) : '';
        const t = e?.type != null ? String(e.type) : '';
        return `- ${p}${t ? ` (${t})` : ''}`;
      });
      return `Tree (${parsed.tree_count ?? parsed.tree.length} entries):\n\n${sample.join('\n')}`;
    }
  }

  // Generic: pretty JSON in a fence (never a single-line dump).
  if (parsed) {
    try {
      const pretty = JSON.stringify(parsed, null, 2);
      const clipped = pretty.length > 12000 ? `${pretty.slice(0, 12000)}\n…` : pretty;
      return `\`\`\`json\n${clipped}\n\`\`\``;
    } catch {
      /* fall through */
    }
  }

  const raw = typeof toolOutput === 'string' ? toolOutput.trim() : String(toolOutput ?? '');
  if (!raw) return `Ran \`${name || 'tool'}\`.`;
  // Never surface tool_timeout / "Tool execution failed: …" as assistant prose.
  if (isInternalAgentErrorText(raw)) {
    return synthesizeUserVisibleAgentFailure(raw);
  }
  if (name.startsWith('agentsam_github_') && /github_|not_found|api_error|404/i.test(raw)) {
    return [
      'GitHub request failed.',
      '',
      raw.length > 2000 ? `${raw.slice(0, 2000)}…` : raw,
      '',
      'If the repo name may be wrong, call `agentsam_github_repo_list` to find a close match.',
    ].join('\n');
  }
  return raw.length > 12000 ? `${raw.slice(0, 12000)}…` : raw;
}
