/**
 * Daily memory pipeline — Gmail triage → profile-driven Gemini synthesis → AUTORAG + D1 + memory lane → Resend.
 * Evening and morning share this core; morning merges ## Morning into the same YYYY-MM-DD.md file.
 * Model + instructions come from agentsam_subagent_profile slug=daily-memory-email.
 */

import { logAndArchiveSentEmail } from '../services/email/email-sent-archive.js';
import {
  isDeployNotificationEmail,
  triageDeployNotificationEmail,
} from './deploy-email-intake.js';
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { resolveCronTenantId, resolveCronWorkspaceId } from './cron-tenant.js';
import { snapshotGmailInboxForUser } from '../../src/core/gmail-inbox-snapshot.js';
import { chunkMarkdown } from './chunk-markdown.js';
import { writeMemoryLane } from '../agentsam/rag/index.js';
import {
  alertDailyPlan,
  DailyPlanError,
  gatherMorningPlanContext,
  generateWithGemini,
  generateWithGeminiRetry,
  listDailyMemoryRecipients,
  resolveDailyDigestScope,
  resolveDailyPlanNotifyUser,
} from './daily-plan-support.js';
import { digestContextJson } from './daily-digest-scope.js';
import {
  DailyMemoryAgentConfigError,
  resolveDailyMemoryAgentConfig,
} from './daily-memory-agent-config.js';
import {
  collectDailyCodeActivity,
  dailyCodeActivityForDigest,
  renderDailyCodeActivityMarkdown,
} from '../../src/core/daily-code-activity.js';

const TRIAGE_CONCURRENCY = 8;
const MEMORY_R2_PREFIX = 'memory/';
const AUTORAG_PUBLIC = 'https://autorag.inneranimalmedia.com';

/** @returns {string} YYYY-MM-DD in America/Chicago */
export function chicagoDateIso(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

const GMAIL_MAX_PER_ACCOUNT = 100;

/** @param {string} dateIso @param {string|null|undefined} [userId] */
export function memoryR2Key(dateIso, userId = null) {
  const uid = userId ? String(userId).trim() : '';
  if (uid) return `${MEMORY_R2_PREFIX}users/${uid}/${dateIso}.md`;
  return `${MEMORY_R2_PREFIX}${dateIso}.md`;
}

/** @param {string|null|undefined} userId */
function userIdSuffix(userId) {
  if (!userId) return '';
  return `_${String(userId).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 48)}`;
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseJsonGemini(raw) {
  const cleaned = String(raw || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('json_parse_failed');
  }
}

async function triageWithGemini(env, email, modelKey) {
  const raw = await generateWithGemini(env, {
    modelKey,
    stage: 'email_triage',
    systemInstruction:
      'Triage one email for a solo founder. Return JSON only: {"label":"primary|updates|action|fyi","summary":"one line","needs_action":true,"urgency":"critical|high|normal|low|fyi","project_tag":"client or internal tag","suggested_action":"reply|schedule|archive|ignore","reason":"brief"}. No emojis.',
    userText: JSON.stringify({
      id: email.id,
      account: email.account,
      from: email.from_address,
      subject: email.subject,
      date: email.date_received,
      snippet: email.snippet,
      starred: email.is_starred,
    }),
    maxOutputTokens: 512,
    temperature: 0.1,
    json: true,
  });
  return parseJsonGemini(raw);
}

/**
 * Merge evening/morning into one daily file — never drop ## Evening when morning runs.
 * @param {string} dateIso
 * @param {string|null|undefined} existingRaw
 * @param {'evening'|'morning'} pass
 * @param {string} sectionBody
 */
export function mergeDailyMemoryMd(dateIso, existingRaw, pass, sectionBody) {
  const title = `# Daily Memory — ${dateIso}`;
  let body = String(existingRaw || '').trim();
  if (body.startsWith('# Daily Memory')) {
    body = body.replace(/^# Daily Memory[^\n]*\n+/, '').trim();
  }

  const extract = (header) => {
    const re = new RegExp(`^## ${header}\\s*$`, 'm');
    const match = re.exec(body);
    if (!match) return '';
    const start = match.index + match[0].length;
    const rest = body.slice(start);
    const next = rest.search(/^## /m);
    return (next >= 0 ? rest.slice(0, next) : rest).trim();
  };

  let evening = extract('Evening');
  let morning = extract('Morning');

  if (pass === 'evening') evening = String(sectionBody || '').trim();
  else morning = String(sectionBody || '').trim();

  const parts = [title, ''];
  if (evening) parts.push('## Evening', '', evening, '');
  if (morning) parts.push('## Morning', '', morning, '');
  return `${parts.join('\n').trim()}\n`;
}

/** @param {*} env @param {string} key */
async function readAutoragText(env, key) {
  const bucket = env?.AUTORAG_BUCKET;
  if (!bucket?.get) return '';
  try {
    const obj = await bucket.get(key);
    return obj ? await obj.text() : '';
  } catch {
    return '';
  }
}

/** @param {*} env @param {string} key @param {string} text */
async function putAutoragText(env, key, text) {
  const bucket = env?.AUTORAG_BUCKET;
  if (!bucket?.put) {
    throw new DailyPlanError('AUTORAG_BUCKET binding not configured', { stage: 'r2_put', model: '' });
  }
  await bucket.put(key, text, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } });
}

/** @param {*} env @param {object} email */
async function triageOneEmail(env, email, modelKey) {
  if (isDeployNotificationEmail(email)) {
    const triage = triageDeployNotificationEmail(email);
    return { ...email, triage, _log: { model_key: null, source: 'deploy_email_parser', latency_ms: 0 } };
  }

  const t0 = Date.now();
  try {
    const triage = await triageWithGemini(env, email, modelKey);
    return { ...email, triage, _log: { model_key: modelKey, source: 'gemini', latency_ms: Date.now() - t0 } };
  } catch (primaryErr) {
    primaryErr._triage_latency_ms = Date.now() - t0;
    throw primaryErr;
  }
}

/** @param {*} env @param {object[]} emails @param {number|{ concurrency?: number, modelKey?: string }} [concurrencyOrOpts] */
export async function triageEmailsParallel(env, emails, concurrencyOrOpts = TRIAGE_CONCURRENCY) {
  const opts = typeof concurrencyOrOpts === 'object' && concurrencyOrOpts
    ? concurrencyOrOpts
    : { concurrency: concurrencyOrOpts };
  const concurrency = Number(opts.concurrency) > 0 ? Number(opts.concurrency) : TRIAGE_CONCURRENCY;
  const modelKey = String(opts.modelKey || '').trim();
  if (!modelKey) {
    throw new DailyPlanError('daily memory triage model_key required from subagent profile', {
      stage: 'agent_profile',
    });
  }
  if (!Array.isArray(emails) || !emails.length) {
    return { items: [], failed: 0, summary: 'No inbox messages in window.' };
  }
  const items = [];
  let failed = 0;
  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);
    const settled = await Promise.allSettled(batch.map((e) => triageOneEmail(env, e, modelKey)));
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === 'fulfilled') items.push(s.value);
      else {
        failed += 1;
        items.push({
          ...batch[j],
          triage_error: String(s.reason?.message || s.reason),
          _log: {
            model_key: modelKey,
            source: 'error',
            latency_ms: s.reason?._triage_latency_ms ?? null,
          },
        });
      }
    }
  }
  const critical = items.filter((x) => x.triage?.urgency === 'critical' || x.triage?.urgency === 'high').length;
  return {
    items,
    failed,
    summary: `${items.length} emails triaged (${critical} high/critical, ${failed} flash errors).`,
  };
}

