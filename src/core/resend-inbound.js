/**
 * Resend inbound routing — resolve tenant/user from platform mail addresses (resend_emails).
 */

import { resolveCronTenantId } from '../../backend/jobs/cron-tenant.js';

function normalizeEmail(value) {
  const s = value != null ? String(value).trim().toLowerCase() : '';
  return s.includes('@') ? s : '';
}

function emailDomain(addr) {
  const s = normalizeEmail(addr);
  const at = s.lastIndexOf('@');
  return at > 0 ? s.slice(at + 1) : '';
}

/** @param {unknown} value */
export function normalizeResendAddressList(value) {
  const out = [];
  const push = (raw) => {
    const email = normalizeEmail(raw);
    if (email && !out.includes(email)) out.push(email);
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') push(item);
      else if (item && typeof item === 'object') push(item.email || item.address);
    }
    return out;
  }
  if (typeof value === 'string') {
    value.split(/[,;]/).forEach((part) => push(part));
    return out;
  }
  if (value && typeof value === 'object') push(value.email || value.address);
  return out;
}

/**
 * @param {Record<string, unknown>} env
 * @param {string[]} toAddresses normalized lower-case emails
 */
export async function resolveResendInboundScope(env, toAddresses) {
  if (!env?.DB) return null;
  const targets = (Array.isArray(toAddresses) ? toAddresses : [])
    .map(normalizeEmail)
    .filter(Boolean);
  if (!targets.length) return null;

  for (const addr of targets) {
    const row = await env.DB.prepare(
      `SELECT id, address, domain, tenant_id, forwards_to, can_receive, status
       FROM resend_emails
       WHERE lower(trim(address)) = ?
       LIMIT 1`,
    )
      .bind(addr)
      .first()
      .catch(() => null);
    if (row) {
      const tenantId = await resolveTenantForResendRow(env, row, addr);
      const userId = await resolveUserForInboundAddress(env, row, addr, tenantId);
      return {
        resendEmailId: row.id ? String(row.id) : null,
        toAddress: addr,
        toDomain: emailDomain(addr) || (row.domain ? String(row.domain).trim().toLowerCase() : ''),
        tenantId,
        userId,
        resendRow: row,
      };
    }
  }

  for (const addr of targets) {
    const domain = emailDomain(addr);
    if (!domain) continue;
    const row = await env.DB.prepare(
      `SELECT id, address, domain, tenant_id, forwards_to, can_receive, status
       FROM resend_emails
       WHERE lower(trim(domain)) = ?
       ORDER BY CASE WHEN can_receive = 1 THEN 0 ELSE 1 END, address
       LIMIT 1`,
    )
      .bind(domain)
      .first()
      .catch(() => null);
    if (row) {
      const tenantId = await resolveTenantForResendRow(env, row, addr);
      const userId = await resolveUserForInboundAddress(env, row, addr, tenantId);
      return {
        resendEmailId: row.id ? String(row.id) : null,
        toAddress: addr,
        toDomain: domain,
        tenantId,
        userId,
        resendRow: row,
      };
    }
  }

  const domain = emailDomain(targets[0]);
  if (!domain) return null;
  let platformTenantId = null;
  platformTenantId = await resolveCronTenantId(env);
  const tenant = await env.DB.prepare(
    platformTenantId
      ? `SELECT id FROM tenants
         WHERE lower(trim(domain)) = ?
           AND COALESCE(is_active, 1) = 1
         ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`
      : `SELECT id FROM tenants
         WHERE lower(trim(domain)) = ?
           AND COALESCE(is_active, 1) = 1
         ORDER BY updated_at DESC
         LIMIT 1`,
  )
    .bind(...(platformTenantId ? [domain, platformTenantId] : [domain]))
    .first()
    .catch(() => null);
  if (!tenant?.id) return null;
  return {
    resendEmailId: null,
    toAddress: targets[0],
    toDomain: domain,
    tenantId: String(tenant.id),
    userId: null,
    resendRow: null,
  };
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} row
 * @param {string} toAddress
 */
