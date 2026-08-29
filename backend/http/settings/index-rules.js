/** Hardened Index Rules settings API. */
import { getOAuthToken } from '../../identity/oauth/user-token.js';
import {
  IGNORE_POLICY_EMPTY,
  applyRepoIgnorePolicy,
  ignorePolicyVersion,
  loadRepoIgnorePolicy,
  normalizeIgnorePolicyRepo,
} from '../../agentsam/codebase/ignore-policy.js';

const MAX_TEXT_BYTES = 128 * 1024;
const MAX_PATTERNS = 500;
const MAX_PATTERN_LENGTH = 1024;
const MAX_PREVIEW_PATH = 4096;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function patternsToText(patterns) {
  return patterns.map((row) => Number(row.is_negation) === 1 ? `!${row.pattern}` : row.pattern).join('\n');
}

function parseIndexRulesText(raw) {
  const text = String(raw ?? '');
  if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new Error('index_rules_too_large');
  const rows = [];
  const seen = new Set();
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const isNegation = line.startsWith('!') ? 1 : 0;
    const pattern = (isNegation ? line.slice(1) : line).trim();
    if (!pattern) continue;
    if (pattern.length > MAX_PATTERN_LENGTH) throw new Error('index_rule_pattern_too_long');
    const key = `${isNegation}:${pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ pattern, is_negation: isNegation, order_index: rows.length });
    if (rows.length > MAX_PATTERNS) throw new Error('index_rules_too_many');
  }
  return rows;
}

async function githubToken(env, userId) {
  return getOAuthToken(env, userId, 'github', '').catch(() => null);
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'AgentSamRemix-IndexRules/1.0',
  };
}

async function assertExactRepoAccess(env, userId, repo) {
  const token = await githubToken(env, userId);
  if (!token) return { ok: false, status: 400, error: 'github_oauth_required' };
  const response = await fetch(`https://api.github.com/repos/${repo.split('/').map(encodeURIComponent).join('/')}`, {
    headers: githubHeaders(token),
  });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status === 404 ? 403 : response.status,
      error: response.status === 404 ? 'repo_access_forbidden' : 'github_repo_check_failed',
    };
  }
  const data = await response.json().catch(() => ({}));
  return { ok: true, token, repo: data };
}

async function loadRows(env, repo) {
  const result = await env.DB.prepare(
    `SELECT id, pattern, is_negation, order_index, source, updated_at_unix
       FROM agentsam_ignore_pattern
      WHERE repo_full_name = ?
      ORDER BY order_index ASC`,
  ).bind(repo).all().catch(() => ({ results: [] }));
  return result?.results || [];
}

async function getRules(env, scope, repoRaw) {
  const repo = normalizeIgnorePolicyRepo(repoRaw);
  if (!repo) return json({ ok: false, error: 'repo_full_name_required' }, 400);
  const access = await assertExactRepoAccess(env, scope.userId, repo);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  const rows = await loadRows(env, repo);
  return json({
    ok: true,
    repo_full_name: repo,
    patterns: rows.map((row) => ({
      id: row.id,
      pattern: row.pattern,
      is_negation: Number(row.is_negation) === 1 ? 1 : 0,
      order_index: Number(row.order_index) || 0,
      source: row.source || null,
      updated_at_unix: row.updated_at_unix != null ? Number(row.updated_at_unix) : null,
    })),
    text: patternsToText(rows),
    version: await ignorePolicyVersion(rows),
  });
}

async function listRepos(env, scope) {
  const token = await githubToken(env, scope.userId);
  if (!token) return json({ ok: false, error: 'github_oauth_required', repos: [] }, 400);
  const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', {
    headers: githubHeaders(token),
  });
  if (!response.ok) return json({ ok: false, error: 'github_repo_list_failed', repos: [] }, 502);
  const rows = await response.json().catch(() => []);
  const repos = Array.isArray(rows) ? rows.map((repo) => ({
    id: repo?.id,
    full_name: repo?.full_name,
    private: Boolean(repo?.private),
    default_branch: repo?.default_branch || null,
    permissions: repo?.permissions || null,
  })).filter((repo) => normalizeIgnorePolicyRepo(repo.full_name)) : [];
  return json({ ok: true, repos });
}