/**
 * Per-email visibility into cron triage, keyed by cron_run_id — a child of
 * agentsam_cron_runs, not a stuffed metadata_json blob and not
 * agentsam_tool_call_log (this isn't a chat tool-loop turn).
 * Non-blocking: a logging failure never fails the digest.
 * @see migrations/901_agentsam_cron_triage_log.sql
 * @param {*} env
 * @param {{ runId: string|null, tenantId: string|null, workspaceId: string|null, userId: string|null, items: object[] }} p
 */
async function logCronTriageBatch(env, { runId, tenantId, workspaceId, userId, items }) {
  if (!env?.DB || !runId || !Array.isArray(items) || !items.length) return;
  try {
    const stmts = items.map((item) => {
      const log = item._log || {};
      const t = item.triage || {};
      const id = `actl_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      return env.DB.prepare(
        `INSERT INTO agentsam_cron_triage_log (
          id, cron_run_id, tenant_id, workspace_id, user_id, email_id, account,
          model_key, source, label, urgency, needs_action, suggested_action, project_tag,
          latency_ms, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
      ).bind(
        id,
        runId,
        tenantId || null,
        workspaceId || null,
        userId || null,
        item.id || null,
        item.account || null,
        log.model_key || null,
        log.source || (item.triage_error ? 'error' : null),
        t.label || null,
        t.urgency || null,
        t.needs_action != null ? (t.needs_action ? 1 : 0) : null,
        t.suggested_action || null,
        t.project_tag || null,
        log.latency_ms != null ? Number(log.latency_ms) : null,
        item.triage_error ? String(item.triage_error).slice(0, 500) : null,
      );
    });
    const CHUNK = 50;
    for (let i = 0; i < stmts.length; i += CHUNK) {
      await env.DB.batch(stmts.slice(i, i + CHUNK));
    }
  } catch (e) {
    console.warn('[daily-memory] cron triage log write failed', e?.message ?? e);
  }
}

