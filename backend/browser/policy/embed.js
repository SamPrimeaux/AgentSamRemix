/**
 * Browser embed policy — which origins can render in a passive iframe vs require
 * Browser Run live view (X-Frame-Options / CSP frame-ancestors blockers).
 *
 * Resolution order (server side, see backend/http/browser/embed-policy.js):
 *   1. D1 `agentsam_browser_embed_policy` (operator overrides + probe results)
 *   2. Hardcoded seed suffixes below (zero-latency fallback, mirrored to dashboard)
 *   3. Live header probe (probeEmbedMode) — definitive results upserted back into D1
 *
 * All D1 access here is non-fatal: DB missing or query failure falls back to seeds.
 * Dashboard mirror: app/dashboard/src/lib/browserEmbedPolicy.ts
 */

/** @type {readonly string[]} */
export const BROWSER_RUN_REQUIRED_HOST_SUFFIXES = [
  'stripe.com',
  'dash.cloudflare.com',
];

/** @type {readonly string[]} */
export const BROWSER_TRUST_STRIPE_ORIGINS = [
  'https://dashboard.stripe.com',
  'https://connect.stripe.com',
  'https://docs.stripe.com',
];

/** @type {readonly string[]} */
export const EMBED_MODES = ['browser_run', 'passive', 'blocked'];

/**
 * @param {string} urlOrOrigin
 * @returns {string|null} lowercase hostname or null
 */
export function hostFromUrl(urlOrOrigin) {
  const raw = String(urlOrOrigin || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Exact host or dot-boundary subdomain match ('stripe.com' matches
 * 'stripe.com' and 'dashboard.stripe.com', never 'notstripe.com').
 * @param {string} host
 * @param {string} suffix
 * @returns {boolean}
 */
export function matchesHostSuffix(host, suffix) {
  const h = String(host || '').toLowerCase();
  const s = String(suffix || '').toLowerCase();
  if (!h || !s) return false;
  return h === s || h.endsWith(`.${s}`);
}

/**
 * Seed-only check (no D1, no probe). Sync fast path for callers that
 * cannot await; full policy resolution lives in the API handler.
 * @param {string} urlOrOrigin
 * @returns {boolean}
 */
export function originRequiresBrowserRunEmbed(urlOrOrigin) {
  const host = hostFromUrl(urlOrOrigin);
  if (!host) return false;
  return BROWSER_RUN_REQUIRED_HOST_SUFFIXES.some((suffix) => matchesHostSuffix(host, suffix));
}

/**
 * @param {string} urlOrOrigin
 * @returns {string|null}
 */
export function normalizeBrowserOrigin(urlOrOrigin) {
  const raw = String(urlOrOrigin || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

let embedPolicyTableEnsured = false;

/**
 * CREATE TABLE IF NOT EXISTS + seed rows. Non-fatal; runs once per isolate.
 * Mirrors migrations/900_agentsam_browser_embed_policy.sql so the feature
 * works even before the migration is applied.
 * @param {object} env
 * @returns {Promise<boolean>} table usable
 */
export async function ensureEmbedPolicyTable(env) {
  if (!env?.DB) return false;
  if (embedPolicyTableEnsured) return true;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS agentsam_browser_embed_policy (
        host_suffix TEXT PRIMARY KEY,
        embed_mode TEXT NOT NULL DEFAULT 'browser_run'
          CHECK (embed_mode IN ('browser_run','passive','blocked')),
        source TEXT NOT NULL DEFAULT 'manual',
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ).run();
    for (const suffix of BROWSER_RUN_REQUIRED_HOST_SUFFIXES) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO agentsam_browser_embed_policy (host_suffix, embed_mode, source, note)
         VALUES (?, 'browser_run', 'seed', 'hardcoded seed mirror')`,
      )
        .bind(suffix)
        .run();
    }
    embedPolicyTableEnsured = true;
    return true;
  } catch (err) {
    console.log('[embed-policy] ensure_failed', String(err).slice(0, 200));
    return false;
  }
}

/**
 * D1 lookup — longest-suffix match wins (so a 'dash.cloudflare.com' row beats
 * a hypothetical 'cloudflare.com' row). Non-fatal; null on any failure.
 * @param {object} env
 * @param {string} host
 * @returns {Promise<{host_suffix: string, embed_mode: string, source: string}|null>}
 */
export async function resolveEmbedModeFromD1(env, host) {
  if (!env?.DB || !host) return null;
  try {
    const { results } = await env.DB.prepare(
      'SELECT host_suffix, embed_mode, source FROM agentsam_browser_embed_policy LIMIT 1000',
    ).all();
    const rows = Array.isArray(results) ? results : [];
    let best = null;
    for (const row of rows) {
      const suffix = String(row.host_suffix || '').toLowerCase();
      if (!matchesHostSuffix(host, suffix)) continue;
      if (!best || suffix.length > String(best.host_suffix).length) best = row;
    }
    return best;
  } catch (err) {
    console.log('[embed-policy] d1_lookup_failed', String(err).slice(0, 200));
    return null;
  }
}

/**
 * Upsert a policy row. Non-fatal.
 * @param {object} env
 * @param {{ hostSuffix: string, embedMode: string, source?: string, note?: string|null }} row
 * @returns {Promise<boolean>}
 */
export async function upsertEmbedPolicy(env, { hostSuffix, embedMode, source = 'manual', note = null }) {
  const suffix = String(hostSuffix || '').trim().toLowerCase();
  const mode = String(embedMode || '').trim().toLowerCase();
  if (!suffix || !EMBED_MODES.includes(mode)) return false;
  if (!(await ensureEmbedPolicyTable(env))) return false;
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_browser_embed_policy (host_suffix, embed_mode, source, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT (host_suffix) DO UPDATE SET
         embed_mode = excluded.embed_mode,
         source = excluded.source,
         note = excluded.note,
         updated_at = datetime('now')`,
    )
      .bind(suffix, mode, source, note)
      .run();
    return true;
  } catch (err) {
    console.log('[embed-policy] upsert_failed', String(err).slice(0, 200));
    return false;
  }
}

/**
 * Probe a URL's frame-embedding headers (X-Frame-Options / CSP frame-ancestors).
 * HEAD first, GET fallback for servers that reject HEAD. Never throws.
 * frame-ancestors that is anything other than '*' counts as browser_run —
 * the dashboard origin will never be in a third party's allow list.
 * @param {string} targetUrl
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, embed_mode?: string, header?: string|null, status?: number, error?: string }>}
 */
export async function probeEmbedMode(targetUrl, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 3500;
  const url = String(targetUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'invalid_url' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = null;
    try {
      res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    } catch {
      res = null;
    }
    if (!res || res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    }
    const xfo = String(res.headers.get('x-frame-options') || '').trim();
    if (xfo) {
      return { ok: true, embed_mode: 'browser_run', header: `x-frame-options: ${xfo}`.slice(0, 160), status: res.status };
    }
    const csp = String(res.headers.get('content-security-policy') || '');
    const fa = csp.match(/frame-ancestors\s+([^;]+)/i);
    if (fa) {
      const sources = fa[1].trim().toLowerCase();
      if (sources !== '*') {
        return { ok: true, embed_mode: 'browser_run', header: `frame-ancestors ${sources}`.slice(0, 160), status: res.status };
      }
    }
    return { ok: true, embed_mode: 'passive', header: null, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.name === 'AbortError' ? 'probe_timeout' : err).slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
}
