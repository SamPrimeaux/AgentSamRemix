/**
 * Pure path policy for MCP OAuth login-challenge resume URLs (no HTTP/KV).
 * Shared by oauth finalize redirect helpers and mcp-oauth-login-challenge routes.
 */
export function isMcpOAuthLoginChallengeResumePath(raw) {
  const s = String(raw || '').trim();
  if (!s.startsWith('/api/oauth/login-challenge/resume')) return false;
  try {
    const q = s.includes('?') ? s.slice(s.indexOf('?')) : '';
    const params = new URLSearchParams(q.startsWith('?') ? q.slice(1) : q);
    const challenge = String(params.get('challenge') || '').trim();
    return challenge.startsWith('olc_');
  } catch {
    return false;
  }
}