async function resolveTenantForResendRow(env, row, toAddress) {
  const fromRow = row?.tenant_id != null ? String(row.tenant_id).trim() : '';
  if (fromRow) return fromRow;
  const domain = emailDomain(toAddress) || (row?.domain ? String(row.domain).trim().toLowerCase() : '');
  if (!domain || !env?.DB) return null;
  const tenant = await env.DB.prepare(
    `SELECT id FROM tenants
     WHERE lower(trim(domain)) = ?
       AND COALESCE(is_active, 1) = 1
     LIMIT 1`,
  )
    .bind(domain)
    .first()
    .catch(() => null);
  return tenant?.id ? String(tenant.id) : null;
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} row
 * @param {string} toAddress
 * @param {string | null} tenantId
 */
async function resolveUserForInboundAddress(env, row, toAddress, tenantId) {
  if (!env?.DB) return null;
  const candidates = [];
  const push = (raw) => {
    const email = normalizeEmail(raw);
    if (email) candidates.push(email);
  };
  push(toAddress);
  if (row?.forwards_to) push(row.forwards_to);
  if (row?.address) push(row.address);

  for (const email of candidates) {
    const binds = [email];
    let sql = `SELECT id FROM auth_users WHERE lower(trim(email)) = ?`;
    if (tenantId) {
      sql += ` AND (tenant_id = ? OR active_tenant_id = ?)`;
      binds.push(tenantId, tenantId);
    }
    sql += ' LIMIT 1';
    const user = await env.DB.prepare(sql).bind(...binds).first().catch(() => null);
    if (user?.id) return String(user.id);
  }
  return null;
}

/**
 * SQL fragment + binds for tenant/user-scoped received_emails reads.
 * @param {string | null | undefined} tenantId
 * @param {string | null | undefined} userId
 */
export function receivedEmailsScopeClause(tenantId, userId) {
  const tid = tenantId != null ? String(tenantId).trim() : '';
  const uid = userId != null ? String(userId).trim() : '';
  if (!tid) {
    return { sql: '1 = 0', binds: [], scoped: false };
  }
  if (!uid) {
    return { sql: 'tenant_id = ?', binds: [tid], scoped: true };
  }
  return {
    sql: 'tenant_id = ? AND (user_id IS NULL OR TRIM(user_id) = \'\' OR user_id = ?)',
    binds: [tid, uid],
    scoped: true,
  };
}

/**
 * Resend email.received webhooks only carry metadata — body lives on Receiving API.
 * @param {Record<string, unknown>} env
 * @param {string} emailId
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function fetchResendReceivedEmail(env, emailId) {
  const id = emailId != null ? String(emailId).trim() : '';
  if (!id) return null;
  const key = env?.RESEND_API_KEY != null ? String(env.RESEND_API_KEY).trim() : '';
  if (!key) {
    console.warn('[resend-inbound] RESEND_API_KEY missing — cannot fetch received body');
    return null;
  }
  try {
    const res = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      },
    );
    if (!res.ok) {
      console.warn('[resend-inbound] receiving.get failed', res.status, await res.text().catch(() => ''));
      return null;
    }
    const json = await res.json().catch(() => null);
    return json && typeof json === 'object' ? json : null;
  } catch (e) {
    console.warn('[resend-inbound] receiving.get error', e?.message ?? e);
    return null;
  }
}

/**
 * Merge Receiving API body/headers into webhook payload when text/html are absent.
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} payload
 */
