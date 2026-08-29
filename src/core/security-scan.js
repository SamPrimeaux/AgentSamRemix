/**
 * security-scan.js
 * Runs shield rules, writes security_findings, fires notifications.
 * Called from nightly-master cron and optionally from deploy gate.
 */
import { sendPlatformEmail } from '../lib/email.js';

// Patterns that constitute a critical exposure if found in logs/chat/bundles
const EXPOSURE_PATTERNS = [
  // CRITICAL — rotate immediately
  { name: 'stripe_live',       regex: /sk_live_[a-zA-Z0-9]{24,}/g,           severity: 'critical', rotate: 'STRIPE_SECRET_KEY' },
  { name: 'stripe_restricted', regex: /rk_live_[a-zA-Z0-9]{24,}/g,           severity: 'critical', rotate: 'STRIPE_SECRET_KEY' },
  { name: 'anthropic_key',     regex: /sk-ant-[a-zA-Z0-9\-]{80,}/g,          severity: 'critical', rotate: 'ANTHROPIC_API_KEY' },
  { name: 'openai_key',        regex: /sk-[a-zA-Z0-9]{48,}/g,                severity: 'critical', rotate: 'OPENAI_API_KEY' },
  { name: 'openai_proj_key',   regex: /sk-proj-[a-zA-Z0-9\-_]{40,}/g,        severity: 'critical', rotate: 'OPENAI_API_KEY' },
  { name: 'cf_token',          regex: /cfut_[a-zA-Z0-9]{20,}/g,              severity: 'critical', rotate: 'CLOUDFLARE_API_TOKEN' },
  { name: 'iam_bridge',        regex: /iam-bridge-[a-zA-Z0-9]{20,}/g,        severity: 'critical', rotate: 'AGENTSAM_BRIDGE_KEY' },
  { name: 'resend_key',        regex: /re_[a-zA-Z0-9]{32,}/g,                severity: 'critical', rotate: 'RESEND_API_KEY' },
  { name: 'google_api_key',    regex: /AIza[0-9A-Za-z\-_]{35}/g,             severity: 'critical', rotate: 'GOOGLE_AI_API_KEY' },
  { name: 'github_pat',        regex: /ghp_[a-zA-Z0-9]{36}/g,                severity: 'critical', rotate: 'GITHUB_TOKEN' },
  { name: 'github_pat_v2',     regex: /github_pat_[a-zA-Z0-9_]{82}/g,        severity: 'critical', rotate: 'GITHUB_TOKEN' },
  { name: 'supabase_service',  regex: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/g, severity: 'critical', rotate: 'SUPABASE_SERVICE_ROLE_KEY' },
  { name: 'private_key_pem',   regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, severity: 'critical', rotate: null },
  { name: 'connection_string', regex: /(?:postgresql|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/gi, severity: 'critical', rotate: 'SUPABASE_DB_URL' },
  { name: 'aws_access_key',    regex: /AKIA[0-9A-Z]{16}/g,                   severity: 'critical', rotate: null },
  { name: 'twilio_sid',        regex: /AC[a-f0-9]{32}/g,                      severity: 'critical', rotate: null },
  { name: 'sendgrid_key',      regex: /SG\.[a-zA-Z0-9\-_]{22}\.[a-zA-Z0-9\-_]{43}/g, severity: 'critical', rotate: null },
  // HIGH
  { name: 'bearer_long',       regex: /Bearer\s+[a-zA-Z0-9\-_\.]{40,}/g,     severity: 'high', rotate: null },
  { name: 'jwt_token',         regex: /eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]{43,}/g, severity: 'high', rotate: null },
  { name: 'generic_hex64',     regex: /[a-f0-9]{64}/g,                        severity: 'high', rotate: null },
  { name: 'generic_secret',    regex: /[a-f0-9]{32}/g,                        severity: 'medium', rotate: null },
];

/**
 * D1 scan targets (last 24h). Chat titles in agentsam_chat_sessions; message bodies in R2 (see scanRecentChatSessionR2).
 */
