/** Ad-hoc agent/browser captures (not branded quality reports). */
export const PLAYWRIGHT_AGENT_SCREENSHOT_PREFIX = 'screenshots/agent/';

/** Branded IAM Playwright quality reports on ASSETS (inneranimalmedia). */
export const QUALITY_REPORT_R2_PREFIX = 'reports/quality-report/';

export const IAM_PUBLIC_ORIGIN = 'https://inneranimalmedia.com';
export const IAM_ASSETS_PUBLIC_ORIGIN = 'https://assets.inneranimalmedia.com';

export function qualityReportStamp(d = new Date()) {
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19).replace(/:/g, '');
  return { date, time };
}

export function qualityReportR2Base(date, time) {
  return `${QUALITY_REPORT_R2_PREFIX}${date}/${time}`;
}

export function qualityReportPublicUrl(date, time, assetPath = '') {
  const base = `${IAM_PUBLIC_ORIGIN}/qualityreport/${date}/${time}`;
  if (!assetPath) return `${base}/`;
  return `${base}/${String(assetPath).replace(/^\/+/, '')}`;
}

export function agentScreenshotR2Key(id = crypto.randomUUID()) {
  return `${PLAYWRIGHT_AGENT_SCREENSHOT_PREFIX}${Date.now()}-${id}.png`;
}
