/**
 * User API key security: secret_audit_log, security_findings, security_shield_rules.
 * Canonical secret_id = user_secrets.id (vault_secret_id on user_api_keys).
 */
import { logSecretAudit } from './security-scan.js';
import { sendPlatformEmail } from '../lib/email.js';
import { sendSecurityAlertHtmlEmails } from './security-alert-email.js';

/** @typedef {'key_created'|'key_validated_pass'|'key_validated_fail'|'key_revealed'|'key_rotated'|'key_deleted'|'key_used_by_agent'} KeyAuditEventType */

export const DEFAULT_TENANT_SHIELD_RULES = [
  {
    rule_type: 'key_expiry_warning',
    severity: 'high',
    config_json: { days_before: 14 },
    notify_channels: ['dashboard', 'email'],
  },
  {
    rule_type: 'rotation_due',
    severity: 'medium',
    config_json: { days: 90 },
    notify_channels: ['dashboard'],
  },
  {
    rule_type: 'untested_key_age',
    severity: 'medium',
    config_json: { days: 30 },
    notify_channels: ['dashboard'],
  },
  {
    rule_type: 'null_value_registered',
    severity: 'high',
    config_json: {},
    notify_channels: ['dashboard', 'email'],
  },
  {
    rule_type: 'test_failure',
    severity: 'high',
    config_json: {},
    notify_channels: ['dashboard', 'email'],
  },
];

const SHIELD_RULE_TYPES = new Set([
  'key_expiry_warning',
  'rotation_due',
  'test_failure',
  'exposure_pattern',
  'untested_key_age',
  'null_value_registered',
  'audit_anomaly',
]);

const PROVIDER_TEST_FAIL_SEVERITY = {
  cloudflare: 'high',
  openai: 'high',
  anthropic: 'high',
  google: 'high',
  github: 'medium',
  resend: 'medium',
  supabase: 'high',
  other: 'medium',
};

function newFindingId() {
  return `sf_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function parseJsonSafe(v, fallback = {}) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

function totalLatencyMs(checks) {
  if (!Array.isArray(checks)) return 0;
  return checks.reduce((n, c) => n + (Number(c?.latency_ms) || 0), 0);
}

/** @param {string} tenantId @param {string} secretId @param {string} findingType */
export async function sha256FindingFingerprint(tenantId, secretId, findingType) {
  const input = `${String(tenantId)}${String(secretId)}${String(findingType)}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function tableColumns(db, table) {
  try {
    const res = await db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set((res?.results || []).map((r) => String(r.name)));
  } catch {
    return new Set();
  }
}

/**
 * Canonical user_secrets id for audit/findings.
 * Never fall back to user_api_keys.id (uak_*) — security_findings.secret_id
 * REFERENCES user_secrets(id).
 * @param {{ vault_secret_id?: string|null, id?: string }} row
 */
export function canonicalUserSecretId(row) {
  const vid = row?.vault_secret_id != null ? String(row.vault_secret_id).trim() : '';
  if (vid) return vid;
  const id = row?.id != null ? String(row.id).trim() : '';
  return id.startsWith('sec_') ? id : '';
}

/** @param {unknown} value */
export function coerceUnixSeconds(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 1e12 ? Math.floor(n / 1000) : n;
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) return Math.floor(t / 1000);
  return null;
}