const SCAN_TARGETS = [
  {
    table: 'agentsam_chat_sessions',
    column: 'title',
    idColumn: 'conversation_id',
    tenantColumn: 'tenant_id',
    limit: 500,
    dateCol: 'updated_at',
  },
  { table: 'terminal_history', column: 'content', limit: 200, dateCol: 'recorded_at', extraWhere: `direction = 'output'` },
  { table: 'terminal_history', column: 'content', limit: 200, dateCol: 'recorded_at', extraWhere: `direction = 'input'` },
  { table: 'agentsam_mcp_tool_execution', column: 'error_message', limit: 100, dateCol: 'created_at' },
  { table: 'agentsam_memory', column: 'value', limit: 200, dateCol: 'updated_at' },
];

function redact(str) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= 8) return '***REDACTED***';
  return s.slice(0, 6) + '...' + s.slice(-4) + ' [REDACTED]';
}

function fingerprintOf(text) {
  // Stable ID for dedup — first 12 chars of match + source
  return text.slice(0, 12).replace(/[^a-zA-Z0-9]/g, '');
}

function scanSourceLabel(target) {
  const base = `${target.table}:${target.column}`;
  if (target.extraWhere) {
    return `${base}:${target.extraWhere.replace(/[^a-z0-9]+/gi, '_')}`;
  }
  return base;
}

async function recordExposureFinding(env, {
  tenantId,
  sourceKey,
  sourceRef,
  match,
  pat,
  triggeredBy,
}) {
  const fp = fingerprintOf(match) + '_' + sourceKey;
  const existing = await env.DB.prepare(
    `SELECT id FROM security_findings
     WHERE fingerprint = ? AND status IN ('open','triaged','false_positive','fixed') LIMIT 1`,
  ).bind(fp).first().catch(() => null);
  if (existing) return null;

  const findingId = 'sf_' + Math.random().toString(36).slice(2);
  await env.DB.prepare(`
    INSERT INTO security_findings
      (id, tenant_id, source_type, source_ref, finding_type,
       severity, fingerprint, snippet_redacted, status,
       created_by, notification_sent_at, metadata_json,
       title, description, user_id)
    VALUES (?,?,?,?,?,?,?,?,  'open',?,NULL,?,?,?,?)
  `).bind(
    findingId, tenantId, sourceKey, sourceRef,
    'credential_exposure', pat.severity, fp,
    redact(match), triggeredBy,
    JSON.stringify({ pattern_name: pat.name, rotate_key: pat.rotate }),
    'credential_exposure',
    redact(match),
    triggeredBy,
  ).run().catch(() => {});

  return { id: findingId, pattern: pat.name, severity: pat.severity, source: sourceKey, rotate: pat.rotate };
}

/** Scan R2 messages.jsonl for sessions touched in the last 24h (agentsam_chat_sessions SSOT). */
async function scanRecentChatSessionR2(env, tenantId, triggeredBy) {
  const bucket = env.AUTORAG_BUCKET ?? env.R2 ?? null;
  if (!env?.DB || !bucket) return [];

  const findings = [];
  const cutoff = Math.floor(Date.now() / 1000) - 86400;
  let rows = [];
  try {
    const res = await env.DB.prepare(
      `SELECT conversation_id, r2_messages_key
       FROM agentsam_chat_sessions
       WHERE updated_at >= ? AND tenant_id = ?
         AND r2_messages_key IS NOT NULL AND trim(r2_messages_key) != ''
       LIMIT 100`,
    ).bind(cutoff, tenantId).all();
    rows = res?.results ?? [];
  } catch {
    return findings;
  }

  for (const row of rows) {
    const convId = String(row.conversation_id || row.id || '').trim();
    const key = row.r2_messages_key != null ? String(row.r2_messages_key).trim() : '';
    if (!convId || !key) continue;
    const sourceKey = 'agentsam_chat_sessions:r2_messages';
    try {
      const obj = await bucket.get(key);
      if (!obj) continue;
      const raw = await obj.text();
      const tail = raw.length > 65536 ? raw.slice(-65536) : raw;
      const content = tail
        .split('\n')
        .filter(Boolean)
        .slice(-80)
        .map((line) => {
          try {
            const j = JSON.parse(line);
            return String(j?.content ?? '');
          } catch {
            return '';
          }
        })
        .join('\n');
      for (const pat of EXPOSURE_PATTERNS) {
        pat.regex.lastIndex = 0;
        const matches = content.match(pat.regex);
        if (!matches?.length) continue;
        for (const match of matches) {
          const finding = await recordExposureFinding(env, {
            tenantId,
            sourceKey,
            sourceRef: convId,
            match,
            pat,
            triggeredBy,
          });
          if (finding) {
            finding.r2_key = key;
            findings.push(finding);
          }
        }
      }
    } catch {
      continue;
    }
  }
  return findings;
}

