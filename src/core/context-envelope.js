/**
 * Context Envelope v1 — parse dashboard JSON → active file envelope + tool defaults.
 */

export const CONTEXT_ENVELOPE_VERSION = 1;
export const CONTEXT_ENVELOPE_CONTENT_MAX = 48_000;

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>|null}
 */
export function parseContextEnvelope(body) {
  const b = body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {};
  let raw = b.context_envelope ?? b.contextEnvelope ?? null;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const env = /** @type {Record<string, unknown>} */ (raw);
  if (Number(env.version) !== CONTEXT_ENVELOPE_VERSION) return null;
  return env;
}

/**
 * @param {Record<string, unknown>|null|undefined} envelope
 */
export function contextEnvelopeGithubFocus(envelope) {
  if (!envelope) return null;
  const focus = envelope.focus;
  if (!focus || typeof focus !== 'object') return null;
  const f = /** @type {Record<string, unknown>} */ (focus);
  if (String(f.lane || '') !== 'github') return null;
  const gh = f.github;
  if (!gh || typeof gh !== 'object') return null;
  const g = /** @type {Record<string, unknown>} */ (gh);
  const repo = String(g.repo || '').trim();
  const path = String(g.path || '').trim();
  if (!repo || !path) return null;
  const branch = String(g.branch || '').trim();
  if (!branch) return null;
  const sha = g.sha != null ? String(g.sha).trim() : '';
  return { repo, path, branch, sha: sha || null };
}

/**
 * @param {Record<string, unknown>|null|undefined} envelope
 */
export function contextEnvelopeContentText(envelope) {
  if (!envelope) return null;
  const content = envelope.content;
  if (!content || typeof content !== 'object') return null;
  const c = /** @type {Record<string, unknown>} */ (content);
  const text = c.text != null ? String(c.text) : '';
  return text.trim() ? text : null;
}

/**
 * Build FormData-shaped fields from envelope v1 (GitHub focus).
 * @param {Record<string, unknown>|null|undefined} envelope
 */
export function envelopeToActiveFileBodyFields(envelope) {
  const gh = contextEnvelopeGithubFocus(envelope);
  if (!gh) return null;
  const content = contextEnvelopeContentText(envelope);
  const fields = {
    active_file_source: 'github',
    active_file_github_repo: gh.repo,
    active_file_github_path: gh.path,
    active_file_github_branch: gh.branch,
    active_file_path: `${gh.repo}/${gh.path}`,
  };
  if (gh.sha) fields.active_file_github_sha = gh.sha;
  if (content) fields.active_file_content = content.slice(0, CONTEXT_ENVELOPE_CONTENT_MAX);
  return fields;
}

/**
 * Merge context envelope into parsed active file envelope (GitHub path is authoritative).
 * @param {ReturnType<typeof import('./active-file-envelope.js').parseActiveFileEnvelope>|null} activeFileEnvelope
 * @param {Record<string, unknown>|null|undefined} contextEnvelope
 * @param {{ parseActiveFileEnvelope: Function, activeFileIsLocalWorkspaceBuffer: Function }} helpers
 */
export function mergeContextEnvelopeIntoActiveFile(activeFileEnvelope, contextEnvelope, helpers) {
  const fields = envelopeToActiveFileBodyFields(contextEnvelope);
  if (!fields) return activeFileEnvelope;

  const { parseActiveFileEnvelope, activeFileIsLocalWorkspaceBuffer } = helpers;

  if (activeFileEnvelope && activeFileIsLocalWorkspaceBuffer(activeFileEnvelope)) {
    return activeFileEnvelope;
  }

  const prior =
    activeFileEnvelope && typeof activeFileEnvelope === 'object'
      ? {
          active_file_source: activeFileEnvelope.source,
          active_file_github_repo: activeFileEnvelope.github_repo,
          active_file_github_path: activeFileEnvelope.github_path,
          active_file_github_branch: activeFileEnvelope.github_branch,
          active_file_github_sha: activeFileEnvelope.github_sha,
          active_file_r2_bucket: activeFileEnvelope.r2_bucket,
          active_file_r2_key: activeFileEnvelope.r2_key,
          active_file_drive_id: activeFileEnvelope.drive_file_id,
          active_file_workspace_path: activeFileEnvelope.workspace_path,
          active_file_path: activeFileEnvelope.path,
          active_file_content: activeFileEnvelope.content,
        }
      : {};

  const mergedFields = { ...prior, ...fields };
  if (!mergedFields.active_file_content && activeFileEnvelope?.content) {
    mergedFields.active_file_content = activeFileEnvelope.content;
  }

  return parseActiveFileEnvelope(mergedFields);
}
