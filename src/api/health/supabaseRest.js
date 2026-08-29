/**
 * Minimal Supabase PostgREST helpers for health routes (service role, no PII in logs).
 */

/** @param {any} env */
export function supabaseRestBase(env) {
  const raw = env?.SUPABASE_URL;
  if (!raw || !String(raw).trim()) return '';
  return String(raw).replace(/\/$/, '');
}

/** @param {any} env */
export function supabaseServiceKey(env) {
  const k = env?.SUPABASE_SERVICE_ROLE_KEY;
  return k && String(k).trim() ? String(k).trim() : '';
}

/**
 * @param {any} env
 * @param {'public' | 'agentsam'} schema
 */
export function supabaseHeaders(env, schema = 'public') {
  const key = supabaseServiceKey(env);
  const h = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
  if (schema === 'agentsam') {
    h['Accept-Profile'] = 'agentsam';
    h['Content-Profile'] = 'agentsam';
  }
  return h;
}

/**
 * @param {any} env
 * @param {string} pathWithQuery e.g. "/rest/v1/foo?limit=1"
 * @param {'public' | 'agentsam'} schema
 */
export async function supabaseGetJson(env, pathWithQuery, schema = 'public') {
  const base = supabaseRestBase(env);
  const key = supabaseServiceKey(env);
  if (!base || !key) return { ok: false, status: 0, data: null };
  const url = `${base}${pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`}`;
  try {
    const res = await fetch(url, { headers: supabaseHeaders(env, schema) });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * @param {any} env
 * @param {string} pathWithQuery
 * @param {unknown} body
 * @param {'public' | 'agentsam'} schema
 */
export async function supabasePostJson(env, pathWithQuery, body, schema = 'agentsam') {
  const base = supabaseRestBase(env);
  const key = supabaseServiceKey(env);
  if (!base || !key) return { ok: false, status: 0, data: null };
  const url = `${base}${pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(env, schema),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * PATCH a single row by primary key filter (PostgREST).
 * @param {any} env
 * @param {string} table
 * @param {string} idColumn
 * @param {string} idValue
 * @param {Record<string, unknown>} patch
 * @param {'public' | 'agentsam'} schema
 */
export async function supabasePatchJson(env, table, idColumn, idValue, patch, schema = 'public') {
  const base = supabaseRestBase(env);
  const key = supabaseServiceKey(env);
  if (!base || !key) return { ok: false, status: 0, data: null };
  const t = encodeURIComponent(String(table));
  const col = encodeURIComponent(String(idColumn));
  const val = encodeURIComponent(String(idValue));
  const url = `${base}/rest/v1/${t}?${col}=eq.${val}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...supabaseHeaders(env, schema),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * Upsert by primary key `id` (requires unique constraint on id).
 * @param {any} env
 * @param {string} table
 * @param {Record<string, unknown>} row
 * @param {'public' | 'agentsam'} schema
 */
export async function supabaseUpsertJson(env, table, row, schema = 'public') {
  const base = supabaseRestBase(env);
  const key = supabaseServiceKey(env);
  if (!base || !key) return { ok: false, status: 0, data: null };
  const t = encodeURIComponent(String(table));
  const url = `${base}/rest/v1/${t}?on_conflict=id`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(env, schema),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * DELETE by primary key.
 * @param {any} env
 * @param {string} table
 * @param {string} idColumn
 * @param {string} idValue
 * @param {'public' | 'agentsam'} schema
 */
export async function supabaseDeleteJson(env, table, idColumn, idValue, schema = 'public') {
  const base = supabaseRestBase(env);
  const key = supabaseServiceKey(env);
  if (!base || !key) return { ok: false, status: 0, data: null };
  const t = encodeURIComponent(String(table));
  const col = encodeURIComponent(String(idColumn));
  const val = encodeURIComponent(String(idValue));
  const url = `${base}/rest/v1/${t}?${col}=eq.${val}`;
  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...supabaseHeaders(env, schema),
        Prefer: 'return=minimal',
      },
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