export async function runSecurityScan(env, opts = {}) {
  if (!env?.DB) return { ok: false, skipped: true };

  const {
    scanTargets = SCAN_TARGETS,
    triggeredBy = 'nightly_cron',
  } = opts;

  const tenantId = opts?.tenantId ?? env?.TENANT_ID ?? null;
  if (!tenantId) {
    throw new Error('security-scan: tenantId required');
  }

  const findings = [];

  for (const target of scanTargets) {
    let rows = [];
    try {
      const cutoff = Math.floor(Date.now() / 1000) - 86400;
      const dateCol = target.dateCol || 'created_at';
      const idCol = target.idColumn || 'id';
      const ew = target.extraWhere ? ` AND (${target.extraWhere})` : '';
      const tenantClause = target.tenantColumn ? ` AND ${target.tenantColumn} = ?` : '';
      const binds = target.tenantColumn
        ? [cutoff, tenantId, target.limit]
        : [cutoff, target.limit];
      const result = await env.DB.prepare(
        `SELECT ${idCol} AS id, ${target.column} AS content FROM ${target.table}
         WHERE ${dateCol} >= ?${ew}${tenantClause}
         LIMIT ?`,
      ).bind(...binds).all();
      rows = result?.results ?? [];
    } catch {
      continue;
    }

    const sourceKey = scanSourceLabel(target);

    for (const row of rows) {
      const text = String(row.content ?? '');
      for (const pat of EXPOSURE_PATTERNS) {
        pat.regex.lastIndex = 0;
        const matches = text.match(pat.regex);
        if (!matches?.length) continue;

        for (const match of matches) {
          const finding = await recordExposureFinding(env, {
            tenantId,
            sourceKey,
            sourceRef: row.id,
            match,
            pat,
            triggeredBy,
          });
          if (finding) findings.push(finding);
        }
      }
    }
  }

  const r2Findings = await scanRecentChatSessionR2(env, tenantId, triggeredBy);
  findings.push(...r2Findings);

  // Shield rule: null_value_registered — env_secrets with no encrypted_value and key_type='encrypted_d1'
  const nullVault = await env.DB.prepare(`
    SELECT key_name FROM env_secrets
    WHERE key_type = 'encrypted_d1' AND (encrypted_value IS NULL OR encrypted_value = '')
    AND is_active = 1
  `).all().catch(() => ({ results: [] }));

  for (const r of nullVault.results ?? []) {
    const fp = 'null_vault_' + r.key_name;
    const exists = await env.DB.prepare(
      `SELECT id FROM security_findings WHERE fingerprint=? AND status IN ('open','triaged','false_positive','fixed') LIMIT 1`,
    ).bind(fp).first().catch(() => null);
    if (exists) continue;
    await env.DB.prepare(`
      INSERT INTO security_findings
        (id, tenant_id, source_type, source_ref, finding_type,
         severity, fingerprint, snippet_redacted, status, created_by,
         title, description, user_id)
      VALUES (?,?,  'env_secrets',?,  'null_vault_value',  'medium',?,?,  'open',?,
              'null_vault_value', ?, ?)
    `).bind(
      'sf_' + Math.random().toString(36).slice(2),
      tenantId, r.key_name, fp, r.key_name, 'nightly_security_scan',
      r.key_name,
      'nightly_security_scan',
    ).run().catch(() => {});
  }

  // Shield rule: rotation_due — env_secrets past rotation_due_at
  const rotationDue = await env.DB.prepare(`
    SELECT key_name, rotation_due_at FROM env_secrets
    WHERE rotation_due_at IS NOT NULL
      AND rotation_due_at < unixepoch()
      AND is_active = 1
  `).all().catch(() => ({ results: [] }));

  for (const r of rotationDue.results ?? []) {
    const fp = 'rotation_due_' + r.key_name;
    const exists = await env.DB.prepare(
      `SELECT id FROM security_findings WHERE fingerprint=? AND status IN ('open','triaged','false_positive','fixed') LIMIT 1`,
    ).bind(fp).first().catch(() => null);
    if (exists) continue;
    await env.DB.prepare(`
      INSERT INTO security_findings
        (id, tenant_id, source_type, source_ref, finding_type,
         severity, fingerprint, snippet_redacted, status, created_by,
         title, description, user_id)
      VALUES (?,?,'env_secrets',?,'rotation_overdue','high',?,?,'open',?,
              'rotation_overdue', ?, ?)
    `).bind(
      'sf_' + Math.random().toString(36).slice(2),
      tenantId, r.key_name, fp,
      `${r.key_name} rotation overdue`,
      'nightly_security_scan',
      `${r.key_name} rotation overdue`,
      'nightly_security_scan',
    ).run().catch(() => {});
  }

  const criticalNew = findings.filter(f => f.severity === 'critical');

  // Notify if any critical findings were new — platform email (Resend or gmail_platform)
  if (criticalNew.length > 0) {
    const lines = criticalNew.map(f =>
      `• [${f.severity.toUpperCase()}] ${f.pattern} in ${f.source}` +
      (f.rotate ? ` → ROTATE: ${f.rotate}` : ''),
    ).join('\n');

    const { listOpenSecurityFindingEmailTargets, sendSecurityAlertHtmlToEmail } =
      await import('./security-alert-email.js');
    const targets = await listOpenSecurityFindingEmailTargets(env, tenantId);
    if (!targets.length) {
      console.warn('[security-scan] critical findings but no notification emails resolved');
    } else {
      for (const t of targets) {
        await sendSecurityAlertHtmlToEmail(env, {
          to: t.email,
          openFindingsCount: Math.max(t.openCount, criticalNew.length),
        }).catch((e) => console.warn('[security-scan] alert email', e?.message ?? e));
      }
    }
    // Keep a plain-text audit trail for ops when an explicit ops inbox is configured.
    const opsTo = String(env.SECURITY_ALERT_OPS_EMAIL || env.RESEND_TO || '').trim();
    if (opsTo.includes('@')) {
      await sendPlatformEmail(env, {
        to: opsTo,
        subject: `IAM Security Alert — ${criticalNew.length} critical finding(s) detected`,
        text: `IAM Security Scanner detected the following:\n\n${lines}\n\nReview at: https://inneranimalmedia.com/dashboard/settings/keys#security-findings\n\nTimestamp: ${new Date().toISOString()}`,
        category: 'security_scan',
        noAgentSamPrefix: true,
      });
    }

    // Update notification_sent_at on findings we just alerted
    for (const f of criticalNew) {
      await env.DB.prepare(
        `UPDATE security_findings SET notification_sent_at = unixepoch() WHERE id = ?`,
      ).bind(f.id).run().catch(() => {});
    }
  }

  // Update shield rule trigger counts
  if (findings.length > 0) {
    await env.DB.prepare(`
      UPDATE security_shield_rules
      SET trigger_count = trigger_count + ?,
          last_triggered_at = unixepoch(),
          updated_at = unixepoch()
      WHERE rule_type = 'exposure_pattern' AND is_active = 1
    `).bind(findings.length).run().catch(() => {});
  }

  return {
    ok: true,
    findings_new: findings.length,
    critical: criticalNew.length,
    rotation_due: rotationDue.results?.length ?? 0,
    null_vault: nullVault.results?.length ?? 0,
  };
}

