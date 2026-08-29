/**
 * D1 mcp_workspace_tokens — PTY cwd isolation and manual token provisioning.
 */

/**
 * Require an active workspace token row before opening PTY. Returns repo_path for cwd (may be null).
 * @returns {Promise<{ ok: true, repo_path: string | null } | { ok: false }>}
 */
export async function assertWorkspaceTokenForPty(env, workspaceId, tenantId) {
  const wid = String(workspaceId || "").trim();
  const tid = String(tenantId || "").trim();
  if (!env?.DB || !wid || !tid) {
    return { ok: false };
  }
  try {
    const row = await env.DB.prepare(
      `SELECT repo_path FROM mcp_workspace_tokens
       WHERE workspace_id = ? AND tenant_id = ? AND is_active = 1
       AND (expires_at IS NULL OR expires_at > unixepoch())
       ORDER BY CASE
         WHEN repo_path IS NOT NULL AND TRIM(repo_path) != '' THEN 0
         ELSE 1
       END
       LIMIT 1`,
    )
      .bind(wid, tid)
      .first();
    if (!row) return { ok: false };
    const rp = row.repo_path != null && String(row.repo_path).trim() !== "" ? String(row.repo_path).trim() : null;
    return { ok: true, repo_path: rp };
  } catch (e) {
    console.warn("[mcp_workspace_tokens]", e?.message ?? e);
    return { ok: false };
  }
}

/**
 * Provision a new workspace token (manual / admin). Does not run on terminal connect.
 * @returns {Promise<{ rawToken: string, workspaceId: string }>}
 */
export async function provisionWorkspaceToken(env, workspaceId, tenantId, repoPath, label = "provisioned") {
  const wid = String(workspaceId || "").trim();
  const tid = String(tenantId || "").trim();
  if (!env?.DB || !wid || !tid) {
    throw new Error("provisionWorkspaceToken: DB, workspace_id, and tenant_id required");
  }
  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = [...rawBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashBuf = await crypto.subtle.digest("SHA-256", rawBytes);
  const token_hash = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const rp = repoPath != null && String(repoPath).trim() !== "" ? String(repoPath).trim() : null;
  const lb = String(label || "provisioned").trim() || "provisioned";

  await env.DB.prepare(
    `INSERT OR IGNORE INTO mcp_workspace_tokens
      (workspace_id, tenant_id, label, token_hash, repo_path, is_active)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(token_hash) DO NOTHING`,
  )
    .bind(wid, tid, lb, token_hash, rp)
    .run();

  return { rawToken, workspaceId: wid };
}
