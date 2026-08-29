/**
 * Copy IAM-staged quality reports to user-owned storage (BYOK R2 / Google Drive manifest).
 * Platform bucket (inneranimalmedia/reports/quality-report/…) is the source of truth for IAM runs.
 */
import { mergeR2S3EnvFromUserStorage } from './user-storage-r2-credentials.js';
import { r2FetchObjectViaBindingOrS3, r2PutViaBindingOrS3 } from './r2.js';
import { getR2Binding } from '../api/r2-api.js';
import { getIntegrationToken } from '../integrations/tokens.js';
import { resolveOAuthAccessToken } from '../api/oauth.js';

const PLATFORM_REPORT_BUCKET = 'inneranimalmedia';

async function listAllObjectsUnderPrefix(binding, prefix) {
  const objects = [];
  if (!binding?.list) return objects;
  let cursor;
  do {
    const page = await binding.list({ prefix, limit: 1000, cursor });
    for (const o of page.objects || []) {
      if (o.key && !o.key.endsWith('/')) objects.push(o.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

function parseReportMetadata(row) {
  if (!row?.metadata_json) return {};
  try {
    const p = JSON.parse(String(row.metadata_json));
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

/**
 * @param {any} env
 * @param {object} authUser
 * @param {string} reportId - agentsam_quality_reports.id or report_id
 */
export async function loadQualityReportRow(env, reportId) {
  const id = String(reportId || '').trim();
  if (!id || !env?.DB) return null;
  return env.DB.prepare(
    `SELECT * FROM agentsam_quality_reports
     WHERE id = ? OR report_id = ?
     LIMIT 1`,
  )
    .bind(id, id)
    .first();
}

function userCanAccessReport(authUser, row) {
  if (!row) return false;
  if (Number(row.is_public) === 1 && String(row.scope || '') === 'platform') return true;
  const uid = String(authUser?.id || authUser?.user_id || '').trim();
  if (uid && row.user_id && String(row.user_id) === uid) return true;
  const ws = String(authUser?.workspace_id || '').trim();
  if (ws && row.workspace_id && String(row.workspace_id) === ws) return true;
  return false;
}

/**
 * Copy platform-staged report prefix to user's BYOK R2 bucket.
 */
export async function copyQualityReportToUserR2(env, authUser, row, { destBucket, destPrefix }) {
  const bucket = String(row.r2_bucket || PLATFORM_REPORT_BUCKET).trim();
  const prefix = String(row.r2_prefix || '').trim();
  if (!prefix.startsWith('reports/quality-report/')) {
    return { ok: false, error: 'Invalid report prefix' };
  }

  const userEnv = await mergeR2S3EnvFromUserStorage(env, authUser);
  if (!userEnv.R2_ACCESS_KEY_ID || !userEnv.R2_SECRET_ACCESS_KEY) {
    return { ok: false, error: 'Connect Cloudflare R2 keys in Storage settings (BYOK) first.' };
  }

  const destBucketName = String(destBucket || '').trim();
  if (!destBucketName) return { ok: false, error: 'dest_bucket required' };

  const destRoot = String(destPrefix || '').trim().replace(/\/+$/, '');
  const reportFolder = prefix.replace(/\/+$/, '').split('/').pop() || 'report';
  const destBase = destRoot ? `${destRoot}/${reportFolder}` : `quality-reports/${reportFolder}`;

  const binding = getR2Binding(env, bucket) || env.ASSETS;
  const keys = await listAllObjectsUnderPrefix(binding, prefix);
  if (!keys.length) return { ok: false, error: 'No report files found on platform storage' };

  let copied = 0;
  let bytes = 0;
  for (const key of keys) {
    const rel = key.slice(prefix.length);
    const destKey = `${destBase}/${rel}`.replace(/\/+/g, '/');
    const fetched = await r2FetchObjectViaBindingOrS3(env, binding, bucket, key);
    if (!fetched?.body) continue;
    const ct = fetched.contentType || 'application/octet-stream';
    const ok = await r2PutViaBindingOrS3(userEnv, null, destBucketName, destKey, fetched.body, ct);
    if (ok) {
      copied += 1;
      bytes += fetched.body.byteLength || 0;
    }
  }

  if (!copied) return { ok: false, error: 'Copy failed for all objects' };

  const userCopy = {
    destination: 'byok_r2',
    bucket: destBucketName,
    prefix: `${destBase}/`,
    copied_files: copied,
    bytes,
    copied_at: new Date().toISOString(),
  };

  const meta = parseReportMetadata(row);
  meta.user_copy = userCopy;
  await env.DB.prepare(
    `UPDATE agentsam_quality_reports SET metadata_json = ?, updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(JSON.stringify(meta), row.id)
    .run()
    .catch(() => {});

  return { ok: true, ...userCopy };
}

/**
 * Build download manifest for local save (client zips or fetches each file).
 */
export async function buildQualityReportDownloadManifest(env, authUser, row) {
  const bucket = String(row.r2_bucket || PLATFORM_REPORT_BUCKET).trim();
  const prefix = String(row.r2_prefix || '').trim();
  const binding = getR2Binding(env, bucket) || env.ASSETS;
  const keys = await listAllObjectsUnderPrefix(binding, prefix);
  const origin = String(env.IAM_ORIGIN || 'https://inneranimalmedia.com').replace(/\/$/, '');

  const files = keys.map((key) => {
    const rel = key.slice(prefix.length);
    return {
      key,
      path: rel,
      download_url: `${origin}${row.public_path}${rel}`,
    };
  });

  return {
    ok: true,
    destination: 'local',
    report_id: row.report_id,
    public_url: row.public_url,
    files,
    file_count: files.length,
    hint: 'Fetch each download_url from the browser session, or use Save to BYOK R2 / Google Drive.',
  };
}

export async function saveQualityReportForUser(env, authUser, body) {
  const reportId = String(body.report_id || body.id || '').trim();
  if (!reportId) return { ok: false, error: 'report_id required' };

  const row = await loadQualityReportRow(env, reportId);
  if (!row) return { ok: false, error: 'Report not found' };
  if (!userCanAccessReport(authUser, row)) return { ok: false, error: 'Forbidden' };

  const destination = String(body.destination || 'byok_r2').trim().toLowerCase();

  if (destination === 'local' || destination === 'download') {
    return buildQualityReportDownloadManifest(env, authUser, row);
  }

  if (destination === 'byok_r2') {
    return copyQualityReportToUserR2(env, authUser, row, {
      destBucket: body.dest_bucket || body.bucket,
      destPrefix: body.dest_prefix || body.prefix,
    });
  }

  if (destination === 'google_drive') {
    return {
      ok: false,
      error: 'Google Drive export for full reports: use local download manifest, then upload folder via Drive.',
      fallback: 'local',
    };
  }

  return { ok: false, error: 'destination must be byok_r2, local, or google_drive' };
}

export { userCanAccessReport, parseReportMetadata };