export async function enrichResendInboundPayload(env, payload) {
  const body = payload && typeof payload === 'object' ? { ...payload } : {};
  const data =
    body.data && typeof body.data === 'object' ? { ...body.data } : { ...body };
  const emailId =
    data.email_id != null
      ? String(data.email_id).trim()
      : data.id != null
        ? String(data.id).trim()
        : '';
  const hasBody =
    (data.text != null && String(data.text).trim()) ||
    (data.html != null && String(data.html).trim());
  const eventType = body.type != null ? String(body.type) : '';
  const needsFetch =
    !!emailId &&
    !hasBody &&
    (eventType === 'email.received' || eventType === '' || !!data.email_id);

  if (needsFetch) {
    const full = await fetchResendReceivedEmail(env, emailId);
    if (full) {
      if (full.from != null) data.from = full.from;
      if (full.to != null) data.to = full.to;
      if (full.subject != null) data.subject = full.subject;
      if (full.text != null) data.text = full.text;
      if (full.html != null) data.html = full.html;
      if (full.headers && typeof full.headers === 'object') {
        data.headers = { ...(data.headers || {}), ...full.headers };
      }
      if (full.message_id != null) data.message_id = full.message_id;
      data.email_id = emailId;
      data._enriched_from_receiving_api = true;
    }
  }

  if (body.data && typeof body.data === 'object') {
    body.data = data;
  } else {
    Object.assign(body, data);
  }
  return body;
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} payload Resend webhook body
 */
export async function persistResendInboundEmail(env, payload) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };

  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const fromRaw = data?.from;
  const fromAddress =
    typeof fromRaw === 'string'
      ? normalizeEmail(fromRaw)
      : normalizeEmail(fromRaw?.email || fromRaw?.address);
  const toAddresses = normalizeResendAddressList(
    data?.to || data?.recipient || data?.recipients || data?.received_for,
  );
  const subject = data?.subject != null ? String(data.subject) : '(no subject)';
  const text = data?.text != null ? String(data.text) : '';
  const html = data?.html != null ? String(data.html) : '';
  const externalMessageId =
    data?.email_id != null
      ? String(data.email_id).trim()
      : data?.id != null
        ? String(data.id).trim()
        : payload?.id != null
          ? String(payload.id).trim()
          : '';

  const scope = await resolveResendInboundScope(env, toAddresses);
  if (!scope?.tenantId) {
    return { ok: false, reason: 'unresolved_tenant', to: toAddresses };
  }

  if (externalMessageId) {
    const dupe = await env.DB.prepare(
      `SELECT id FROM received_emails
       WHERE provider = 'resend' AND external_message_id = ?
       LIMIT 1`,
    )
      .bind(externalMessageId)
      .first()
      .catch(() => null);
    if (dupe?.id) return { ok: true, id: String(dupe.id), duplicate: true };
  }

  const id = crypto.randomUUID();
  const dateReceived = new Date().toISOString();
  const r2Key = scope.tenantId ? `email/inbound/${scope.tenantId}/${id}.json` : null;

  if (r2Key && env.ASSETS && (html || text)) {
    try {
      await env.ASSETS.put(
        r2Key,
        JSON.stringify({
          id,
          from: fromAddress,
          to: scope.toAddress,
          subject,
          text: text || null,
          html: html || null,
          received_at: dateReceived,
        }),
        { httpMetadata: { contentType: 'application/json' } },
      );
    } catch (e) {
      console.warn('[resend-inbound] R2 put failed', e?.message ?? e);
    }
  }

  await env.DB.prepare(
    `INSERT INTO received_emails (
       id, r2_key, from_address, to_address, subject, date_received,
       message_id, has_html, has_text, has_attachments, attachment_count,
       text_length, html_length, is_read, is_archived, is_starred,
       category, source, metadata, tenant_id, user_id, to_domain,
       external_message_id, provider, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, 0, 0, 'primary', 'resend', ?, ?, ?, ?, ?, 'resend', datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      r2Key,
      fromAddress || '',
      scope.toAddress || toAddresses[0] || '',
      subject,
      dateReceived,
      externalMessageId || null,
      html ? 1 : 0,
      text ? 1 : 0,
      text.length,
      html.length,
      JSON.stringify({
        resend_email_id: scope.resendEmailId,
        external_message_id: externalMessageId || null,
      }),
      scope.tenantId,
      scope.userId,
      scope.toDomain || null,
      externalMessageId || null,
    )
    .run();

  return {
    ok: true,
    id,
    tenantId: scope.tenantId,
    userId: scope.userId,
    toAddress: scope.toAddress,
  };
}
