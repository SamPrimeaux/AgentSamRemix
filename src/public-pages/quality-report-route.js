/**
 * Serve IAM branded quality reports from R2 (DASHBOARD / inneranimalmedia bucket).
 *
 * Routes:
 *   GET /qualityreport                          → redirect to today
 *   GET /qualityreport/YYYY-MM-DD               → latest run or day index
 *   GET /qualityreport/YYYY-MM-DD/HHMMSS        → index.html
 *   GET /qualityreport/YYYY-MM-DD/HHMMSS/*      → asset under reports/quality-report/…
 */

import { jsonResponse } from '../core/auth.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{6}$/;

function contentTypeForKey(key) {
  const k = key.toLowerCase();
  if (k.endsWith('.html')) return 'text/html; charset=utf-8';
  if (k.endsWith('.css')) return 'text/css; charset=utf-8';
  if (k.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (k.endsWith('.json')) return 'application/json; charset=utf-8';
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg';
  if (k.endsWith('.webp')) return 'image/webp';
  if (k.endsWith('.svg')) return 'image/svg+xml';
  if (k.endsWith('.webm')) return 'video/webm';
  if (k.endsWith('.mp4')) return 'video/mp4';
  if (k.endsWith('.zip')) return 'application/zip';
  if (k.endsWith('.txt') || k.endsWith('.md')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function r2KeyForReport(date, time, assetPath) {
  const base = `reports/quality-report/${date}/${time}`;
  if (!assetPath) return `${base}/index.html`;
  return `${base}/${assetPath.replace(/^\/+/, '')}`;
}

async function listReportsForDay(env, date) {
  if (!env?.DB) return [];
  const { results } = await env.DB.prepare(
    `SELECT id, report_id, report_time, public_url, public_path, uploaded_files, created_at
     FROM agentsam_quality_reports
     WHERE report_date = ? AND COALESCE(is_public, 1) = 1
     ORDER BY created_at DESC
     LIMIT 50`,
  )
    .bind(date)
    .all();
  return results || [];
}

function renderDayIndexHtml(origin, date, rows) {
  const items =
    rows.length === 0
      ? '<p class="muted">No reports registered for this day yet.</p>'
      : rows
          .map(
            (r) => `<li>
        <a href="${origin}/qualityreport/${date}/${r.report_time}/">
          <strong>${r.report_time}</strong>
        </a>
        <span class="muted"> — ${r.uploaded_files ?? 0} files</span>
      </li>`,
          )
          .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Quality reports — ${date}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;background:#020617;color:#f8fafc;font-family:Inter,system-ui,sans-serif;padding:48px}
a{color:#4ade80}
h1{text-transform:uppercase;letter-spacing:.08em}
.muted{color:#94a3b8}
ul{line-height:2}
</style>
</head>
<body>
<h1>Quality reports</h1>
<p class="muted">${date}</p>
<ul>${items}</ul>
</body>
</html>`;
}

/**
 * @param {Request} request
 * @param {object} env
 * @param {string} pathLower
 * @returns {Promise<Response|null>}
 */
export async function handleQualityReportRoute(request, env, pathLower) {
  if (!pathLower.startsWith('/qualityreport')) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const bucket = env.ASSETS;
  if (!bucket?.get) {
    return new Response('Quality reports storage unavailable', { status: 503 });
  }

  const url = new URL(request.url);
  const origin = url.origin;
  const rest = pathLower.replace(/^\/qualityreport\/?/, '');
  const parts = rest ? rest.split('/').filter(Boolean) : [];

  if (parts.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return Response.redirect(`${origin}/qualityreport/${today}`, 302);
  }

  const date = parts[0];
  if (!DATE_RE.test(date)) {
    return new Response('Invalid report date', { status: 400 });
  }

  let time = parts[1];
  let assetParts = parts.slice(2);

  if (!time) {
    const rows = await listReportsForDay(env, date);
    if (rows.length === 1) {
      return Response.redirect(`${origin}/qualityreport/${date}/${rows[0].report_time}/`, 302);
    }
    if (rows.length > 1) {
      const html = renderDayIndexHtml(origin, date, rows);
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
      });
    }
    const html = renderDayIndexHtml(origin, date, []);
    return new Response(html, {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (!TIME_RE.test(time)) {
    return new Response('Invalid report time (use HHMMSS)', { status: 400 });
  }

  const assetPath = assetParts.join('/');
  if (assetPath.includes('..')) {
    return new Response('Bad request', { status: 400 });
  }

  const key = r2KeyForReport(date, time, assetPath || null);
  const obj = await bucket.get(key);
  if (!obj) {
    return new Response('Report not found', { status: 404 });
  }

  const fromMeta = obj.httpMetadata?.contentType;
  const contentType = fromMeta || contentTypeForKey(key);
  const cacheControl = key.endsWith('index.html')
    ? 'public, max-age=120'
    : 'public, max-age=3600';

  if (request.method === 'HEAD') {
    return new Response(null, {
      headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl, 'X-R2-Key': key },
    });
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'X-Quality-Report-Date': date,
      'X-Quality-Report-Time': time,
    },
  });
}

/**
 * Register a report row after R2 upload (ingest secret or session).
 * @param {Request} request
 * @param {object} env
 * @param {object} authUser
 * @param {boolean} ingestBypass
 */
export async function handleQualityReportRegisterApi(request, env, authUser, ingestBypass) {
  if (!env?.DB) return jsonResponse({ error: 'DB unavailable' }, 503);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const reportDate = String(body.report_date || body.date || '').trim();
  const reportTime = String(body.report_time || body.time || '').trim();
  const r2Prefix = String(body.r2_prefix || body.prefix || '').trim().replace(/\/+$/, '') + '/';
  const r2Bucket = String(body.r2_bucket || body.bucket || '').trim();
  const reportId = String(body.report_id || `quality-report-${reportDate}-${reportTime}`).trim();
  const uploadedFiles = Number(body.uploaded_files) || 0;

  if (!DATE_RE.test(reportDate) || !TIME_RE.test(reportTime) || !r2Prefix.startsWith('reports/quality-report/')) {
    return jsonResponse({ error: 'report_date, report_time, and r2_prefix required' }, 400);
  }
  if (!r2Bucket) return jsonResponse({ error: 'r2_bucket_required' }, 400);

  const publicPath = `/qualityreport/${reportDate}/${reportTime}/`;
  const origin = String(env.IAM_ORIGIN || 'https://inneranimalmedia.com').replace(/\/$/, '');
  const publicUrl = String(body.public_url || `${origin}${publicPath}`).trim();

  const tenantId = body.tenant_id || authUser?.tenant_id || null;
  const workspaceId = body.workspace_id || authUser?.workspace_id || null;
  const userId = body.user_id || authUser?.id || authUser?.user_id || null;

  if (!ingestBypass && !authUser) {
    return jsonResponse({ error: 'unauthenticated' }, 401);
  }

  // Server-enforced scope: ingest secret → platform only; session auth → user only (ignore body.scope).
  const scope = ingestBypass ? 'platform' : 'user';
  const isPublic = ingestBypass ? 1 : 0;

  const id = String(body.id || `aqr_${reportDate.replace(/-/g, '')}_${reportTime}`).trim();
  const metadata = typeof body.metadata === 'object' ? body.metadata : {};
  metadata.scope = scope;

  const boundUserId = ingestBypass
    ? userId
    : authUser?.id || authUser?.user_id || null;
  const boundWorkspaceId = ingestBypass
    ? workspaceId
    : authUser?.workspace_id || null;
  const boundTenantId = ingestBypass
    ? tenantId
    : authUser?.tenant_id || null;

  await env.DB.prepare(
    `INSERT INTO agentsam_quality_reports (
      id, report_id, tenant_id, workspace_id, user_id,
      report_date, report_time, r2_bucket, r2_prefix,
      public_path, public_url, label, uploaded_files,
      scope, is_public, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quality-report', ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      public_url = excluded.public_url,
      public_path = excluded.public_path,
      r2_prefix = excluded.r2_prefix,
      uploaded_files = excluded.uploaded_files,
      scope = excluded.scope,
      is_public = excluded.is_public,
      metadata_json = excluded.metadata_json,
      updated_at = unixepoch()`,
  )
    .bind(
      id,
      reportId,
      boundTenantId,
      boundWorkspaceId,
      boundUserId,
      reportDate,
      reportTime,
      r2Bucket,
      r2Prefix,
      publicPath,
      publicUrl,
      uploadedFiles,
      scope,
      isPublic,
      JSON.stringify(metadata),
    )
    .run();

  return jsonResponse({
    ok: true,
    id,
    report_id: reportId,
    public_path: publicPath,
    public_url: publicUrl,
    r2_bucket: r2Bucket,
    r2_prefix: r2Prefix,
    scope,
    is_public: isPublic,
  });
}

/**
 * Save a platform-staged quality report to user storage (BYOK R2 or local manifest).
 */
export async function handleQualityReportSaveApi(request, env, authUser) {
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const { saveQualityReportForUser } = await import('../core/quality-report-user-export.js');
  const out = await saveQualityReportForUser(env, authUser, body);
  return jsonResponse(out, out.ok ? 200 : 400);
}
