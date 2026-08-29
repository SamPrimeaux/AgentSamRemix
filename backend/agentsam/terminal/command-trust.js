// guard-dup-allow: backend command peel; legacy command callers migrate separately.
/** Shell-command trust authority: policy prefixes + exact per-user grants. */
export const DEFAULT_TRUSTED_SHELL_PREFIXES = Object.freeze([
  'git ', 'npm run ', 'npx wrangler ', 'python3 scripts/', 'python scripts/',
  'node scripts/', 'bash scripts/', './scripts/', 'jq ', 'grep ', 'cd ', 'curl ',
]);

export const COMMAND_ALLOWLIST_SOURCES = Object.freeze({
  MODAL_ALWAYS_RUN: 'modal_always_run',
  SETTINGS_MANUAL: 'settings_manual',
  MIGRATION_ARCHIVE: 'migration_archive',
});

export function parseTrustedShellPrefixesJson(raw) {
  if (raw == null || raw === '') return [...DEFAULT_TRUSTED_SHELL_PREFIXES];
  if (Array.isArray(raw)) return raw.map((p) => String(p || '').trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(String(raw).trim());
    if (!Array.isArray(parsed)) return [...DEFAULT_TRUSTED_SHELL_PREFIXES];
    const out = parsed.map((p) => String(p || '').trim()).filter(Boolean);
    return out.length ? out : [...DEFAULT_TRUSTED_SHELL_PREFIXES];
  } catch {
    return [...DEFAULT_TRUSTED_SHELL_PREFIXES];
  }
}

export function commandMatchesTrustedPrefix(command, prefixes) {
  const cmd = String(command || '').trim();
  if (!cmd || !Array.isArray(prefixes)) return false;
  return prefixes.some((raw) => {
    const pref = String(raw || '').trim();
    if (!pref) return false;
    const bare = pref.endsWith(' ') ? pref.slice(0, -1) : pref;
    return cmd === bare || cmd.startsWith(pref);
  });
}

export async function hashCommandPreview(command) {
  const cmd = String(command || '').trim();
  if (!cmd) throw new Error('command_required_for_hash');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cmd));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadMergedTrustedShellPrefixes(env, userId, workspaceId = '') {
  if (!env?.DB || !userId) return [...DEFAULT_TRUSTED_SHELL_PREFIXES];
  const rows = await env.DB.prepare(
    `SELECT workspace_id, trusted_shell_prefixes_json
       FROM agentsam_user_policy
      WHERE user_id = ? AND workspace_id IN ('', ?)
      ORDER BY CASE WHEN workspace_id = '' THEN 0 ELSE 1 END`,
  ).bind(String(userId).trim(), String(workspaceId || '').trim()).all().catch(() => ({ results: [] }));
  const merged = [];
  const seen = new Set();
  for (const row of rows?.results || []) {
    for (const prefix of parseTrustedShellPrefixesJson(row?.trusted_shell_prefixes_json)) {
      if (!seen.has(prefix)) { seen.add(prefix); merged.push(prefix); }
    }
  }
  return merged.length ? merged : [...DEFAULT_TRUSTED_SHELL_PREFIXES];
}

export async function isShellCommandTrusted(env, opts = {}) {
  const uid = String(opts.userId || '').trim();
  const cmd = String(opts.command || '').trim();
  const ws = String(opts.workspaceId || '').trim();
  if (!env?.DB || !uid || !cmd) return false;
  const prefixes = await loadMergedTrustedShellPrefixes(env, uid, ws);
  if (commandMatchesTrustedPrefix(cmd, prefixes)) return true;
  const hash = await hashCommandPreview(cmd).catch(() => null);
  if (!hash) return false;
  const sql = `SELECT 1 AS ok FROM agentsam_command_allowlist
    WHERE user_id = ? AND workspace_id = ? AND match_kind = 'exact' AND command_hash = ? LIMIT 1`;
  if ((await env.DB.prepare(sql).bind(uid, ws, hash).first().catch(() => null))?.ok) return true;
  return Boolean(ws && (await env.DB.prepare(sql).bind(uid, '', hash).first().catch(() => null))?.ok);
}

export async function upsertCommandAllowlistExact(env, opts = {}) {
  const uid = String(opts.userId || '').trim();
  const cmd = String(opts.command || '').trim();
  const ws = String(opts.workspaceId || '').trim();
  const source = String(opts.source || COMMAND_ALLOWLIST_SOURCES.SETTINGS_MANUAL).trim();
  if (!env?.DB || !uid || !cmd) throw new Error('allowlist_insert_invalid');
  const commandHash = await hashCommandPreview(cmd);
  const id = `acl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO agentsam_command_allowlist
       (id, user_id, workspace_id, command, command_hash, match_kind, source, created_at, created_at_unix)
     VALUES (?, ?, ?, ?, ?, 'exact', ?, datetime('now'), ?)
     ON CONFLICT(user_id, workspace_id, command_hash) DO UPDATE SET
       command = excluded.command, source = excluded.source, created_at_unix = excluded.created_at_unix`,
  ).bind(id, uid, ws, cmd, commandHash, source, now).run();
  return { id, commandHash };
}

export function defaultTrustedShellPrefixesJson() {
  return JSON.stringify([...DEFAULT_TRUSTED_SHELL_PREFIXES]);
}

export function shouldMigrateArchiveCommandAsExact(command) {
  const cmd = String(command || '').trim();
  return Boolean(cmd && !cmd.startsWith('API_CALL:') && !(cmd.includes('{') && cmd.includes('}'))
    && !commandMatchesTrustedPrefix(cmd, DEFAULT_TRUSTED_SHELL_PREFIXES));
}
