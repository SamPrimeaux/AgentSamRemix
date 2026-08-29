/**
 * Pure BYOK readiness derivation for actor authority snapshots.
 * No secret values — configured/validated flags only.
 */

import { apiKeyValidatedAtDisplay } from '../../../src/core/keys-security.js';
import { getUserR2Summary } from '../../credentials/cloudflare/r2-credentials.js';

/** @type {readonly string[]} */
export const BYOK_PROVIDER_SLUGS = [
  'openai',
  'anthropic',
  'google',
  'cloudflare',
  'github',
  'supabase',
];

const GOOGLE_ALIASES = new Set(['google', 'google_ai', 'gemini']);

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseMeta(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function rowValidated(row, meta) {
  return apiKeyValidatedAtDisplay(row, meta) != null;
}

/**
 * @param {Record<string, unknown>} readiness
 */
export function normalizeByokReadinessForHash(readiness = {}) {
  /** @type {Record<string, { configured: boolean, validated: boolean }>} */
  const providers = {};
  for (const slug of BYOK_PROVIDER_SLUGS) {
    const src =
      readiness?.providers?.[slug] && typeof readiness.providers[slug] === 'object'
        ? readiness.providers[slug]
        : {};
    providers[slug] = {
      configured: src.configured === true,
      validated: src.validated === true,
    };
  }
  const r2src =
    readiness?.r2 && typeof readiness.r2 === 'object' ? readiness.r2 : {};
  return {
    providers,
    r2: {
      configured: r2src.configured === true,
      validated: r2src.validated === true,
    },
  };
}

/**
 * @param {unknown} env
 * @param {{ userId: string, workspaceId: string, tenantId?: string|null }} scope
 */
export async function deriveByokReadiness(env, scope) {
  /** @type {Record<string, { configured: boolean, validated: boolean }>} */
  const providers = {};
  for (const slug of BYOK_PROVIDER_SLUGS) {
    providers[slug] = { configured: false, validated: false };
  }
  const r2 = { configured: false, validated: false };

  const uid = trim(scope.userId);
  const tid = trim(scope.tenantId);
  if (!env?.DB || !uid) {
    return { providers, r2 };
  }

  let rows = [];
  try {
    const tenantClause = tid
      ? 'AND (tenant_id IS NULL OR tenant_id = \'\' OR tenant_id = ?)'
      : '';
    const binds = [uid];
    if (tenantClause) binds.push(tid);

    const { results } = await env.DB.prepare(
      `SELECT id, service_name, metadata_json, last_used_at
         FROM user_secrets
        WHERE user_id = ?
          AND COALESCE(is_active, 1) = 1
          ${tenantClause}`,
    )
      .bind(...binds)
      .all();
    rows = results || [];
  } catch {
    rows = [];
  }

  for (const row of rows) {
    const meta = parseMeta(row.metadata_json);
    const service = trim(row.service_name).toLowerCase();
    let prov = trim(meta.provider || service).toLowerCase();
    if (GOOGLE_ALIASES.has(prov)) prov = 'google';
    if (prov === 'cloudflare_r2') continue;
    if (!providers[prov]) continue;

    providers[prov].configured = true;
    if (rowValidated(row, meta)) {
      providers[prov].validated = true;
    }
  }

  try {
    const summary = await getUserR2Summary(env, uid);
    if (summary?.id) {
      r2.configured = true;
      if (summary.validated_at != null && Number(summary.validated_at) > 0) {
        r2.validated = true;
      }
    }
  } catch {
    /* ignore */
  }

  return { providers, r2 };
}