async function putRules(request, env, identity, scope) {
  const body = await request.json().catch(() => null);
  const repo = normalizeIgnorePolicyRepo(body?.repo_full_name);
  if (!repo) return json({ ok: false, error: 'repo_full_name_required' }, 400);
  const access = await assertExactRepoAccess(env, scope.userId, repo);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);

  let entries;
  try {
    if (typeof body?.text === 'string') entries = parseIndexRulesText(body.text);
    else if (Array.isArray(body?.patterns)) entries = parseIndexRulesText(body.patterns.map((row) => `${Number(row?.is_negation) === 1 ? '!' : ''}${String(row?.pattern || '')}`).join('\n'));
    else return json({ ok: false, error: 'text_or_patterns_required' }, 400);
  } catch (error) {
    return json({ ok: false, error: error?.message || 'index_rules_invalid' }, 400);
  }
  if (!entries.length) return json({ ok: false, error: IGNORE_POLICY_EMPTY, message: 'At least one rule is required.' }, 400);

  const current = await loadRows(env, repo);
  const currentVersion = await ignorePolicyVersion(current);
  const expectedVersion = String(body?.if_version || '').trim();
  if (expectedVersion && expectedVersion !== currentVersion) {
    return json({ ok: false, error: 'index_rules_conflict', current_version: currentVersion }, 409);
  }

  const personId = String(identity?.user?.personId || '').trim();
  if (!personId) return json({ ok: false, error: 'person_uuid_required' }, 409);

  const statements = [env.DB.prepare('DELETE FROM agentsam_ignore_pattern WHERE repo_full_name = ?').bind(repo)];
  for (const entry of entries) {
    statements.push(env.DB.prepare(
      `INSERT INTO agentsam_ignore_pattern
         (id, repo_full_name, user_id, person_uuid, pattern, is_negation, order_index, source,
          created_at_unix, updated_at_unix)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'settings_ui', unixepoch(), unixepoch())`,
    ).bind(
      `igp_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      repo,
      scope.userId,
      personId,
      entry.pattern,
      entry.is_negation,
      entry.order_index,
    ));
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    return json({ ok: false, error: error?.message || 'ignore_pattern_save_failed' }, 500);
  }
  return getRules(env, scope, repo);
}

async function previewRules(request, env, scope) {
  const body = await request.json().catch(() => null);
  const repo = normalizeIgnorePolicyRepo(body?.repo_full_name);
  const path = String(body?.path || '').trim();
  if (!repo) return json({ ok: false, error: 'repo_full_name_required' }, 400);
  if (!path || path.length > MAX_PREVIEW_PATH) return json({ ok: false, error: 'path_invalid' }, 400);
  const access = await assertExactRepoAccess(env, scope.userId, repo);
  if (!access.ok) return json({ ok: false, error: access.error }, access.status);
  try {
    const policy = await loadRepoIgnorePolicy(env.DB, repo);
    return json({ ok: true, repo_full_name: repo, path, ...applyRepoIgnorePolicy(policy, path) });
  } catch (error) {
    const code = error?.message || String(error);
    return json({ ok: false, error: code }, code === IGNORE_POLICY_EMPTY ? 404 : 400);
  }
}

export async function handleIndexRulesRequest(request, env, identity, scope) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  if (path === '/api/settings/indexrules/repos' && request.method === 'GET') return listRepos(env, scope);
  if (path === '/api/settings/indexrules' && request.method === 'GET') return getRules(env, scope, url.searchParams.get('repo'));
  if (path === '/api/settings/indexrules' && request.method === 'PUT') return putRules(request, env, identity, scope);
  if (path === '/api/settings/indexrules/preview' && request.method === 'POST') return previewRules(request, env, scope);
  return null;
}
