/**
 * Browser origin trust lookup — agentsam_browser_trusted_origin (D1).
 *
 * IAM allowlist stack (all tables already exist in D1; managed via Settings → Network):
 *   1. agentsam_browser_trusted_origin  — Browser Run / iframe trust + approval modal skip
 *   2. agentsam_fetch_domain_allowlist  — outbound fetch hostname gate (assertFetchDomainAllowed)
 *   3. agentsam_mcp_allowlist           — tool_key execution gate (agent-policy.findMcpAllowlistMatch)
 *
 * Browser Run checks (1) + (2) at the Worker boundary; agent tool dispatch checks (3).
 * Matches full origins, https://host, and bare host rows in (1).
 */

/**
 * @param {string} input
 * @returns {string[]}
 */
export function browserTrustOriginCandidates(input) {
  const raw = String(input || '').trim();
  if (!raw) return [];
  const out = new Set();
  out.add(raw);
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    out.add(u.origin);
    out.add(host);
    out.add(`https://${host}`);
    if (host.startsWith('www.')) out.add(`https://${host.slice(4)}`);
  } catch {
    /* keep raw only */
  }
  return [...out];
}

/**
 * @param {any} env
 * @param {{ userId: string, workspaceId?: string|null, origin: string }} opts
 * @returns {Promise<{ origin: string, trust_scope: string }|null>}
 */
export async function lookupBrowserTrustedOrigin(env, opts) {
  const userId = String(opts?.userId || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  const originInput = String(opts?.origin || '').trim();
  if (!userId || !originInput || !env?.DB) return null;

  const candidates = browserTrustOriginCandidates(originInput);
  if (!candidates.length) return null;

  const placeholders = candidates.map(() => '?').join(', ');
  const sql = `
    SELECT origin, trust_scope
    FROM agentsam_browser_trusted_origin
    WHERE user_id = ?
      AND (
        workspace_id = ?
        OR workspace_id IS NULL
        OR TRIM(COALESCE(workspace_id, '')) = ''
      )
      AND origin IN (${placeholders})
    ORDER BY
      CASE WHEN lower(COALESCE(trust_scope, '')) = 'persistent' THEN 0 ELSE 1 END,
      updated_at DESC
    LIMIT 1
  `;

  try {
    const row = await env.DB.prepare(sql)
      .bind(userId, workspaceId, ...candidates)
      .first();
    if (!row) return null;
    return {
      origin: String(row.origin || ''),
      trust_scope: String(row.trust_scope || 'persistent'),
    };
  } catch {
    return null;
  }
}

/**
 * Fail closed when origin is not on the allowlist (after rows exist for the user).
 * Empty allowlist = no enforcement (legacy open until first trust row is added).
 * @param {any} env
 * @param {{ userId: string, workspaceId?: string|null, origin: string }} opts
 */
export async function assertBrowserTrustedOrigin(env, opts) {
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

  const match = await lookupBrowserTrustedOrigin(env, {
    userId,
    workspaceId: workspaceId != null ? String(workspaceId).trim() : '',
    origin: parsedOrigin,
  });

  if (!match) {
    throw new Error(
      `Browser origin not trusted: ${parsedOrigin}. ` +
        'Add it to your trusted origins in settings.',
    );
  }
}

/**
 * @deprecated Prefer assertBrowserTrustedOrigin — alias kept for call-site clarity.
 */
export const assertBrowserOriginTrusted = assertBrowserTrustedOrigin;

/**
 * Persistent trust in D1 → skip client approval modal and allow browser_run immediately.
 * @param {any} env
 * @param {{ userId: string, workspaceId?: string|null, origin: string }} opts
 */
export async function isBrowserOriginPersistentlyTrusted(env, opts) {
  const row = await lookupBrowserTrustedOrigin(env, opts);
  return row != null && String(row.trust_scope || '').toLowerCase() === 'persistent';
}