/** Split deploy notifications (verified ground truth) from human inbox triage for synthesis. */
export function groupTriageBatchForSynthesis(triageBatch) {
  const items = Array.isArray(triageBatch?.items) ? triageBatch.items : [];
  const verifiedDeploys = items
    .filter((e) => e?.triage?.source === 'deploy_email_parser')
    .map((e) => ({
      message_id: e.id,
      account: e.account,
      subject: e.subject,
      date: e.date_received,
      summary: e.triage?.summary,
      facts: e.triage?.facts,
    }))
    .filter((d) => d.facts || d.summary);
  const humanEmails = items.filter((e) => !e?.triage_error && e?.triage?.source !== 'deploy_email_parser');
  const triageErrors = items.filter((e) => e.triage_error);
  return {
    verifiedDeploys,
    humanEmails,
    triageErrors,
    failed: Number(triageBatch?.failed) || 0,
    summary: String(triageBatch?.summary || ''),
  };
}

/** @param {*} env @param {{ triageBatch: object, ctxData: object, dateIso: string, dateDisplay: string, agentConfig: object }} p */
async function synthesizeEveningMd(env, { triageBatch, ctxData, dateIso, dateDisplay, agentConfig }) {
  const grouped = groupTriageBatchForSynthesis(triageBatch);
  const dayInCode = ctxData.dailyCodeActivity || { available: false, reason: 'not_collected' };
  const userText = `Date: ${dateDisplay} (${dateIso})

Write the ## Evening section body ONLY (no ## Evening header). Use ### subsections exactly:
### Email Summary
### Patterns
### Workspace Status
### Your Day in Code
### Action Items
### Carry Forward

INBOX TRIAGE (this user's connected Gmail accounts only):
${JSON.stringify({ items: grouped.humanEmails, failed: grouped.failed, summary: grouped.summary, triage_errors: grouped.triageErrors })}

YOUR DAY IN CODE (deterministic GitHub facts for this user's scoped repos — quote numbers; do not invent):
${JSON.stringify(dayInCode)}

WORKSPACE CONTEXT (this user's tenant/workspaces only — never invent data outside this JSON):
${digestContextJson(ctxData, ctxData.digestScope)}

Rules: Personal workspace digest only. Use inbox triage + workspace context JSON — nothing else. Never mention other users, other tenants, platform operations, billing, revenue, cron health, migrations, or Inner Animal Media internals. If triage failed, say so — do not invent blockers. ### Your Day in Code must use the DAY IN CODE JSON; if available=false, one line with the reason. 1-3 minute read. No emojis. No JSON.`;

  const systemInstruction = [
    agentConfig.instructions,
    'You are a personal workspace digest assistant. Output markdown subsection content only. Never reference data outside the provided workspace context.',
  ].filter(Boolean).join('\n\n');

  return generateWithGeminiRetry(env, {
    modelKey: agentConfig.apiModel,
    stage: 'evening_synthesis',
    systemInstruction,
    userText,
    maxOutputTokens: 2800,
    temperature: 0.25,
  });
}

/** @param {*} env @param {{ triageBatch: object, ctxData: object, priorMd: string, yesterdayMd: string, dateIso: string, dateDisplay: string, agentConfig: object }} p */
async function synthesizeMorningMd(env, { triageBatch, ctxData, priorMd, yesterdayMd, dateIso, dateDisplay, agentConfig }) {
  const grouped = groupTriageBatchForSynthesis(triageBatch);
  const dayInCode = ctxData.dailyCodeActivity || { available: false, reason: 'not_collected' };
  const userText = `Date: ${dateDisplay} (${dateIso})

Write the ## Morning section body ONLY (no ## Morning header). Use ### subsections in order:
### ALERTS
### INBOX PRIORITY
### WORKSPACE
### YOUR DAY IN CODE
### TODAY'S PLAN

PRIOR DIGEST (continuity — this user only):
${(priorMd || yesterdayMd || '(none)').slice(0, 8000)}

INBOX TRIAGE (this user's connected Gmail accounts only):
${JSON.stringify({ items: grouped.humanEmails, failed: grouped.failed, summary: grouped.summary, triage_errors: grouped.triageErrors })}

YOUR DAY IN CODE (deterministic GitHub facts for this user's scoped repos — quote numbers; do not invent):
${JSON.stringify(dayInCode)}

WORKSPACE DELTA (this user's tenant/workspaces only):
${digestContextJson(ctxData, ctxData.digestScope)}

Rules: Shorter personal digest — 1-2 minute read. Action-first. Never mention other users, tenants, platform operations, billing, or Inner Animal Media internals. ALERTS must include WORKSPACE DELTA.activeBlockers and agentCompletion when present. If triage failed, say so — do not invent regressions. ### YOUR DAY IN CODE must use the DAY IN CODE JSON; if available=false, one line with the reason. No emojis. Markdown only.`;

  const systemInstruction = [
    agentConfig.instructions,
    'You are a personal morning focus assistant. Output markdown subsection content only. Never reference data outside the provided workspace context.',
  ].filter(Boolean).join('\n\n');

  return generateWithGeminiRetry(env, {
    modelKey: agentConfig.apiModel,
    stage: 'morning_synthesis',
    systemInstruction,
    userText,
    maxOutputTokens: 2000,
    temperature: 0.2,
  });
}

