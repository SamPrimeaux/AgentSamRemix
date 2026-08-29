/**
 * Async Playwright screenshot/render jobs from queue.
 * - Ad-hoc captures → ephemeral (no platform R2 by default)
 * - IAM quality reports → ASSETS reports/quality-report/ only when scope=platform
 */
import { assertBrowserTrustedOrigin } from '../policy/trust.js';
import {
  resolveBrowserScreenshotCapture,
  shouldPersistCaptureToPlatformR2,
} from '../capture/storage.js';
import {
  IAM_ASSETS_PUBLIC_ORIGIN,
  qualityReportPublicUrl,
  qualityReportR2Base,
  qualityReportStamp,
} from '../capture/r2-paths.js';

function parseJobMetadata(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isQualityReportJob(jobType, metadata) {
  if (jobType === 'quality_report') return true;
  return metadata?.quality_report === true || metadata?.report_kind === 'quality-report';
}

async function putQualityReportAssetToR2(env, buf, contentType, { date, time, filename }) {
  void contentType;
  void IAM_ASSETS_PUBLIC_ORIGIN;
  const bucket = env.ASSETS;
  if (!bucket) throw new Error('ASSETS R2 bucket required for quality reports');
  const name = String(filename || 'screenshot.png').replace(/^\/+/, '');
  const key = `${qualityReportR2Base(date, time)}/${name}`;
  await bucket.put(key, buf, { httpMetadata: { contentType: 'image/png' } });
  return {
    screenshot_url: qualityReportPublicUrl(date, time, name),
    r2_key: key,
    report_date: date,
    report_time: time,
  };
}

/**
 * @param {any} env
 * @param {{ jobId?: string, job_type?: string, url?: string, scope?: string }} body
 */
export async function handlePlaywrightQueueJob(env, body) {
  const { jobId, job_type, url } = body;
  if (!jobId || !env.MYBROWSER || !env.DB || !env.ASSETS) return;

  const jobType = String(job_type || '').trim();
  if (!['screenshot', 'render', 'quality_report'].includes(jobType)) return;

  const targetUrl = String(url || '').trim() || 'https://example.com';
  let userId = null;
  let workspaceId = null;
  let metadata = {};
  try {
    const row = await env.DB.prepare(
      'SELECT user_id, workspace_id, url, metadata FROM playwright_jobs WHERE id = ?',
    )
      .bind(jobId)
      .first();
    if (row?.user_id) userId = String(row.user_id);
    if (row?.workspace_id) workspaceId = String(row.workspace_id);
    metadata = parseJobMetadata(row?.metadata);
  } catch {
    /* non-fatal */
  }

  const qualityReport = isQualityReportJob(jobType, metadata);
  const platformPersist = shouldPersistCaptureToPlatformR2({
    scope: metadata.scope || body.scope,
    metadata,
    jobType,
  });

  if (userId) {
    try {
      await assertBrowserTrustedOrigin(env, {
        userId,
        workspaceId,
        origin: targetUrl,
      });
    } catch (err) {
      await env.DB.prepare("UPDATE playwright_jobs SET status='failed', error=? WHERE id=?")
        .bind(String(err?.message || err), jobId)
        .run();
      return;
    }
  }

  const { launch } = await import('@cloudflare/playwright');
  const browser = await launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
    let resultUrl = null;
    let resultMeta = null;

    if (jobType === 'screenshot' || jobType === 'quality_report') {
      const buf = await page.screenshot({ type: 'png', fullPage: true });
      if (qualityReport && platformPersist) {
        const stamp = qualityReportStamp();
        const date = String(metadata.report_date || stamp.date);
        const time = String(metadata.report_time || stamp.time);
        const out = await putQualityReportAssetToR2(env, buf, 'image/png', {
          date,
          time,
          filename: metadata.asset_name || 'screenshot.png',
        });
        resultUrl = out.screenshot_url;
        resultMeta = { ...out, scope: 'platform' };
      } else {
        const out = await resolveBrowserScreenshotCapture(env, buf, 'image/png', {
          scope: metadata.scope,
          metadata,
          jobType,
        });
        resultUrl = out.data_url || out.screenshot_url || null;
        resultMeta = out;
      }
    } else if (jobType === 'render') {
      const html = await page.content();
      if (qualityReport && platformPersist) {
        const stamp = qualityReportStamp();
        const date = String(metadata.report_date || stamp.date);
        const time = String(metadata.report_time || stamp.time);
        const key = `${qualityReportR2Base(date, time)}/render.html`;
        await env.ASSETS.put(key, html, { httpMetadata: { contentType: 'text/html' } });
        resultUrl = qualityReportPublicUrl(date, time, 'render.html');
        resultMeta = { r2_key: key, report_date: date, report_time: time, scope: 'platform' };
      } else if (env.SESSION_CACHE) {
        const captureId = `render_${jobId}`;
        await env.SESSION_CACHE.put(
          `browser_capture:${captureId}`,
          JSON.stringify({ content_type: 'text/html', html: html.slice(0, 500_000) }),
          { expirationTtl: 3600 },
        );
        resultUrl = null;
        resultMeta = { storage: 'ephemeral', capture_id: captureId, content_type: 'text/html' };
      }
    }

    await env.DB.prepare(
      "UPDATE playwright_jobs SET status='completed', result_url=?, completed_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(resultUrl, jobId)
      .run();

    if (resultMeta && env.DB) {
      await env.DB.prepare(`UPDATE playwright_jobs SET metadata = ? WHERE id = ?`)
        .bind(JSON.stringify({ ...metadata, ...resultMeta }), jobId)
        .run()
        .catch(() => {});
    }
  } catch (err) {
    await env.DB.prepare("UPDATE playwright_jobs SET status='failed', error=? WHERE id=?")
      .bind(String(err?.message || err), jobId)
      .run();
  } finally {
    await browser.close();
  }
}
