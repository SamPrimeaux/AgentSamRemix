/**
 * Unified Cmd+K search — D1 + Supabase pgvector (Hyperdrive).
 */
import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../../backend/identity/index.js'; import { fetchAuthUserTenantId, platformTenantIdFromEnv } from '../../backend/identity/users/tenant.js';
import { normalizeSourceFilters } from '../core/unified-source-filters.js';
import { resolveGitHubToken } from '../../backend/http/agentsam/routes/git-runtime.js';
import { fetchWorkspaceGithubRepo } from '../../backend/http/agentsam/routes/git-status-runtime.js';
import { logSemanticSearch } from '../../backend/http/agentsam/routes/memory-legacy.js';

/** @param {any} authUser */
function resolveSearchAnalyticsWorkspaceId(authUser) {
  const ws =
    authUser?.active_workspace_id ??
    authUser?.workspace_id ??
    authUser?.activeWorkspaceId ??
    null;
  return ws != null && String(ws).trim() !== '' ? String(ws).trim() : null;
}

/** @param {any} env @param {any} authUser @param {string|null} userId */
async function resolveSearchAnalyticsTenantId(env, authUser, userId) {
  const fromUser =
    authUser?.tenant_id != null && String(authUser.tenant_id).trim() !== ''
      ? String(authUser.tenant_id).trim()
      : null;
  if (fromUser) return fromUser;
  if (userId) {
    const tid = await fetchAuthUserTenantId(env, userId);
    if (tid && String(tid).trim()) return String(tid).trim();
  }
  return platformTenantIdFromEnv(env) || null;
}

/** @param {any} env */
function ragDocumentsProjectId(env) {
  return typeof env?.RAG_DOCUMENTS_PROJECT_ID === 'string' && env.RAG_DOCUMENTS_PROJECT_ID.trim()
    ? env.RAG_DOCUMENTS_PROJECT_ID.trim()
    : null;
}

/** Vector/doc facets only — workspace/branch/repo are appended separately. */
function documentFacetIdsOnly(facetIds) {
  return facetIds.filter((f) => f !== 'workspace' && f !== 'branch' && f !== 'repo');
}

/**
 * Map Cmd+K source facets → agentsam semantic lanes (1536). Legacy public.documents is retired.
 * @param {string[]} facetIds
 * @returns {string[]}
 */
function facetsToSemanticLanes(facetIds) {
  const ids = Array.isArray(facetIds) ? facetIds : [];
  /** @type {string[]} */
  const lanes = [];
  for (const f of ids) {
    if (f === 'codebase' || f === 'scripts') lanes.push('code');
    else if (f === 'docs' || f === 'rules' || f === 'guardrails') lanes.push('docs');
    else if (f === 'memory') lanes.push('memory');
  }
  if (!lanes.length) {
    return ['code', 'docs', 'memory'];
  }
  return [...new Set(lanes)];
}

/**
 * Cmd+K vector hits via agentsam lanes (Vectorize / pgvector) — not public.documents.
 * @param {any} env
 * @param {string} query
 * @param {number} limit
 * @param {{
 *   sourceFilters?: unknown,
 *   matchThreshold?: number,
 *   tenantId?: string | null,
 *   workspaceId?: string | null,
 *   projectId?: string | null,
 *   sessionId?: string | null,
 *   queryPreview?: string,
 * }} [opts]
 */