const LOG_AUDIT_CLOSURE_EVENTS = new Set(['rotated', 'revoked']);

/** @param {import('@cloudflare/workers-types').D1Database} db */
async function logSecretAuditColumns(db) {
  const res = await db.prepare(`PRAGMA table_info(secret_audit_log)`).all();
  return new Set((res.results || []).map((r) => String(r.name)));
}

export async function logSecretAudit(env, {
  secretId,
  tenantId,
  userId,
  eventType,
  triggeredBy,
  previousLast4,
  newLast4,
  notes,
  ipAddress,
  userAgent,
  secretSource = 'user_secrets',
  terminalSessionId = null,
  closeAuditTrail = false,
  resolvedNotes = null,
}) {
  if (!env?.DB || !secretId || !tenantId) return;

  const db = env.DB;
  const cols = await logSecretAuditColumns(db);
  const isClosure = closeAuditTrail || LOG_AUDIT_CLOSURE_EVENTS.has(eventType);
  const closureNote = String(
    resolvedNotes || notes || `Closed by ${eventType} via dashboard`,
  ).slice(0, 500);

  if (isClosure && cols.has('resolved')) {
    const sets = ['resolved = 1'];
    const binds = [];
    if (cols.has('resolved_at')) sets.push('resolved_at = unixepoch()');
    if (cols.has('resolved_notes')) {
      sets.push('resolved_notes = ?');
      binds.push(closureNote);
    }
    binds.push(secretId, tenantId);
    await db
      .prepare(
        `UPDATE secret_audit_log SET ${sets.join(', ')}
         WHERE secret_id = ? AND tenant_id = ? AND COALESCE(resolved, 0) = 0`,
      )
      .bind(...binds)
      .run()
      .catch(() => {});
  }

  const colNames = [
    'id',
    'secret_id',
    'secret_source',
    'tenant_id',
    'user_id',
    'event_type',
    'triggered_by',
    'previous_last4',
    'new_last4',
    'notes',
    'ip_address',
    'user_agent',
    'created_at',
  ];
  const values = {
    id: `saudit_${Math.random().toString(36).slice(2, 14)}`,
    secret_id: secretId,
    secret_source: secretSource,
    tenant_id: tenantId,
    user_id: userId ?? null,
    event_type: eventType,
    triggered_by: triggeredBy ?? 'system',
    previous_last4: previousLast4 ?? null,
    new_last4: newLast4 ?? null,
    notes: notes ?? null,
    ip_address: ipAddress ?? null,
    user_agent: userAgent ?? null,
    created_at: 'unixepoch()',
    resolved: isClosure && cols.has('resolved') ? 1 : cols.has('resolved') ? 0 : undefined,
    resolved_at: isClosure && cols.has('resolved_at') ? 'unixepoch()' : undefined,
    resolved_notes: isClosure && cols.has('resolved_notes') ? closureNote : undefined,
  };

  const insertCols = [];
  const placeholders = [];
  const binds = [];
  for (const c of colNames) {
    if (!cols.has(c)) continue;
    insertCols.push(c);
    const v = values[c];
    if (v === 'unixepoch()') placeholders.push('unixepoch()');
    else {
      placeholders.push('?');
      binds.push(v);
    }
  }
  if (values.resolved !== undefined && cols.has('resolved')) {
    insertCols.push('resolved');
    placeholders.push('?');
    binds.push(values.resolved);
  }
  if (values.resolved_at && cols.has('resolved_at')) {
    insertCols.push('resolved_at');
    placeholders.push('unixepoch()');
  }
  if (values.resolved_notes !== undefined && cols.has('resolved_notes')) {
    insertCols.push('resolved_notes');
    placeholders.push('?');
    binds.push(values.resolved_notes);
  }
  if (terminalSessionId && cols.has('terminal_session_id')) {
    insertCols.push('terminal_session_id');
    placeholders.push('?');
    binds.push(terminalSessionId);
  }

  try {
    await db
      .prepare(
        `INSERT INTO secret_audit_log (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')})`,
      )
      .bind(...binds)
      .run();
  } catch (e) {
    console.warn('[logSecretAudit] insert failed', eventType, e?.message ?? e);
  }
}

export { EXPOSURE_PATTERNS, SCAN_TARGETS };