function unixSecondsToIso(sec) {
  if (sec == null || !Number.isFinite(sec)) return null;
  const ms = sec > 1e12 ? sec : sec * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Keys list `validated_at` for the dashboard. Prefer metadata, then last_tested_at
 * when test_status is not a failure.
 */
export function apiKeyValidatedAtDisplay(row, meta = {}) {
  const fail = new Set(['fail', 'failed', 'error']);
  const status = String(row?.test_status || meta?.test_status || '').toLowerCase();
  if (fail.has(status)) return null;

  const fromMeta = meta?.validated_at;
  if (fromMeta != null && String(fromMeta).trim() !== '') {
    const sec = coerceUnixSeconds(fromMeta);
    return sec != null ? unixSecondsToIso(sec) : String(fromMeta);
  }

  const tested = coerceUnixSeconds(row?.last_tested_at);
  return tested != null ? unixSecondsToIso(tested) : null;
}

/**
 * A successful Test is the test — do not open untested_key_age on the same op.
 * @param {{ operation?: string, validationResult?: { ok?: boolean } }} ctx
 */
export function shouldSkipUntestedKeyAge(ctx) {
  return ctx?.operation === 'validate' && ctx?.validationResult?.ok === true;
}

/**
 * Write secret_audit_log (non-blocking). secret_source is always user_secrets.
 */
export async function auditUserSecretEvent(env, {
  secretId,
  tenantId,
  userId,
  eventType,
  triggeredBy = 'dashboard_ui',
  previousLast4 = null,
  newLast4 = null,
  notes = null,
  ipAddress = null,
  userAgent = null,
  terminalSessionId = null,
}) {
  if (!env?.DB || !secretId || !tenantId) return;
  try {
    await logSecretAudit(env, {
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
      secretSource: 'user_secrets',
      terminalSessionId,
    });
  } catch (e) {
    console.warn('[keys-security] audit write failed', eventType, e?.message ?? e);
  }
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 */
async function findingExistsOpen(db, fingerprint) {
  const row = await db
    .prepare(
      `SELECT id FROM security_findings
       WHERE fingerprint = ?
         AND (
           status IN ('open','triaged','false_positive','fixed')
           OR (suppressed_until IS NOT NULL AND suppressed_until > unixepoch())
         )
       LIMIT 1`,
    )
    .bind(fingerprint)
    .first()
    .catch(() => null);
  return !!row?.id;
}

/**
 * Insert security_findings row (api_key source). Dedupes on fingerprint when open.
 */
export async function insertApiKeySecurityFinding(env, {
  tenantId,
  userId,
  workspaceId,
  secretId,
  findingType,
  severity,
  ruleId = null,
  metadata = {},
  createdBy = null,
}) {
  if (!env?.DB || !tenantId || !secretId || !findingType) return null;
  const db = env.DB;
  const cols = await tableColumns(db, 'security_findings');
  if (!cols.size) return null;

  const fingerprint = await sha256FindingFingerprint(tenantId, secretId, findingType);
  if (await findingExistsOpen(db, fingerprint)) return null;

  const id = newFindingId();
  const meta = {
    checks: metadata.checks ?? [],
    warnings: metadata.warnings ?? [],
    latency_ms: metadata.latency_ms ?? totalLatencyMs(metadata.checks),
    ...metadata,
  };

  const fields = [
    ['id', id],
    ['tenant_id', tenantId],
    ['source_type', 'api_key'],
    ['source_ref', secretId],
    ['finding_type', findingType],
    ['severity', severity],
    ['fingerprint', fingerprint],
    ['status', 'open'],
    ['created_by', createdBy || userId || 'system'],
    ['metadata_json', JSON.stringify(meta)],
  ];
  if (cols.has('user_id')) fields.push(['user_id', userId ?? null]);
  if (cols.has('workspace_id')) fields.push(['workspace_id', workspaceId ?? null]);
  if (cols.has('secret_id')) fields.push(['secret_id', secretId]);
  if (ruleId && cols.has('rule_id')) fields.push(['rule_id', ruleId]);
  if (cols.has('snippet_redacted')) {
    fields.push(['snippet_redacted', String(metadata.snippet_redacted || findingType).slice(0, 200)]);
  }

  const names = fields.map(([c]) => c).filter((c) => cols.has(c));
  const values = fields.filter(([c]) => cols.has(c)).map(([, v]) => v);
  if (!names.length) return null;

  const insertWith = async (colsNames, colsValues) => {
    await db
      .prepare(
        `INSERT INTO security_findings (${colsNames.join(', ')}) VALUES (${colsNames.map(() => '?').join(', ')})`,
      )
      .bind(...colsValues)
      .run();
  };

  try {
    await insertWith(names, values);
    return { id, fingerprint };
  } catch (e) {
    const msg = String(e?.message ?? e);
    const secretIdx = names.indexOf('secret_id');
    if (secretIdx >= 0 && /FOREIGN KEY|SQLITE_CONSTRAINT/i.test(msg)) {
      const retryNames = names.filter((_, i) => i !== secretIdx);
      const retryValues = values.filter((_, i) => i !== secretIdx);
      try {
        await insertWith(retryNames, retryValues);
        console.warn('[keys-security] finding insert retried without secret_id after FK fail');
        return { id, fingerprint };
      } catch (e2) {
        console.warn('[keys-security] finding insert failed', e2?.message ?? e2);
        return null;
      }
    }
    console.warn('[keys-security] finding insert failed', msg);
    return null;
  }
}

export async function fixOpenFindingsForSecret(env, { secretId, tenantId }) {
  if (!env?.DB || !secretId || !tenantId) return;
  const cols = await tableColumns(env.DB, 'security_findings');
  if (!cols.has('secret_id')) return;
  try {
    const sets = [`status = 'fixed'`];
    if (cols.has('resolved_at')) sets.push('resolved_at = unixepoch()');
    if (cols.has('updated_at')) sets.push('updated_at = unixepoch()');
    await env.DB.prepare(
      `UPDATE security_findings SET ${sets.join(', ')} WHERE secret_id = ? AND tenant_id = ? AND status = 'open'`,
    )
      .bind(secretId, tenantId)
      .run();
  } catch (e) {
    console.warn('[keys-security] fix findings failed', e?.message ?? e);
  }
}

async function bumpShieldRuleTrigger(env, { tenantId, ruleType, userId = null, ruleId = null }) {
  if (!env?.DB) return;
  try {
    if (ruleId) {
      await env.DB.prepare(
        `UPDATE security_shield_rules
         SET last_triggered_at = unixepoch(),
             trigger_count = trigger_count + 1,
             updated_at = unixepoch()
         WHERE id = ? AND tenant_id = ? AND is_active = 1`,
      )
        .bind(String(ruleId), tenantId)
        .run();
      return;
    }
    const binds = [ruleType, tenantId];
    let sql = `
      UPDATE security_shield_rules
      SET last_triggered_at = unixepoch(),
          trigger_count = trigger_count + 1,
          updated_at = unixepoch()
      WHERE rule_type = ? AND tenant_id = ? AND is_active = 1`;
    if (userId) {
      sql += ` AND (user_id IS NULL OR user_id = ?)`;
      binds.push(userId);
    } else {
      sql += ` AND user_id IS NULL`;
    }
    await env.DB.prepare(sql).bind(...binds).run();
  } catch (e) {
    console.warn('[keys-security] shield rule bump failed', ruleType, e?.message ?? e);
  }
}

async function loadShieldRules(env, tenantId, userId) {
  if (!env?.DB) return [];
  try {
    const res = await env.DB.prepare(
      `SELECT id, rule_type, severity, config_json, notify_channels, user_id, last_triggered_at
       FROM security_shield_rules
       WHERE tenant_id = ? AND is_active = 1
         AND (user_id IS NULL OR user_id = ?)`,
    )
      .bind(tenantId, userId ?? '')
      .all();
    return res?.results || [];
  } catch {
    return [];
  }
}

async function notifyShieldChannels(env, channels, { tenantId, subject, text, from, userId }) {
  const list = Array.isArray(channels) ? channels : parseJsonSafe(channels, ['dashboard']);
  const safeText = String(text || '').slice(0, 1200);
  const safeSubject = String(subject || 'Security alert').slice(0, 200);
  const safeFrom = from != null ? String(from).trim() : '';
  for (const ch of list) {
    const c = String(ch || '').toLowerCase();
    if (c === 'email') {
      try {
        let to = '';
        const uid = userId != null ? String(userId).trim() : '';
        if (uid) {
          const { resolveNotificationEmail } = await import('./notification-prefs.js');
          to = (await resolveNotificationEmail(env, uid)).email;
        }
        if (!to.includes('@')) {
          console.warn('[keys-security] email notify skipped', 'notification_email_required');
          continue;
        }
        await sendPlatformEmail(env, {
          to,
          subject: safeSubject,
          text: safeText,
          from: safeFrom || undefined,
          category: 'keys_security',
          noAgentSamPrefix: true,
        });
      } catch (e) {
        console.warn('[keys-security] email notify failed', e?.message ?? e);
      }
    }
    if (c === 'imessage') {
      try {
        const uid = userId != null ? String(userId).trim() : '';
        const tid = tenantId != null ? String(tenantId).trim() : '';
        if (!uid || !tid) {
          console.warn('[keys-security] imessage notify skipped', 'user_id_required');
          continue;
        }
        const { enqueueImessage, resolveImessageHandle } = await import('./imessage-relay.js');
        const toHandle = await resolveImessageHandle(env, { tenantId: tid, params: {} });
        if (!toHandle) {
          console.warn('[keys-security] imessage notify skipped', 'imessage_handle_required');
          continue;
        }
        await enqueueImessage(env, {
          tenantId: tid,
          userId: uid,
          promptText: `${safeSubject}\n${safeText}`,
          kind: 'send',
          toHandle,
        });
      } catch (e) {
        console.warn('[keys-security] imessage notify failed', e?.message ?? e);
      }
    }
    // dashboard channel = banner via GET /api/security/shield-pulse (no secret payloads)
  }
}

const PULSE_RULE_TYPES = new Set(['audit_anomaly', 'exposure_pattern', 'test_failure', 'null_value_registered']);

/**
 * Scan open security_findings + recent secret_audit_log; fire shield rule notifications (no secret values).
 * @param {Record<string, unknown>} env
 * @param {{
 *   tenantId: string,
 *   userId?: string | null,
 *   workspaceId?: string | null,
 *   fireNotifications?: boolean,
 *   throttleSec?: number,
 * }} opts
 */
export async function runSecurityShieldPulse(env, opts = {}) {
  const tenantId = opts.tenantId != null ? String(opts.tenantId).trim() : '';
  const userId = opts.userId != null ? String(opts.userId).trim() : '';
  const fireNotifications = opts.fireNotifications === true;
  const throttleSec = Number(opts.throttleSec) > 0 ? Number(opts.throttleSec) : 1800;
  const detailsUrl = '/dashboard/settings/keys#security-findings';

  if (!env?.DB || !tenantId) {
    return {
      alert: false,
      open_findings_count: 0,
      audit_events_24h: 0,
      details_url: detailsUrl,
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = nowSec - 86400;

  let openFindingsCount = 0;
  let auditEvents24h = 0;
  const findingTypes = new Set();

  try {
    const openRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM security_findings
       WHERE tenant_id = ? AND status = 'open'
         AND (? = '' OR user_id IS NULL OR user_id = ? OR user_id = '')`,
    )
      .bind(tenantId, userId, userId)
      .first();
    openFindingsCount = Number(openRow?.c) || 0;

    const typeRows = await env.DB.prepare(
      `SELECT DISTINCT finding_type FROM security_findings
       WHERE tenant_id = ? AND status = 'open'
         AND (? = '' OR user_id IS NULL OR user_id = ? OR user_id = '')`,
    )
      .bind(tenantId, userId, userId)
      .all();
    for (const r of typeRows?.results || []) {
      const ft = r?.finding_type != null ? String(r.finding_type).trim() : '';
      if (ft) findingTypes.add(ft);
    }
  } catch (e) {
    console.warn('[keys-security] pulse open findings scan failed', e?.message ?? e);
  }

  try {
    const auditRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM secret_audit_log
       WHERE tenant_id = ? AND created_at >= ?
         AND (? = '' OR user_id IS NULL OR user_id = ?)`,
    )
      .bind(tenantId, cutoff, userId, userId)
      .first();
    auditEvents24h = Number(auditRow?.c) || 0;
  } catch (e) {
    console.warn('[keys-security] pulse audit log scan failed', e?.message ?? e);
  }

  // Banner only for actionable open findings — routine secret_audit_log volume is not an alert.
  const alert = openFindingsCount > 0;
  const ruleTypesToFire = new Set();
  if (auditEvents24h > 0) ruleTypesToFire.add('audit_anomaly');
  if (openFindingsCount > 0) {
    for (const ft of findingTypes) {
      if (SHIELD_RULE_TYPES.has(ft) || PULSE_RULE_TYPES.has(ft)) ruleTypesToFire.add(ft);
    }
    if (ruleTypesToFire.size === 0 || !findingTypes.size) ruleTypesToFire.add('exposure_pattern');
  }

  if (alert && fireNotifications && ruleTypesToFire.size > 0) {
    const rules = await loadShieldRules(env, tenantId, userId);
    const subject = 'Inner Animal Media — Security Alert';
    const imessageLines = ['Inner Animal Media Security Alert'];
    if (openFindingsCount > 0) {
      const noun = openFindingsCount === 1 ? 'finding' : 'findings';
      imessageLines.push(`${openFindingsCount} open security ${noun} require your attention.`);
    }
    if (auditEvents24h > 0) {
      const noun = auditEvents24h === 1 ? 'event' : 'events';
      imessageLines.push(`${auditEvents24h} secret audit ${noun} in the last 24 hours.`);
    }
    imessageLines.push(`Review: https://inneranimalmedia.com${detailsUrl}`);
    const imessageText = imessageLines.join('\n');

    let htmlEmailDispatched = false;

    for (const rule of rules) {
      const rt = String(rule.rule_type || '');
      if (!ruleTypesToFire.has(rt)) continue;
      const last = Number(rule.last_triggered_at) || 0;
      if (last > 0 && nowSec - last < throttleSec) continue;
      const channels = parseJsonSafe(rule.notify_channels, ['dashboard']);
      const wantsEmail = channels.some((c) => String(c || '').toLowerCase() === 'email');

      await bumpShieldRuleTrigger(env, {
        tenantId,
        ruleType: rt,
        userId: rule.user_id ? userId : null,
        ruleId: rule.id,
      });

      if (openFindingsCount > 0 && wantsEmail && !htmlEmailDispatched) {
        await sendSecurityAlertHtmlEmails(env, { tenantId, userId });
        htmlEmailDispatched = true;
      }

      const nonEmailChannels = channels.filter((c) => String(c || '').toLowerCase() !== 'email');
      if (nonEmailChannels.length > 0) {
        await notifyShieldChannels(env, nonEmailChannels, {
          tenantId,
          userId,
          subject,
          text: imessageText,
        });
      }
    }
  }

  return {
    alert,
    open_findings_count: openFindingsCount,
    audit_events_24h: auditEvents24h,
    details_url: detailsUrl,
    message: alert
      ? openFindingsCount === 1
        ? '1 open security finding — review in Keys & Secrets'
        : `${openFindingsCount} open security findings — review in Keys & Secrets`
      : null,
  };
}

/** 30-min cron: pulse all tenants with open findings or recent audit activity. */
export async function runSecurityShieldPulseCron(env) {
  if (!env?.DB) return { tenants: 0, alerts: 0 };
  let tenantIds = [];
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 86400;
    const res = await env.DB.prepare(
      `SELECT DISTINCT tenant_id FROM security_findings WHERE status = 'open' AND tenant_id IS NOT NULL AND trim(tenant_id) != ''
       UNION
       SELECT DISTINCT tenant_id FROM secret_audit_log WHERE created_at >= ? AND tenant_id IS NOT NULL AND trim(tenant_id) != ''`,
    )
      .bind(cutoff)
      .all();
    tenantIds = (res?.results || [])
      .map((r) => (r?.tenant_id != null ? String(r.tenant_id).trim() : ''))
      .filter(Boolean);
  } catch (e) {
    console.warn('[keys-security] pulse cron tenant list failed', e?.message ?? e);
    const fallback = env.TENANT_ID != null ? String(env.TENANT_ID).trim() : '';
    if (fallback) tenantIds = [fallback];
  }

  let alerts = 0;
  for (const tenantId of tenantIds) {
    const pulse = await runSecurityShieldPulse(env, {
      tenantId,
      userId: null,
      fireNotifications: true,
    });
    if (pulse.alert) alerts += 1;
  }
  return { tenants: tenantIds.length, alerts };
}

async function countRecentAuditEvents(env, { secretId, tenantId, eventType, windowSec }) {
  if (!env?.DB) return 0;
  const cutoff = Math.floor(Date.now() / 1000) - windowSec;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM secret_audit_log
       WHERE secret_id = ? AND tenant_id = ? AND event_type = ? AND created_at >= ?`,
    )
      .bind(secretId, tenantId, eventType, cutoff)
      .first();
    return Number(row?.c) || 0;
  } catch {
    return 0;
  }
}

/**
 * Evaluate shield rules after a key operation. Never logs plaintext.
 */
export async function runShieldRulesForKeyOp(env, ctx) {
  if (!env?.DB || !ctx?.tenantId || !ctx?.secretId) return;
  const rules = await loadShieldRules(env, ctx.tenantId, ctx.userId);
  if (!rules.length) return;

  const apiRow = ctx.apiKeyRow || {};
  const meta = parseJsonSafe(apiRow.metadata_json, {});
  const nowSec = Math.floor(Date.now() / 1000);

  for (const rule of rules) {
    const ruleType = String(rule.rule_type || '');
    if (!SHIELD_RULE_TYPES.has(ruleType)) continue;
    const cfg = parseJsonSafe(rule.config_json, {});
    const channels = parseJsonSafe(rule.notify_channels, ['dashboard']);
    let triggered = false;
    let findingType = ruleType;
    let severity = String(rule.severity || 'medium');

    if (ruleType === 'null_value_registered' && ctx.operation === 'create' && ctx.encryptOk === false) {
      triggered = true;
    }

    if (ruleType === 'test_failure' && ctx.operation === 'validate' && ctx.validationResult?.ok === false) {
      triggered = true;
      severity = PROVIDER_TEST_FAIL_SEVERITY[ctx.provider] || severity;
    }

    // exposure_pattern: log/chat scan only (security-scan.js). Never match vault plaintext on create/validate.

    if (ruleType === 'key_expiry_warning' && apiRow.expires_at != null) {
      const exp = Number(apiRow.expires_at);
      const daysBefore = Number(cfg.days_before) || 14;
      if (Number.isFinite(exp) && exp > nowSec && exp - nowSec <= daysBefore * 86400) {
        triggered = true;
      }
    }

    if (ruleType === 'rotation_due' && apiRow.expires_at != null) {
      const exp = Number(apiRow.expires_at);
      if (Number.isFinite(exp) && exp < nowSec) triggered = true;
    }

    if (ruleType === 'untested_key_age' && !shouldSkipUntestedKeyAge(ctx)) {
      const days = Number(cfg.days) || 30;
      const testedSec =
        coerceUnixSeconds(meta.validated_at) || coerceUnixSeconds(apiRow.last_tested_at);
      if (testedSec && nowSec - testedSec > days * 86400) triggered = true;
      else if (!testedSec) {
        const createdSec = coerceUnixSeconds(apiRow.created_at);
        if (createdSec && nowSec - createdSec > days * 86400) triggered = true;
        if (ctx.operation === 'agent_use') triggered = true;
      }
    }

    if (ruleType === 'audit_anomaly' && ctx.operation === 'reveal') {
      const count = await countRecentAuditEvents(env, {
        secretId: ctx.secretId,
        tenantId: ctx.tenantId,
        eventType: 'key_revealed',
        windowSec: 3600,
      });
      if (count > 3) triggered = true;
    }

    if (!triggered) continue;

    await bumpShieldRuleTrigger(env, {
      tenantId: ctx.tenantId,
      ruleType,
      userId: rule.user_id ? ctx.userId : null,
    });

    await insertApiKeySecurityFinding(env, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      secretId: ctx.secretId,
      findingType,
      severity,
      ruleId: rule.id,
      createdBy: ctx.userId,
      metadata: {
        checks: ctx.validationResult?.checks ?? [],
        warnings: ctx.validationResult?.warnings ?? [],
        latency_ms: totalLatencyMs(ctx.validationResult?.checks),
        operation: ctx.operation,
      },
    });

    await notifyShieldChannels(env, channels, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      subject: `IAM Keys — ${findingType}`,
      text: `Shield rule "${ruleType}" triggered for key ${ctx.secretId} (tenant ${ctx.tenantId}). Review in Settings → Security.`,
    });
  }
}

/**
 * Full post-operation hook: audit + findings + shield rules.
 */
export async function handleKeySecurityAfterOp(env, ctx) {
  const secretId = ctx.secretId;
  if (!secretId) return;

  const ip = ctx.request?.headers?.get('CF-Connecting-IP') ?? null;
  const ua = ctx.request?.headers?.get('User-Agent') ?? null;

  if (ctx.operation === 'create') {
    await auditUserSecretEvent(env, {
      secretId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      eventType: 'key_created',
      triggeredBy: ctx.triggeredBy || 'dashboard_ui',
      newLast4: ctx.newLast4,
      notes: ctx.notes || 'Key created',
      ipAddress: ip,
      userAgent: ua,
    });
    await runShieldRulesForKeyOp(env, ctx);
    return;
  }

  if (ctx.operation === 'validate') {
    const pass = !!ctx.validationResult?.ok;
    await auditUserSecretEvent(env, {
      secretId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      eventType: pass ? 'key_validated_pass' : 'key_validated_fail',
      triggeredBy: ctx.triggeredBy || 'dashboard_ui',
      notes: pass ? `Validated ${ctx.provider}` : `Validation failed ${ctx.provider}`,
      ipAddress: ip,
      userAgent: ua,
    });
    if (pass) {
      await fixOpenFindingsForSecret(env, { secretId, tenantId: ctx.tenantId });
    }
    await runShieldRulesForKeyOp(env, ctx);
    return;
  }

  if (ctx.operation === 'reveal') {
    await auditUserSecretEvent(env, {
      secretId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      eventType: 'key_revealed',
      triggeredBy: ctx.triggeredBy || 'dashboard_ui',
      notes: ctx.provider
        ? `${ctx.provider} key revealed by owner`
        : ctx.apiKeyRow?.category === 'personal'
          ? 'Personal secret revealed by owner'
          : 'Secret revealed by owner',
      ipAddress: ip,
      userAgent: ua,
    });
    await runShieldRulesForKeyOp(env, ctx);
    return;
  }

  if (ctx.operation === 'rotate') {
    await auditUserSecretEvent(env, {
      secretId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      eventType: 'key_rotated',
      triggeredBy: ctx.triggeredBy || 'dashboard_ui',
      previousLast4: ctx.previousLast4,
      newLast4: ctx.newLast4,
      notes: 'Key rotated',
      ipAddress: ip,
      userAgent: ua,
    });
    await fixOpenFindingsForSecret(env, { secretId, tenantId: ctx.tenantId });
    await runShieldRulesForKeyOp(env, ctx);
    return;
  }

  if (ctx.operation === 'delete') {
    await auditUserSecretEvent(env, {
      secretId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      eventType: 'key_deleted',
      triggeredBy: ctx.triggeredBy || 'dashboard_ui',
      previousLast4: ctx.previousLast4,
      notes: 'Key deleted',
      ipAddress: ip,
      userAgent: ua,
    });
    return;
  }

  if (ctx.operation === 'agent_use') {
    await auditUserSecretEvent(env, {
      secretId,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      eventType: 'key_used_by_agent',
      triggeredBy: 'agent_sam',
      terminalSessionId: ctx.terminalSessionId ?? null,
      notes: ctx.notes || `Agent used ${ctx.provider} key`,
      ipAddress: ip,
      userAgent: ua,
    });
    await runShieldRulesForKeyOp(env, ctx);
  }
}

/**
 * Idempotent default shield rules for one tenant (provisioning + migration).
 * @returns {import('@cloudflare/workers-types').D1PreparedStatement[]}
 */
export function buildDefaultShieldRuleStatements(env, tenantId) {
  if (!env?.DB || !tenantId) return [];
  const stmts = [];
  for (const r of DEFAULT_TENANT_SHIELD_RULES) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO security_shield_rules (id, tenant_id, user_id, rule_type, severity, config_json, notify_channels)
         SELECT
           'ssr_' || lower(hex(randomblob(8))),
           ?,
           NULL,
           ?,
           ?,
           ?,
           ?
         WHERE NOT EXISTS (
           SELECT 1 FROM security_shield_rules sr
           WHERE sr.tenant_id = ? AND sr.rule_type = ? AND sr.user_id IS NULL
         )`,
      ).bind(
        tenantId,
        r.rule_type,
        r.severity,
        JSON.stringify(r.config_json),
        JSON.stringify(r.notify_channels),
        tenantId,
        r.rule_type,
      ),
    );
  }
  return stmts;
}

export async function seedDefaultShieldRulesForTenant(env, tenantId) {
  const stmts = buildDefaultShieldRuleStatements(env, tenantId);
  if (!stmts.length) return;
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    console.warn('[keys-security] seed shield rules failed', tenantId, e?.message ?? e);
  }
}
