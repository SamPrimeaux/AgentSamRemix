function pathMatchesIgnorePattern(filePath, patternRaw) {
  const pathStr = String(filePath || '');
  const pattern = String(patternRaw || '');
  if (!pattern) return false;
  if (pattern.includes('*') || pattern.includes('?')) {
    try {
      const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      return new RegExp(`^${esc}$`).test(pathStr);
    } catch {
      return false;
    }
  }
  return pathStr === pattern || pathStr.includes(pattern) || pathStr.endsWith(pattern);
}

export async function assertFetchDomainAllowed(env, userId, workspaceId, targetUrl) {
  const uid = userId != null ? String(userId).trim() : '';
  const ws = workspaceId != null ? String(workspaceId).trim() : '';
  if (!uid || !ws || !env?.DB || !targetUrl) return { ok: true };
  let hostname = '';
  try {
    hostname = new URL(String(targetUrl)).hostname.toLowerCase();
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT host FROM agentsam_fetch_domain_allowlist WHERE user_id = ? AND workspace_id = ?`,
    )
      .bind(uid, ws)
      .all();
    const rows = results || [];
    if (!rows.length) return { ok: true };
    const ok = rows.some((r) => String(r.host || '').toLowerCase() === hostname);
    if (!ok) return { ok: false, error: 'Domain not in your fetch allowlist' };
  } catch (e) {
    console.warn('[assertFetchDomainAllowed]', e?.message ?? e);
    return { ok: true };
  }
  return { ok: true };
}

export async function assertPathAllowedByIgnorePatterns(env, userId, repoFullName, filePath) {
  const uid = userId != null ? String(userId).trim() : '';
  const repo = repoFullName != null ? String(repoFullName).trim() : '';
  if (!uid || !repo || !repo.includes('/') || !env?.DB) return { ok: true };
  try {
    const { results } = await env.DB.prepare(
      `SELECT pattern, is_negation FROM agentsam_ignore_pattern
       WHERE user_id = ? AND repo_full_name = ?
       ORDER BY order_index ASC`,
    )
      .bind(uid, repo)
      .all();
    const rows = results || [];
    if (!rows.length) return { ok: true };
    let denied = false;
    for (const r of rows) {
      if (!pathMatchesIgnorePattern(filePath, r.pattern)) continue;
      if (Number(r.is_negation) === 1) denied = false;
      else denied = true;
    }
    if (denied) return { ok: false, error: 'Path blocked by ignore patterns' };
  } catch (e) {
    console.warn('[assertPathAllowedByIgnorePatterns]', e?.message ?? e);
    return { ok: true };
  }
  return { ok: true };
}

export async function assertBrowserOriginTrusted(env, opts) {
  const { userId, workspaceId, origin } = opts || {};
  if (!userId || !origin || !env?.DB) return;

  let parsedOrigin;
  try {
    const raw = String(origin);
    parsedOrigin = new URL(raw.startsWith('http') ? raw : `https://${raw}`).origin;
  } catch {
    throw new Error('Browser origin blocked: invalid URL');
  }

  const rows = await env.DB.prepare(
    `
      SELECT origin, trust_scope
      FROM agentsam_browser_trusted_origin
      WHERE user_id = ?
        AND (
          workspace_id = ?
          OR workspace_id IS NULL
          OR TRIM(COALESCE(workspace_id, '')) = ''
        )
      LIMIT 100
    `,
  )
    .bind(userId, workspaceId != null ? String(workspaceId).trim() : '')
    .all()
    .catch(() => ({ results: [] }));

  const trusted = rows.results || [];
  if (trusted.length === 0) return;

  const candidates = new Set([parsedOrigin.toLowerCase()]);
  try {
    const host = new URL(parsedOrigin).hostname.toLowerCase();
    candidates.add(host);
    candidates.add(`https://${host}`);
  } catch {
    /* keep origin only */
  }

  const match = trusted.some((r) => {
    const o = String(r?.origin || '')
      .trim()
      .toLowerCase();
    if (!o) return false;
    if (candidates.has(o)) return true;
    try {
      const u = new URL(o.startsWith('http') ? o : `https://${o}`);
      return candidates.has(u.origin.toLowerCase()) || candidates.has(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  });

  if (!match) {
    throw new Error(
      `Browser origin not trusted: ${parsedOrigin}. ` +
        'Add it to your trusted origins in settings.',
    );
  }
}
