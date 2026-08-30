/**
 * Dashboard mirror of src/core/browser-embed-policy.js.
 * Seed suffixes give a sync fast path; resolveEmbedModeRemote consults the
 * D1-backed policy endpoint (with live XFO probe) for everything else.
 */
// guard-dup-allow: SPA workbench copy of backend/browser/policy/embed.js (browser-frontend cannot import backend/)

export const BROWSER_RUN_REQUIRED_HOST_SUFFIXES = [
  'stripe.com',
  'dash.cloudflare.com',
] as const;

export const BROWSER_TRUST_STRIPE_ORIGINS = [
  'https://dashboard.stripe.com',
  'https://connect.stripe.com',
  'https://docs.stripe.com',
] as const;

export type EmbedMode = 'browser_run' | 'passive' | 'blocked';

function hostFromUrl(urlOrOrigin: string): string | null {
  const raw = String(urlOrOrigin || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Exact host or dot-boundary subdomain match. */
export function matchesHostSuffix(host: string, suffix: string): boolean {
  const h = String(host || '').toLowerCase();
  const s = String(suffix || '').toLowerCase();
  if (!h || !s) return false;
  return h === s || h.endsWith(`.${s}`);
}

/** Sync seed-only check (no network). */
export function originRequiresBrowserRunEmbed(urlOrOrigin: string): boolean {
  const host = hostFromUrl(urlOrOrigin);
  if (!host) return false;
  return BROWSER_RUN_REQUIRED_HOST_SUFFIXES.some((suffix) => matchesHostSuffix(host, suffix));
}

export function normalizeBrowserOrigin(urlOrOrigin: string): string | null {
  const raw = String(urlOrOrigin || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

/** Per-tab cache of definitive server answers (d1 / seed / probe). */
const embedModeCache = new Map<string, EmbedMode>();

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    (typeof window !== 'undefined' && host === window.location.hostname.toLowerCase())
  );
}

/**
 * Full policy resolution: seeds -> local fast paths -> server endpoint
 * (D1 row, else live XFO/frame-ancestors probe, self-healing upsert).
 * Fails open to 'passive' — never blocks navigation on endpoint trouble.
 */
/** Async: true when embed policy requires Browser Run (not passive iframe). */
export async function requiresBrowserRunEmbed(urlOrOrigin: string): Promise<boolean> {
  return (await resolveEmbedModeRemote(urlOrOrigin)) === 'browser_run';
}

export async function resolveEmbedModeRemote(urlOrOrigin: string): Promise<EmbedMode> {
  if (originRequiresBrowserRunEmbed(urlOrOrigin)) return 'browser_run';
  const host = hostFromUrl(urlOrOrigin);
  if (!host || isLocalHost(host)) return 'passive';
  const raw = String(urlOrOrigin || '').trim();
  if (/^(blob:|data:|about:)/i.test(raw)) return 'passive';

  const cached = embedModeCache.get(host);
  if (cached) return cached;

  try {
    const target = raw.startsWith('http') ? raw : `https://${raw}`;
    const r = await fetch(
      `/api/agentsam/browser/embed-policy?url=${encodeURIComponent(target)}`,
      { credentials: 'same-origin' },
    );
    const d = (await r.json().catch(() => ({}))) as { embed_mode?: string; source?: string };
    const mode: EmbedMode =
      d.embed_mode === 'browser_run' || d.embed_mode === 'blocked' ? d.embed_mode : 'passive';
    if (r.ok && d.source && d.source !== 'default') embedModeCache.set(host, mode);
    return mode;
  } catch {
    return 'passive';
  }
}
