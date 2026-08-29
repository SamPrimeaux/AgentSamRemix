/**
 * Settings section: Index Rules (agentsam_ignore_pattern) — codebase
 * indexer ignore/include rules, read/write/preview.
 * - GET  /api/settings/indexrules
 * - PUT  /api/settings/indexrules
 * - POST /api/settings/indexrules/preview
 * Deconstructed from src/api/settings-sections.js (Sections peel SEC6, no
 * behavior change).
 */
import { jsonResponse } from '../core/auth.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import {
  IGNORE_POLICY_EMPTY,
  applyRepoIgnorePolicy,
  loadRepoIgnorePolicy,
  normalizeIgnorePolicyRepo,
} from '../../packages/shared/code-index/ignore-policy.js';
import { tableExists, safeQueryAll, safeFirst, envelope } from './settings-sections-shared.js';

// ─── Section: Index Rules (agentsam_ignore_pattern) ──────────────────────────
function patternsToText(patterns) {
  return patterns
    .map((p) => (Number(p.is_negation) === 1 ? `!${p.pattern}` : p.pattern))
    .join('\n');
}

function parseIndexRulesText(raw) {
  const lines = String(raw ?? '').split(/\r\n|\r|\n/);
  const out = [];
  let order = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const isNegation = line.startsWith('!') ? 1 : 0;
    const pattern = (isNegation ? line.slice(1) : line).trim();
    if (!pattern) continue;
    out.push({ pattern, is_negation: isNegation, order_index: order });
    order += 1;
  }
  return out;
}

async function getIndexRules(env, authUser, repoFullNameRaw) {
  const repo = normalizeIgnorePolicyRepo(repoFullNameRaw);
  if (!repo) {
    return jsonResponse({ ok: false, error: 'repo_full_name_required' }, 400);
  }
  const warnings = [];
  const cache = new Map();
  const rows = await safeQueryAll(
    env.DB,
    'agentsam_ignore_pattern',
    `SELECT id, pattern, is_negation, order_index, source, updated_at_unix
       FROM agentsam_ignore_pattern
      WHERE repo_full_name = ?
      ORDER BY order_index ASC`,
    [repo],
    warnings,
    cache,
  );
  const patterns = rows.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    is_negation: Number(r.is_negation) === 1 ? 1 : 0,
    order_index: Number(r.order_index) || 0,
    source: r.source || null,
    updated_at_unix: r.updated_at_unix != null ? Number(r.updated_at_unix) : null,
  }));
  return jsonResponse({
    ok: true,
    repo_full_name: repo,
    patterns,
    text: patternsToText(patterns),
    warnings,
  });
}

/**
 * PUT /api/settings/indexrules
 * Body: { repo_full_name, text } OR { repo_full_name, patterns: [{ pattern, is_negation, order_index }] }
 * Transactional replace: delete-all + insert ordered rows. Rejects an empty result —
 * never leaves a repo at 0 rows after save (crawl fails loud on empty policy).
 */
async function putIndexRules(request, env, authUser) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const repo = normalizeIgnorePolicyRepo(body?.repo_full_name);
  if (!repo) return jsonResponse({ error: 'repo_full_name required (owner/name)' }, 400);

  const userId = (await resolveIntegrationUserId(env, authUser)) || String(authUser?.id || '').trim();
  if (!userId) return jsonResponse({ error: 'auth_required' }, 401);
  const personUuid = authUser?.person_uuid != null ? String(authUser.person_uuid).trim() : '';
  if (!personUuid) return jsonResponse({ error: 'person_uuid_required' }, 400);

  // Same gate as /api/settings/github/reindex — require a live GitHub token for this user.
  const tokenRow = await env.DB.prepare(
    `SELECT provider FROM user_oauth_tokens WHERE user_id = ? AND provider IN ('github','github_app') LIMIT 1`,
  )
    .bind(userId)
    .first()
    .catch(() => null);
  if (!tokenRow) {
    return jsonResponse(
      { error: 'github_oauth_required', message: 'Connect GitHub OAuth before editing index rules.' },
      400,
    );
  }

  let entries;
  if (Array.isArray(body?.patterns)) {
    entries = body.patterns
      .map((p, i) => ({
        pattern: p?.pattern != null ? String(p.pattern).trim() : '',
        is_negation: Number(p?.is_negation) === 1 ? 1 : 0,
        order_index: Number.isFinite(Number(p?.order_index)) ? Number(p.order_index) : i,
      }))
      .filter((p) => p.pattern);
  } else if (typeof body?.text === 'string') {
    entries = parseIndexRulesText(body.text);
  } else {
    return jsonResponse({ error: 'text_or_patterns_required' }, 400);
  }

  const seen = new Set();
  const deduped = [];
  for (const e of entries) {
    const key = `${e.is_negation}:${e.pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }

  if (!deduped.length) {
    return jsonResponse(
      {
        error: IGNORE_POLICY_EMPTY,
        message: 'At least one pattern is required — a repo cannot be saved with 0 rows.',
      },
      400,
    );
  }

  const stmts = [
    env.DB.prepare(`DELETE FROM agentsam_ignore_pattern WHERE repo_full_name = ?`).bind(repo),
  ];
  for (const e of deduped) {
    const id = `igp_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO agentsam_ignore_pattern
           (id, repo_full_name, user_id, person_uuid, pattern, is_negation, order_index, source,
            created_at_unix, updated_at_unix)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'settings_ui', unixepoch(), unixepoch())`,
      ).bind(id, repo, userId, personUuid, e.pattern, e.is_negation, e.order_index),
    );
  }

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    return jsonResponse({ error: e?.message || 'ignore_pattern_save_failed' }, 500);
  }

  return getIndexRules(env, authUser, repo);
}

/**
 * POST /api/settings/indexrules/preview
 * Body: { repo_full_name, path } → { ok, ignored, reason } using the saved policy.
 */
async function postIndexRulesPreview(request, env, authUser) {
  if (!env?.DB) return jsonResponse({ error: 'DB not configured' }, 503);
  const body = await request.json().catch(() => ({}));
  const repo = normalizeIgnorePolicyRepo(body?.repo_full_name);
  const path = body?.path != null ? String(body.path).trim() : '';
  if (!repo) return jsonResponse({ error: 'repo_full_name required (owner/name)' }, 400);
  if (!path) return jsonResponse({ error: 'path required' }, 400);
  try {
    const policy = await loadRepoIgnorePolicy(env.DB, repo);
    const result = applyRepoIgnorePolicy(policy, path);
    return jsonResponse({ ok: true, repo_full_name: repo, path, ...result });
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg === IGNORE_POLICY_EMPTY) {
      return jsonResponse({ error: msg, message: 'No patterns saved yet for this repo.' }, 404);
    }
    return jsonResponse({ error: msg }, 400);
  }
}

// ─── Public dispatcher ───────────────────────────────────────────────────────
/**
 * Dispatcher for normalized data-backed status endpoints under /api/settings/*.
 * Returns null if the path is not handled, so the legacy dispatcher continues.
 *
 * Handles:
 *   GET    /api/settings/network
 *   POST   /api/settings/network/domains   { domain, workspace_id? }
 *   DELETE /api/settings/network/domains   { domain, workspace_id? }
 */

export { getIndexRules, putIndexRules, postIndexRulesPreview };
