import { computeTerminalSessionAuthTokenHash, mintSessionToken, sha256HexUtf8 } from './session-auth.js';
import { resolveTerminalCwd } from './pty-workspace-paths.js';

export async function upsertTerminalSessionRow(session, sessionId, opts) {
    const { tenantId, userId, workspaceId, personUuid } = opts;
    if (!session.env?.DB || !sessionId) return;
    const tid = String(tenantId || "").trim();
    const uid = String(userId || "").trim();
    const wid = String(workspaceId || "").trim();
    if (!tid || !uid || !wid) return;
    const now = Math.floor(Date.now() / 1000);
    const pid = personUuid != null && String(personUuid).trim() !== "" ? String(personUuid).trim() : null;
    let authHash = "";
    let _mintedToken = null; // rawToken for token_mint connections
    try {
      // conn resolved below — reorder: get conn first, then decide hash strategy
      authHash = await computeTerminalSessionAuthTokenHash(session.env, sessionId);
    } catch (_) {
      authHash = "";
    }
    let conn = null;
    try {
      const sel = await session.selectTerminalConnection({
        userId: uid,
        workspaceId: wid,
        tenantId: tid,
        connectionId: session.requestedConnectionId || null,
        targetType: session.requestedTargetType || null,
        healthAware: true,
      });
      conn = sel.connection;
      session.selectedTerminalConnection = conn;
      session.selectedTargetType = String(conn?.target_type || session.requestedTargetType || "").trim();
    } catch (_) {}
    const shellVal = String(session.terminalShellOverride || conn?.shell || "/bin/bash").trim() || "/bin/bash";
    const connectionId = conn?.id != null && String(conn.id).trim() !== "" ? String(conn.id).trim() : null;
    const cwdResult = await resolveTerminalCwd(session.env, {
      connection: conn,
      tenantId: tid,
      userId: uid,
      workspaceId: wid,
    });
    const cwdVal = cwdResult.cwd || "";
    if (conn?.auth_mode === 'token_mint') {
      const existingMint = session.ptSessionMintedToken != null ? String(session.ptSessionMintedToken).trim() : '';
      if (existingMint) {
        try {
          authHash = await sha256HexUtf8(existingMint);
          _mintedToken = existingMint;
        } catch (_) {}
      } else {
        try {
          const { rawToken, tokenHash } = await mintSessionToken();
          authHash = tokenHash;
          _mintedToken = rawToken;
          session.ptSessionMintedToken = rawToken;
        } catch (_) {}
      }
    }
    const agentSessionId = session.state?.id?.toString?.() || session.ctx?.id?.toString?.() || null;
    try {
      await session.env.DB.prepare(
        `INSERT INTO terminal_sessions (id, tenant_id, user_id, workspace_id, person_uuid, tunnel_url, cols, rows, shell, cwd, status, auth_token_hash, prefs_json, created_at, updated_at, connection_id, agent_session_id)
         VALUES (?, ?, ?, ?, ?, '', 220, 50, ?, ?, 'active', ?, '{}', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tenant_id = excluded.tenant_id,
           user_id = excluded.user_id,
           workspace_id = excluded.workspace_id,
           person_uuid = excluded.person_uuid,
           auth_token_hash = COALESCE(excluded.auth_token_hash, auth_token_hash),
           shell = COALESCE(excluded.shell, shell),
           cwd = COALESCE(NULLIF(excluded.cwd, ''), cwd),
           connection_id = COALESCE(excluded.connection_id, connection_id),
           agent_session_id = COALESCE(excluded.agent_session_id, agent_session_id),
           status = 'active',
           updated_at = excluded.updated_at`,
      )
        .bind(sessionId, tid, uid, wid, pid, shellVal, cwdVal, authHash || null, now, now, connectionId, agentSessionId)
        .run();
    } catch (e) {
      console.warn("[terminal_sessions upsert]", e?.message);
    }
  }

export async function getOrCreateTerminalSessionId(session) {
    if (session.cachedTerminalSessionId) return session.cachedTerminalSessionId;
    const existing = await session.ctx.storage.get("terminal_session_id");
    if (existing && String(existing).trim()) {
      session.cachedTerminalSessionId = String(existing).trim();
      return session.cachedTerminalSessionId;
    }
    const created = `term_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    session.cachedTerminalSessionId = created;
    await session.ctx.storage.put("terminal_session_id", created);
    return created;
  }