/**
 * Fallback digest body when Pro synthesis fails even after retry — raw
 * triage rows as a markdown table instead of a silent missed digest.
 * @param {object} triageBatch
 * @param {'evening'|'morning'} mode
 * @param {object} [dailyCodeActivity]
 */
function buildPartialDigestMd(triageBatch, mode, dailyCodeActivity = null) {
  const grouped = groupTriageBatchForSynthesis(triageBatch);
  const header = mode === 'evening'
    ? '### Email Summary (partial — synthesis unavailable)'
    : '### INBOX PRIORITY (partial — synthesis unavailable)';
  const lines = [
    header,
    '',
    '_Gemini synthesis failed after retry; showing raw triage rows instead of a summary._',
    '',
  ];
  const items = grouped.humanEmails.slice(0, 40);
  if (!items.length) {
    lines.push('No triaged inbox rows available for this window.');
  } else {
    lines.push('| Urgency | Label | Subject | Suggested Action |', '|---|---|---|---|');
    for (const e of items) {
      const t = e.triage || {};
      const subject = String(e.subject || '(no subject)').replace(/\|/g, '/').slice(0, 80);
      lines.push(`| ${t.urgency || '-'} | ${t.label || '-'} | ${subject} | ${t.suggested_action || '-'} |`);
    }
  }
  lines.push('', mode === 'evening' ? '### Your Day in Code' : '### YOUR DAY IN CODE', '');
  lines.push(renderDailyCodeActivityMarkdown(dailyCodeActivity));
  return lines.join('\n');
}

/** @param {string} md */
function markdownToEmailHtml(md) {
  const lines = String(md || '').split('\n');
  let html = '';
  for (const line of lines) {
    if (/^### /.test(line)) {
      html += `<h3 style="margin:22px 0 8px;font-size:15px;color:#1558b8;">${escHtml(line.slice(4))}</h3>`;
    } else if (/^## /.test(line)) {
      html += `<h2 style="margin:28px 0 10px;font-size:17px;color:#1a1c1e;border-bottom:1px solid #cdd3dc;padding-bottom:6px;">${escHtml(line.slice(3))}</h2>`;
    } else if (/^# /.test(line)) {
      html += `<h1 style="margin:0 0 16px;font-size:22px;color:#1a1c1e;">${escHtml(line.slice(2))}</h1>`;
    } else if (/^[-*] /.test(line)) {
      html += `<p style="margin:4px 0 4px 12px;font-size:14px;line-height:1.55;color:#2d3135;">• ${escHtml(line.slice(2))}</p>`;
    } else if (line.trim() === '') {
      html += '<div style="height:8px"></div>';
    } else {
      html += `<p style="margin:6px 0;font-size:14px;line-height:1.6;color:#2d3135;">${escHtml(line)}</p>`;
    }
  }
  return html;
}