async function searchDocumentsVector(env, query, limit, opts = {}) {
  const q = String(query || '').trim();
  const workspaceId = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  if (!q || !workspaceId) return [];

  const lim = Math.min(Math.max(1, limit), 50);
  const facetIds = normalizeSourceFilters(opts.sourceFilters);
  const lanes = facetsToSemanticLanes(documentFacetIdsOnly(facetIds));
  const perLane = Math.min(lim, Math.max(3, Math.ceil(lim / Math.max(1, lanes.length)) + 1));

  const t0 = Date.now();
  /** @type {{ type: string, id: string, title: string, subtitle?: string, score: number, url?: string | null, source?: string }[]} */
  const out = [];
  const seen = new Set();

  try {
    const { dispatchSemanticRetrieval } = await import('../../backend/agentsam/rag/semantic-retrieval.js');
    const parts = await Promise.all(
      lanes.map((lane) =>
        dispatchSemanticRetrieval(env, {
          lane,
          query: q,
          workspace_id: workspaceId,
          top_k: perLane,
          bypass_cache: true,
        }),
      ),
    );
    for (const part of parts) {
      if (!part || part.ok === false) continue;
      const results = Array.isArray(part.results) ? part.results : [];
      for (const hit of results) {
        const id = String(hit.id || hit.source_ref || hit.file_path || '').trim();
        const title =
          String(hit.title || hit.file_path || hit.source_ref || 'Match').trim() || 'Match';
        const key = `${part.lane}:${id || title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const preview = String(hit.content || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        const src = String(hit.file_path || hit.source_ref || part.lane || '').trim();
        out.push({
          type: 'knowledge',
          id: id || key,
          title,
          subtitle: [src || null, preview || null].filter(Boolean).join(' · ') || undefined,
          score: Number(hit.score) || 0,
          url: src && /^https?:/i.test(src) ? src : null,
          source: part.lane || src || undefined,
        });
      }
    }
  } catch (e) {
    console.warn('[unified-search] agentsam semantic', e?.message ?? e);
    return [];
  }

  out.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const sliced = out.slice(0, lim);

  const scores = sliced.map((r) => r.score).filter((s) => Number.isFinite(s));
  const topSim = scores.length ? Math.max(...scores) : null;
  const avgSim = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const sourcesDistinct = [...new Set(sliced.map((r) => r.source).filter(Boolean))];

  await logSemanticSearch(env, {
    searchFn: 'unified_search.agentsam_lanes',
    tenantId: opts.tenantId ?? null,
    workspaceId,
    sessionId: opts.sessionId ?? null,
    queryPreview: opts.queryPreview ?? q,
    matchThreshold: Number(opts.matchThreshold) || 0.45,
    matchCountRequested: lim,
    matchCountReturned: sliced.length,
    topSimilarity: topSim,
    avgSimilarity: avgSim,
    sourcesHit: sourcesDistinct,
    latencyMs: Date.now() - t0,
    metadata: {
      lanes,
      filled_by: 'dispatchSemanticRetrieval',
      project_id: opts.projectId ?? null,
    },
  });

  return sliced.map(({ source: _s, ...rest }) => rest);
}

async function appendStructuralFacetResults(env, authUser, merged, rawQ, facetIds, request, url) {
  const qPat = `%${rawQ}%`;

  if (facetIds.includes('workspace') && env.DB) {
    try {
      const { listAccessibleWorkspaces } = await import('../../backend/identity/workspace/access.js');
      const all = await listAccessibleWorkspaces(env.DB, env, authUser, { limit: 100 });
      const qLower = rawQ.toLowerCase();
      const results = (all || []).filter((w) => {
        const dn = String(w.display_name || w.name || '').toLowerCase();
        const slug = String(w.slug || w.handle || '').toLowerCase();
        return dn.includes(qLower) || slug.includes(qLower);
      }).slice(0, 20);
      for (const w of results || []) {
        merged.push({
          type: 'workspace',
          id: String(w.id ?? ''),
          title: String(w.display_name || w.slug || w.id || 'Workspace'),
          subtitle: String(w.slug || ''),
          score: 0.86,
          display_name: w.display_name,
          slug: w.slug,
          status: w.status,
          github_repo: w.github_repo,
          member_role: w.member_role,
        });
      }
    } catch (e) {
      console.warn('[unified-search] workspace facet', e?.message ?? e);
    }
  }

  if (facetIds.includes('branch')) {
    const { token, error } = await resolveGitHubToken(authUser, env);
    if (!error && token && request && url) {
      try {
        const repoCtx = await fetchWorkspaceGithubRepo(env, authUser, request, url);
        if (!repoCtx.error && repoCtx.repo) {
          const ghRes = await fetch(
            `https://api.github.com/repos/${repoCtx.repo}/branches?per_page=100`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'inneranimalmedia-agent/1.0',
              },
            },
          );
          if (ghRes.ok) {
            const branches = await ghRes.json();
            const q = rawQ.toLowerCase();
            for (const b of branches) {
              const name = String(b?.name ?? '');
              if (!q || name.toLowerCase().includes(q)) {
                const shaFull = b?.commit?.sha != null ? String(b.commit.sha) : '';
                merged.push({
                  type: 'branch',
                  id: name,
                  ref: name,
                  sha: shaFull.slice(0, 7),
                  protected: Boolean(b?.protected),
                  repo: String(repoCtx.repo),
                  title: name,
                  score: 0.85,
                });
              }
            }
          }
        }
      } catch (e) {
        console.warn('[unified-search] branch facet', e?.message ?? e);
      }
    }
  }

  if (facetIds.includes('repo')) {
    const { token, error } = await resolveGitHubToken(authUser, env);
    if (!error && token) {
      try {
        const ghRes = await fetch(
          'https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'inneranimalmedia-agent/1.0',
            },
          },
        );
        if (ghRes.ok) {
          const repos = await ghRes.json();
          const q = rawQ.toLowerCase();
          for (const r of repos) {
            const full = String(r.full_name ?? '');
            if (
              !q ||
              full.toLowerCase().includes(q) ||
              String(r.name ?? '')
                .toLowerCase()
                .includes(q)
            ) {
              merged.push({
                type: 'repo',
                id: full,
                full_name: full,
                name: String(r.name ?? ''),
                owner: String(r.owner?.login ?? ''),
                private: Boolean(r.private),
                pushed_at: String(r.pushed_at ?? ''),
                default_branch: String(r.default_branch ?? 'main'),
                linked_worker: null,
                title: String(r.name ?? full),
                score: 0.84,
              });
            }
          }
        }
      } catch (e) {
        console.warn('[unified-search] repo facet', e?.message ?? e);
      }
    }
  }
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 */
export async function handleUnifiedSearchApi(request, url, env) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();

  const authUser = await getAuthUser(request, env);
  if (!authUser) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  const userId = authUser.id ? String(authUser.id) : null;
  const workspaceId = resolveSearchAnalyticsWorkspaceId(authUser);
  const tenantId = await resolveSearchAnalyticsTenantId(env, authUser, userId);

  if (method === 'GET' && pathLower === '/api/unified-search/recent') {
    if (!env.DB || !tenantId || !userId) return jsonResponse({ items: [] });
    try {
      const { results } = await env.DB.prepare(
        `SELECT query, search_type, clicked_result_id, created_at
         FROM ai_search_analytics
         WHERE user_id = ?
           AND tenant_id = ?
           AND COALESCE(workspace_id, '') = COALESCE(?, '')
         ORDER BY created_at DESC
         LIMIT 10`,
      )
        .bind(userId, tenantId, workspaceId)
        .all();
      const items = (results || []).map((r) => ({
        query: r.query,
        result_kind: r.search_type,
        opened_id: r.clicked_result_id,
        search_type: r.search_type,
        clicked_result_id: r.clicked_result_id,
      }));
      return jsonResponse({ items });
    } catch (e) {
      console.warn('[unified-search/recent]', e?.message ?? e);
      return jsonResponse({ items: [] });
    }
  }

  if (method === 'POST' && pathLower === '/api/unified-search/track') {
    if (!env.DB) return jsonResponse({ ok: false }, 503);
    if (!tenantId || !userId) return jsonResponse({ ok: false, error: 'tenant_or_user_required' }, 400);
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const query = String(body.query || '').slice(0, 500);
    const searchType =
      body.search_type != null
        ? String(body.search_type).slice(0, 64)
        : body.result_kind != null
          ? String(body.result_kind).slice(0, 64)
          : 'palette_open';
    const clickedResultId =
      body.clicked_result_id != null
        ? String(body.clicked_result_id).slice(0, 500)
        : body.opened_id != null
          ? String(body.opened_id).slice(0, 500)
          : null;
    const resultsCount =
      body.results_count != null && Number.isFinite(Number(body.results_count))
        ? Math.max(0, Math.floor(Number(body.results_count)))
        : 0;
    const latencyMs =
      body.latency_ms != null && Number.isFinite(Number(body.latency_ms))
        ? Math.max(0, Math.floor(Number(body.latency_ms)))
        : null;
    const source =
      body.source != null && String(body.source).trim() !== ''
        ? String(body.source).trim().slice(0, 64)
        : 'dashboard';
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO ai_search_analytics (
           id, tenant_id, workspace_id, user_id, query,
           results_count, clicked_result_id, search_type, latency_ms, source, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
      )
        .bind(
          id,
          tenantId,
          workspaceId,
          userId,
          query,
          resultsCount,
          clickedResultId,
          searchType,
          latencyMs,
          source,
        )
        .run();
    } catch (e) {
      console.warn('[unified-search/track]', e?.message ?? e);
      return jsonResponse({ ok: false }, 500);
    }
    return jsonResponse({ ok: true });
  }

  if (method === 'POST' && pathLower === '/api/unified-search') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const limit = Math.min(Math.max(1, Number(body.limit) || 22), 50);
    const sourceFilters = body.source_filters ?? body.sourceFilters ?? [];
    const facetIds = normalizeSourceFilters(sourceFilters);
    const rawQ = String(body.query || '').trim();
    const hasStructuralFacet = facetIds.some(
      (f) => f === 'workspace' || f === 'branch' || f === 'repo',
    );
    if (rawQ.length < 2 && !hasStructuralFacet) {
      return jsonResponse({ results: [] });
    }
    const qLow = `%${String(rawQ).toLowerCase()}%`;
    const matchThreshold = Number(body.match_threshold ?? body.matchThreshold);
    const docFacetsOnly = documentFacetIdsOnly(facetIds);

    if (!env.DB) {
      return jsonResponse({ results: [], warning: 'DB not configured' });
    }

    if (rawQ.length < 2 && hasStructuralFacet) {
      /** @type {{ type: string, id: string, title: string, subtitle?: string, score: number, url?: string|null, sql_text?: string }[]} */
      const mergedOnly = [];
      await appendStructuralFacetResults(env, authUser, mergedOnly, rawQ, facetIds, request, url);
      mergedOnly.sort((a, b) => b.score - a.score);
      return jsonResponse({ results: mergedOnly.slice(0, limit) });
    }

    let tenantId =
      authUser.tenant_id != null && String(authUser.tenant_id).trim()
        ? String(authUser.tenant_id).trim()
        : null;
    if (!tenantId && typeof env?.TENANT_ID === 'string' && env.TENANT_ID.trim()) {
      tenantId = env.TENANT_ID.trim();
    }
    let workspaceId =
      authUser.active_workspace_id != null && String(authUser.active_workspace_id).trim()
        ? String(authUser.active_workspace_id).trim()
        : null;
    if (!workspaceId && typeof env?.WORKSPACE_ID === 'string' && env.WORKSPACE_ID.trim()) {
      workspaceId = env.WORKSPACE_ID.trim();
    }
    const projectId = ragDocumentsProjectId(env);

    const [
      tableRows,
      cmdRows,
      todoRows,
      planRows,
      toolRows,
      docRows,
    ] = await Promise.all([
      env.DB.prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND lower(name) LIKE ?
         LIMIT 15`,
      )
        .bind(qLow)
        .all()
        .then((r) => r.results || [])
        .catch(() => []),
      env.DB.prepare(
        `SELECT id, user_input, normalized_intent, output_text
         FROM agentsam_command_run
         WHERE lower(user_input) LIKE ? OR lower(COALESCE(normalized_intent,'')) LIKE ?
            OR lower(COALESCE(output_text,'')) LIKE ?
         ORDER BY rowid DESC
         LIMIT 10`,
      )
        .bind(qLow, qLow, qLow)
        .all()
        .then((r) => r.results || [])
        .catch(() => []),
      env.DB.prepare(
        `SELECT id, title, description, status
         FROM agentsam_todo
         WHERE status IN ('todo','in_progress','blocked')
           AND (lower(title) LIKE ? OR lower(COALESCE(description,'')) LIKE ?)
         ORDER BY updated_at DESC
         LIMIT 10`,
      )
        .bind(qLow, qLow)
        .all()
        .then((r) => r.results || [])
        .catch(() => []),
      env.DB.prepare(
        `SELECT id, title, status FROM agentsam_plans
         WHERE lower(title) LIKE ?
         ORDER BY plan_date DESC
         LIMIT 10`,
      )
        .bind(qLow)
        .all()
        .then((r) => r.results || [])
        .catch(() => []),
      env.DB.prepare(
        `SELECT id, COALESCE(tool_name, tool_key) AS tool_name, COALESCE(description,'') AS description
         FROM agentsam_tools
         WHERE lower(COALESCE(tool_name, tool_key)) LIKE ? OR lower(COALESCE(description,'')) LIKE ?
         LIMIT 10`,
      )
        .bind(qLow, qLow)
        .all()
        .then((r) => r.results || [])
        .catch(() => []),
      searchDocumentsVector(env, rawQ, Math.min(limit, 8), {
        sourceFilters: docFacetsOnly,
        matchThreshold,
        tenantId,
        workspaceId,
        projectId,
        sessionId: authUser.session_id ?? null,
        queryPreview: rawQ,
      }),
    ]);

    /** @type {{ type: string, id: string, title: string, subtitle?: string, score: number, url?: string|null, sql_text?: string }[]} */
    const merged = [];

    for (const t of tableRows) {
      const name = String(t.name || '');
      const nm = name.toLowerCase();
      const hit = rawQ.toLowerCase();
      const score = nm.includes(hit) ? 0.92 : 0.78;
      merged.push({
        type: 'table',
        id: name,
        title: name,
        subtitle: 'D1 table',
        score,
      });
    }

    for (const c of cmdRows) {
      const id = String(c.id || '');
      const ui = String(c.user_input || '').slice(0, 200);
      merged.push({
        type: 'query',
        id,
        title: ui || 'Command run',
        subtitle: c.normalized_intent ? String(c.normalized_intent).slice(0, 120) : undefined,
        sql_text: ui,
        score: 0.74,
      });
    }

    for (const td of todoRows) {
      merged.push({
        type: 'knowledge',
        id: String(td.id || ''),
        title: String(td.title || 'Todo'),
        subtitle: td.status ? `todo · ${td.status}` : 'todo',
        score: 0.73,
      });
    }

    for (const p of planRows) {
      merged.push({
        type: 'knowledge',
        id: String(p.id || ''),
        title: String(p.title || 'Plan'),
        subtitle: p.status ? `plan · ${p.status}` : 'plan',
        score: 0.71,
      });
    }

    for (const tl of toolRows) {
      merged.push({
        type: 'knowledge',
        id: String(tl.id || tl.tool_name || ''),
        title: String(tl.tool_name || 'tool'),
        subtitle: String(tl.description || '').slice(0, 160) || 'MCP tool',
        score: 0.79,
      });
    }

    for (const d of docRows) {
      merged.push({
        type: 'knowledge',
        id: d.id,
        title: d.title,
        subtitle: d.subtitle,
        score: typeof d.score === 'number' ? d.score : 0.65,
        url: d.url ?? null,
      });
    }

    await appendStructuralFacetResults(env, authUser, merged, rawQ, facetIds, request, url);

    merged.sort((a, b) => b.score - a.score);
    const results = merged.slice(0, limit);

    return jsonResponse({ results });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
