import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    __SUPABASE_URL__?: string;
    __SUPABASE_ANON_KEY__?: string;
    /** Single GoTrueClient across dashboard chunks / HMR (avoids duplicate instance warning). */
    __IAM_SUPABASE_CLIENT__?: SupabaseClient;
  }
}

/** Build-time (Vite define / SUPABASE_* from .env.cloudflare) or runtime /api/config/client */
function resolveBuildCredentials(): { url: string; anonKey: string } | null {
  const url = String(import.meta.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

let _client: SupabaseClient | null = null;
let _bootstrapPromise: Promise<SupabaseClient | null> | null = null;
let _warnedMissing = false;

export function setSupabaseBootstrap(url: string, anonKey: string): void {
  const u = url.trim().replace(/\/$/, '');
  const k = anonKey.trim();
  if (typeof window !== 'undefined') {
    window.__SUPABASE_URL__ = u;
    window.__SUPABASE_ANON_KEY__ = k;
  }
}

function readBootstrapCredentials(): { url: string; anonKey: string } | null {
  const fromBuild = resolveBuildCredentials();
  if (fromBuild) return fromBuild;
  if (typeof window === 'undefined') return null;
  const url = String(window.__SUPABASE_URL__ || '').trim().replace(/\/$/, '');
  const anonKey = String(window.__SUPABASE_ANON_KEY__ || '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

function attachClient(url: string, anonKey: string): SupabaseClient {
  if (typeof window !== 'undefined' && window.__IAM_SUPABASE_CLIENT__) {
    _client = window.__IAM_SUPABASE_CLIENT__;
    return _client;
  }
  if (!_client) {
    _client = createClient(url, anonKey, {
      auth: {
        storageKey: 'iam-dashboard-auth',
        persistSession: true,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 2 } },
    });
    if (typeof window !== 'undefined') {
      window.__IAM_SUPABASE_CLIENT__ = _client;
    }
  }
  return _client;
}

const built = resolveBuildCredentials();
if (built) {
  setSupabaseBootstrap(built.url, built.anonKey);
  attachClient(built.url, built.anonKey);
}

type ClientConfigJson = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabase_url?: string;
  supabase_anon_key?: string;
};

function parseClientConfig(cfg: ClientConfigJson): { url: string; anonKey: string } | null {
  const url = String(cfg.supabaseUrl ?? cfg.supabase_url ?? '')
    .trim()
    .replace(/\/$/, '');
  const anonKey = String(cfg.supabaseAnonKey ?? cfg.supabase_anon_key ?? '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Session-backed bootstrap when build omitted VITE_* (uses Worker SUPABASE_URL + SUPABASE_ANON_KEY).
 */
export async function bootstrapSupabaseFromSession(): Promise<SupabaseClient | null> {
  if (_client) return _client;
  if (_bootstrapPromise) return _bootstrapPromise;

  _bootstrapPromise = (async () => {
    const existing = readBootstrapCredentials();
    if (existing) return attachClient(existing.url, existing.anonKey);

    try {
      const res = await fetch('/api/config/client', { credentials: 'same-origin' });
      if (res.ok) {
        const cfg = (await res.json()) as ClientConfigJson;
        const parsed = parseClientConfig(cfg);
        if (parsed) {
          setSupabaseBootstrap(parsed.url, parsed.anonKey);
          return attachClient(parsed.url, parsed.anonKey);
        }
      }
    } catch {
      /* non-fatal */
    }

    if (!_warnedMissing) {
      _warnedMissing = true;
      console.warn(
        '[supabase] No build-time credentials and /api/config/client unavailable — realtime disabled until login',
      );
    }
    return null;
  })();

  return _bootstrapPromise;
}

/** Sync handle — null until build creds or bootstrapSupabaseFromSession() completes. */
export const supabase: SupabaseClient | null = _client;

export function getSupabaseClient(): SupabaseClient | null {
  return _client;
}