/** @param {{ variant: 'evening'|'morning', title: string, subtitle: string, md: string }} p */
function brandedEmailHtml({ variant, title, subtitle, md }) {
  const accent = variant === 'evening' ? '#1558b8' : '#0d47a1';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#eef2f7;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<div style="max-width:680px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border:1px solid #cdd3dc;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(26,28,30,0.08);">
    <div style="padding:28px 32px 20px;border-bottom:3px solid ${accent};background:linear-gradient(180deg,#f8fafc,#fff);">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${accent};">Inner Animal Media</div>
      <h1 style="margin:8px 0 4px;font-size:24px;font-weight:600;color:#1a1c1e;">${escHtml(title)}</h1>
      <div style="font-size:13px;color:#5f6368;">${escHtml(subtitle)}</div>
    </div>
    <div style="padding:28px 32px 36px;">${markdownToEmailHtml(md)}</div>
    <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e4e9f1;font-size:12px;color:#5f6368;text-align:center;">
      inneranimalmedia.com · Agent Sam · ${variant === 'evening' ? 'Memory Close' : 'Focus Open'}
    </div>
  </div>
</div></body></html>`;
}

/**
 * @param {*} env
 * @param {{ mode: 'evening'|'morning', md: string, dateIso: string, tenantId: string, userId?: string|null, r2Key: string, triageBatch: object, models: object, emailSkipped?: boolean }} p
 */
async function persistMemoryArtifacts(env, p) {
  const { mode, md, dateIso, tenantId, userId, r2Key, triageBatch, models } = p;
  const errors = [];
  const ws = (await resolveCronWorkspaceId(env)) || '';
  if (!ws) {
    errors.push('platform_d1_workspace_id_required');
    return { errors };
  }
  const uidSuffix = userIdSuffix(userId);
  const planId = `plan_daily${uidSuffix}_${dateIso.replace(/-/g, '')}`;
  const r2Url = `${AUTORAG_PUBLIC}/${r2Key}`;
  const isPlatformMemory = !userId || !String(r2Key).includes('/users/');

  await putAutoragText(env, r2Key, md);

  if (isPlatformMemory) {
    try {
      const snap = await env.DB.prepare(
        'SELECT snapshot_date FROM daily_snapshots WHERE snapshot_date = ? LIMIT 1',
      ).bind(dateIso).first();
      if (snap?.snapshot_date) {
        await env.DB.prepare(
          'UPDATE daily_snapshots SET digest_text = ?, updated_at = unixepoch() WHERE snapshot_date = ?',
        ).bind(md, dateIso).run();
      } else {
        await env.DB.prepare(
          `INSERT INTO daily_snapshots (
            snapshot_date, deploy_count, tokens_in, tokens_out, cost_usd, active_workflows, digest_text, created_at, updated_at
          ) VALUES (?, 0, 0, 0, 0, 0, ?, unixepoch(), unixepoch())`,
        ).bind(dateIso, md).run();
      }
    } catch (e) {
      errors.push(`daily_snapshots:${e?.message}`);
    }
  }

  const eveningBody = md.match(/## Evening\s*\n+([\s\S]*?)(?=^## Morning|\Z)/m)?.[1]?.trim() || '';
  const morningBody = md.match(/## Morning\s*\n+([\s\S]*)/m)?.[1]?.trim() || '';

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_plans (
        id, tenant_id, workspace_id, plan_date, plan_type, title, status,
        morning_brief, eod_summary, plan_md_url, r2_prefix, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'daily', ?, 'active', ?, ?, ?, ?, unixepoch(), unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        morning_brief = COALESCE(excluded.morning_brief, agentsam_plans.morning_brief),
        eod_summary = COALESCE(excluded.eod_summary, agentsam_plans.eod_summary),
        plan_md_url = excluded.plan_md_url,
        r2_prefix = excluded.r2_prefix,
        updated_at = unixepoch()`,
    ).bind(
      planId,
      tenantId,
      ws,
      dateIso,
      `Daily Memory ${dateIso}`,
      mode === 'morning' ? morningBody.slice(0, 8000) : null,
      mode === 'evening' ? eveningBody.slice(0, 8000) : null,
      r2Url,
      MEMORY_R2_PREFIX,
    ).run();
  } catch (e) {
    errors.push(`agentsam_plans:${e?.message}`);
  }

  try {
    // Single rolling state row per user (or workspace-global) — not one row per day.
    // Readers: loadD1Memory (D1); briefing prefers Hyperdrive lane + agentsam_plans.
    // No outbox / projection — projection_status=skipped.
    const rollingKey = userId ? `daily_memory_rolling_${userId}` : 'daily_memory_rolling';
    const memId = userId ? `mem_daily_rolling_${userId}` : 'mem_daily_rolling';
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    await env.DB.prepare(
      `INSERT INTO agentsam_memory (
        id, memory_id, tenant_id, user_id, workspace_id, memory_type, key, value,
        importance, is_pinned, decay_score, source, expires_at, projection_status,
        revision, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'state', ?, ?, 8, 1, 1.0, 'daily_memory_pipeline', ?, 'skipped',
        1, 'active', unixepoch(), unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        value = excluded.value,
        expires_at = excluded.expires_at,
        projection_status = 'skipped',
        is_archived = 0,
        status = 'active',
        updated_at = unixepoch()`,
    ).bind(
      memId,
      memId,
      tenantId,
      userId || 'platform',
      ws,
      rollingKey,
      md.slice(0, 4000),
      expiresAt,
    ).run();
  } catch (e) {
    errors.push(`agentsam_memory:${e?.message}`);
  }

  const compactionId = `cmp_daily${uidSuffix}_${mode}_${dateIso.replace(/-/g, '')}_${Date.now()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_compaction_events (
        id, tenant_id, workspace_id, user_id, compaction_type, compaction_scope, compaction_strategy,
        source_kind, source_table, source_row_count, summary_text, summary_json, metrics_json,
        provider, model_key, status, source_url, compacted_at_epoch, created_at_epoch, updated_at_epoch
      ) VALUES (?, ?, ?, ?, 'data_summary', 'workspace', 'summarize', 'cron', 'gmail_inbox',
        ?, ?, ?, ?, 'google', ?, 'completed', ?, unixepoch(), unixepoch(), unixepoch())`,
    ).bind(
      compactionId,
      tenantId,
      ws,
      userId || null,
      triageBatch?.items?.length || 0,
      `${mode} memory ${dateIso}`,
      JSON.stringify({ triage: triageBatch, models }),
      JSON.stringify({ mode, dateIso, r2Key, emailSkipped: !!p.emailSkipped }),
      String(models?.synthesis || models?.pro || ''),
      r2Url,
    ).run();
  } catch (e) {
    errors.push(`agentsam_compaction_events:${e?.message}`);
  }

  const memoryKeyBase = userId ? `daily_memory/${userId}/${dateIso}` : `daily_memory/${dateIso}`;
  const chunks = chunkMarkdown(md, 900, 100);
  let embedded = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      await writeMemoryLane(env, {
        workspace_id: ws,
        user_id: userId || null,
        memory_key: `${memoryKeyBase}#${i}`,
        title: `Daily Memory ${dateIso} (${mode}) #${i}`,
        content: chunks[i],
        source: 'daily_memory_pipeline',
        source_type: 'daily_digest',
        metadata: { date: dateIso, pass: mode, chunk: i, r2_key: r2Key, user_id: userId || null },
      });
      embedded += 1;
    } catch (e) {
      errors.push(`memory_lane_${i}:${e?.message}`);
    }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO vectorize_indexed_docs (
        id, tenant_id, index_id, source_table, source_r2_key, chunk_index, content_preview, indexed_at, is_current
      ) VALUES (?, ?, 'agentsam-memory-oai3large-1536', 'daily_memory_pipeline', ?, ?, ?, datetime('now'), 1)
      ON CONFLICT(id) DO UPDATE SET
        source_r2_key = excluded.source_r2_key,
        chunk_index = excluded.chunk_index,
        content_preview = excluded.content_preview,
        indexed_at = excluded.indexed_at,
        is_current = 1`,
    ).bind(
      `vid_daily${uidSuffix}_${dateIso.replace(/-/g, '')}`,
      tenantId,
      r2Key,
      embedded,
      md.slice(0, 240),
    ).run();
  } catch {
    /* optional registry */
  }

  return { r2Key, r2Url, planId, embedded, errors };
}

/** @param {*} env @param {{ subject: string, textBody: string, htmlBody: string, toEmail: string, fromEmail: string }} p */
async function sendResendEmail(env, p) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: p.fromEmail,
      to: [p.toEmail],
      subject: p.subject,
      text: p.textBody,
      html: p.htmlBody,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new DailyPlanError(`Resend: ${res.status} ${err}`, { stage: 'resend', model: '' });
  }
  const data = await res.json().catch(() => ({}));
  if (env.DB) {
    await logAndArchiveSentEmail(env, {
      to: p.toEmail,
      from: p.fromEmail,
      subject: p.subject,
      html: p.htmlBody,
      text: p.textBody,
      status: 'sent',
      externalMessageId: data.id ?? null,
      provider: 'resend',
      userId: p.userId || null,
      tenantId: p.tenantId || null,
    });
  }
  return data;
}

/**
 * @param {*} env
 * @param {{ mode: 'evening'|'morning', ctx?: ExecutionContext|null, forceEmail?: boolean, recipient?: { userId?: string, email?: string, tenantId?: string|null, hasGmail?: boolean } }} opts
 */
export async function runDailyMemoryPipeline(env, opts) {
  const mode = opts.mode === 'morning' ? 'morning' : 'evening';
  if (!env?.DB || !env?.RESEND_API_KEY) {
    return { ok: false, skipped: true, reason: 'missing_db_or_resend' };
  }
  if (!env.RESEND_FROM?.trim()) {
    return { ok: false, skipped: true, reason: 'missing_resend_from' };
  }

  const fallback = await resolveDailyPlanNotifyUser(env);
  const recipient = opts.recipient || fallback;
  const userId = recipient?.userId ? String(recipient.userId).trim() : '';
  const deliverTo = recipient?.email ? String(recipient.email).trim().toLowerCase() : '';
  if (!userId || !deliverTo.includes('@')) {
    return { ok: false, skipped: true, reason: 'missing_recipient' };
  }

  const owner = { userId, email: deliverTo };
  const tid = recipient?.tenantId || await resolveCronTenantId(env, owner);
  if (!tid) {
    return { ok: false, skipped: true, reason: 'missing_tenant' };
  }

  const pipelineWorkspaceId = (await resolveCronWorkspaceId(env)) || '';
  if (!pipelineWorkspaceId) {
    return { ok: false, skipped: true, reason: 'platform_d1_workspace_id_required' };
  }

  const cronExpr = mode === 'evening' ? '0 0 * * *' : '30 13 * * *';
  const jobName = mode === 'evening' ? 'evening_memory_email' : 'morning_focus_email';
  const jobNameScoped = `${jobName}:${userId}`;

  const begun = await startCronRun(env, {
    jobName: jobNameScoped,
    cronExpression: cronExpr,
    tenantId: tid,
    workspaceId: pipelineWorkspaceId,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  const dateIso = chicagoDateIso();
  const dateDisplay = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Chicago',
  });
  const r2Key = memoryR2Key(dateIso, userId);
  const partial = { r2: false, d1: false, embed: false, email: false };
  let synthesisFailed = false;
  let agentConfig;

  try {
    try {
      agentConfig = await resolveDailyMemoryAgentConfig(env);
    } catch (cfgErr) {
      const wrapped = cfgErr instanceof DailyPlanError
        ? cfgErr
        : new DailyPlanError(String(cfgErr?.message || cfgErr), {
          stage: cfgErr?.stage || 'agent_profile',
          model: cfgErr?.model || '',
        });
      throw wrapped;
    }

    const gmailSnapshot = await snapshotGmailInboxForUser(env, {
      email: owner.email,
      userId: owner.userId,
      maxPerAccount: GMAIL_MAX_PER_ACCOUNT,
      searchAnywhere: true,
      hoursBack: mode === 'evening' ? 24 : undefined,
      sinceMidnightChicago: mode === 'morning',
    });

    const triageBatch = await triageEmailsParallel(env, gmailSnapshot.emails || [], {
      modelKey: agentConfig.apiModel,
    });

    if (runId) {
      await logCronTriageBatch(env, {
        runId,
        tenantId: tid,
        workspaceId: pipelineWorkspaceId,
        userId: owner.userId,
        items: triageBatch.items,
      });
    }

    const digestScope = await resolveDailyDigestScope(env, owner);
    const ctxData = await gatherMorningPlanContext(env, tid, owner, digestScope);
    try {
      const rawActivity = await collectDailyCodeActivity(env, digestScope, { hours: 24 });
      ctxData.dailyCodeActivity = dailyCodeActivityForDigest(rawActivity);
    } catch (codeErr) {
      ctxData.dailyCodeActivity = dailyCodeActivityForDigest({
        available: false,
        reason: String(codeErr?.message || codeErr).slice(0, 200),
      });
    }

    const existingMd = await readAutoragText(env, r2Key);
    const yesterdayIso = chicagoDateIso(new Date(Date.now() - 86400000));
    const yesterdayMd = await readAutoragText(env, memoryR2Key(yesterdayIso, userId));

    let sectionBody;
    try {
      sectionBody = mode === 'evening'
        ? await synthesizeEveningMd(env, { triageBatch, ctxData, dateIso, dateDisplay, agentConfig })
        : await synthesizeMorningMd(env, {
          triageBatch,
          ctxData,
          priorMd: '',
          yesterdayMd,
          dateIso,
          dateDisplay,
          agentConfig,
        });
    } catch (synthErr) {
      synthesisFailed = true;
      console.error(
        `[daily-memory/${mode}] synthesis failed after retry, falling back to partial digest`,
        synthErr?.message ?? synthErr,
      );
      sectionBody = buildPartialDigestMd(triageBatch, mode, ctxData.dailyCodeActivity);
    }

    const fullMd = mergeDailyMemoryMd(dateIso, existingMd, mode, sectionBody);
    partial.r2 = true;

    const persist = await persistMemoryArtifacts(env, {
      mode,
      md: fullMd,
      dateIso,
      tenantId: tid,
      userId: owner.userId,
      r2Key,
      triageBatch,
      models: {
        synthesis: agentConfig.apiModel,
        triage: agentConfig.apiModel,
        profile_slug: agentConfig.slug,
        profile_id: agentConfig.profileId,
      },
    });
    partial.d1 = true;
    partial.embed = persist.embedded > 0;

    const subject = mode === 'evening'
      ? `Your Evening Digest — ${dateDisplay}`
      : `Your Morning Focus — ${dateDisplay}`;

    if (!opts.forceEmail) {
      const dup = await env.DB.prepare(
        `SELECT id FROM email_logs WHERE subject = ? AND lower(to_email) = ? AND status = 'sent'
         AND datetime(created_at) >= datetime('now', '-20 hours') LIMIT 1`,
      ).bind(subject, deliverTo).first().catch(() => null);
      if (dup?.id) {
        if (runId) {
          await completeCronRun(env, runId, startedAt, {
            rowsRead: triageBatch.items?.length || 0,
            rowsWritten: persist.embedded,
            metadata: {
              sent: false,
              skipped_duplicate: true,
              r2Key,
              to_email: deliverTo,
              user_id: userId,
              partial,
              synthesis_failed: synthesisFailed,
            },
          });
        }
        return { ok: true, skipped_email: true, r2Key, md: fullMd, persist, userId, toEmail: deliverTo };
      }
    }

    const htmlBody = brandedEmailHtml({
      variant: mode,
      title: mode === 'evening' ? 'Evening Digest' : 'Morning Focus',
      subtitle: dateDisplay,
      md: fullMd,
    });

    await sendResendEmail(env, {
      subject,
      textBody: fullMd,
      htmlBody,
      toEmail: deliverTo,
      fromEmail: env.RESEND_FROM.trim(),
      userId: owner.userId,
      tenantId: tid,
    });
    partial.email = true;

    // Mirror into the in-app notifications spine so home Recent activity / status bar see digests.
    try {
      const { insertPushNotification } =
        await import('../identity/web-push-runtime.js');
      await insertPushNotification(env, {
        recipientId: String(owner.userId || userId),
        channel: 'email',
        subject,
        message: String(fullMd || '').slice(0, 500),
        entityType: 'daily_digest',
        entityId: r2Key || dateDisplay,
        status: 'sent',
        data: { mode, to_email: deliverTo, r2_key: r2Key || null },
      });
    } catch (e) {
      console.warn('[daily-digest] notifications mirror failed', e?.message ?? e);
    }

    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: triageBatch.items?.length || 0,
        rowsWritten: persist.embedded + 1,
        metadata: {
          sent: true,
          mode,
          r2Key,
          to_email: deliverTo,
          user_id: userId,
          gmail_query: gmailSnapshot.query || null,
          gmail_accounts: gmailSnapshot.accounts?.length || 0,
          inbox_count: gmailSnapshot.emails?.length || 0,
          embed_chunks: persist.embedded,
          persist_errors: persist.errors,
          synthesis_failed: synthesisFailed,
        },
      });
    }

    await alertDailyPlan(env, {
      ok: true,
      title: mode === 'evening' ? 'Evening memory sent' : 'Morning brief sent',
      body: `${subject} → ${deliverTo} · R2 ${r2Key}${synthesisFailed ? ' · Pro synthesis failed — partial digest sent' : ''}`,
      userId: owner.userId,
      tenantId: tid,
      tag: mode === 'evening' ? 'evening-memory-ok' : 'morning-focus-ok',
    }, opts.ctx ?? null);

    return {
      ok: true,
      sent: true,
      mode,
      r2Key,
      md: fullMd,
      persist,
      partial,
      synthesisFailed,
      userId,
      toEmail: deliverTo,
      gmail_count: gmailSnapshot.emails?.length || 0,
    };
  } catch (err) {
    if (runId) await failCronRun(env, runId, startedAt, err);
    const stage = err instanceof DailyPlanError || err instanceof DailyMemoryAgentConfigError
      ? err.stage
      : 'daily_memory_pipeline';
    const model = err instanceof DailyPlanError || err instanceof DailyMemoryAgentConfigError
      ? err.model
      : '';
    const msg = String(err?.message || err);
    console.error(`[daily-memory/${mode}] FATAL:`, msg, err?.stack);

    await alertDailyPlan(env, {
      ok: false,
      title: `[FAIL] Daily memory ${mode} — ${stage}${model ? ` (${model})` : ''}`,
      body: `${msg}\n\nPartial: ${JSON.stringify(partial)}`,
      userId: owner.userId,
      tenantId: tid,
      tag: `daily-memory-${mode}-fail`,
    }, opts.ctx ?? null);

    if (partial.r2) {
      return { ok: false, partial: true, error: msg, partialState: partial };
    }
    throw err;
  }
}

/** @param {*} env @param {{ mode: 'evening'|'morning', ctx?: ExecutionContext|null, forceEmail?: boolean }} opts */
export async function runDailyMemoryPipelineAllRecipients(env, opts) {
  const recipients = await listDailyMemoryRecipients(env);
  if (!recipients.length) {
    return { ok: false, skipped: true, reason: 'no_recipients' };
  }

  const results = [];
  for (const recipient of recipients) {
    try {
      const out = await runDailyMemoryPipeline(env, { ...opts, recipient });
      results.push({ userId: recipient.userId, email: recipient.email, ...out });
    } catch (err) {
      results.push({
        userId: recipient.userId,
        email: recipient.email,
        ok: false,
        error: String(err?.message || err),
      });
    }
  }

  const sent = results.filter((r) => r.sent).length;
  return { ok: true, recipients: results.length, sent, results };
}

/** @param {*} env @param {ExecutionContext|null} [ctx] */
export async function sendEveningMemoryEmail(env, ctx = null) {
  return runDailyMemoryPipelineAllRecipients(env, { mode: 'evening', ctx, forceEmail: false });
}

/** @param {*} env @param {ExecutionContext|null} [ctx] @param {{ forceEmail?: boolean }} [opts] */
export async function sendMorningFocusEmail(env, ctx = null, opts = {}) {
  return runDailyMemoryPipelineAllRecipients(env, {
    mode: 'morning',
    ctx,
    forceEmail: !!opts.forceEmail,
  });
}

/** Back-compat midnight cron entry */
export async function sendDailyDigest(env) {
  return sendEveningMemoryEmail(env);
}
