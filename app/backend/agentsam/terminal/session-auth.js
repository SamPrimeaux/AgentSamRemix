/** Deterministic auth helpers for terminal sessions. */
export async function computeTerminalSessionAuthTokenHash(env, sessionId) {
  const sid = String(sessionId || '').trim();
  const pepper = String(
    env?.TERMINAL_SESSION_PEPPER ||
      env?.PTY_AUTH_TOKEN ||
      env?.AGENTSAM_BRIDGE_KEY ||
      'iam-terminal-session-pepper',
  ).trim();
  const payload = `${sid}:${pepper}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mintSessionToken() {
  const raw = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'');
  const hash = await sha256HexUtf8(raw);
  return { rawToken: raw, tokenHash: hash };
}

export async function sha256HexUtf8(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token ?? '')));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
