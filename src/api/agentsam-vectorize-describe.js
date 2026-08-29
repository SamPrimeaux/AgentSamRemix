/**
 * GET /api/internal/agentsam-vectorize/describe
 * Returns CF Vectorize index config + optional Supabase pgvector lane catalog (tier routing).
 */
import { jsonResponse } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import {
  describeAgentsamVectorizeIndex,
  resolveAgentsamEmbeddingSpec,
} from '../core/agentsam-vectorize-index.js';

function isVectorizeDescribeAuthorized(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bridge = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  return !!(bridge && bearer && bearer === bridge);
}

function parseTier(url) {
  const tier = String(url.searchParams.get('tier') || 'all').trim().toLowerCase();
  if (tier === 'custom' || tier === 'supabase' || tier === 'all') return tier;
  return 'all';
}

function parseProvider(url) {
  const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
  if (provider === 'cloudflare_vectorize' || provider === 'supabase_pgvector') return provider;
  return null;
}

function parseDimensions(url) {
  const raw = url.searchParams.get('dimensions');
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parsePurpose(url) {
  const purpose = url.searchParams.get('purpose');
  return purpose != null && String(purpose).trim() !== '' ? String(purpose).trim() : null;
}

function parseNamespace(url) {
  const namespace = url.searchParams.get('namespace');
  return namespace != null && String(namespace).trim() !== '' ? String(namespace).trim() : null;
}

/**
 * Global lane catalog — no tenant_id on agentsam_pgvector_lane_registry.
 * Workspace isolation lives on workspace_id in the Supabase pgvector tables.
 * @param {any} env
 * @param {{ dimensions?: number|null, purpose?: string|null }} [filters]
 */
async function loadPgvectorLanes(env, filters = {}) {
  if (!env?.DB) return [];
  let sql = `SELECT id, schema_name, table_name, purpose, dimensions, metric, embedding_model,
                    size_label, is_active, is_archive, description, updated_at
             FROM agentsam_pgvector_lane_registry
             WHERE COALESCE(is_active, 1) = 1`;
  const binds = [];
  if (filters.dimensions != null) {
    sql += ` AND dimensions = ?`;
    binds.push(filters.dimensions);
  }
  if (filters.purpose) {
    sql += ` AND purpose = ?`;
    binds.push(filters.purpose);
  }
  sql += ` ORDER BY purpose`;
  const result = await env.DB.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }));
  return result.results || [];
}

function matchesNamespace(row, namespace) {
  if (!namespace) return true;
  const needle = namespace.toLowerCase();
  const hay = [
    row?.id,
    row?.binding_name,
    row?.index_name,
    row?.display_name,
    row?.table_name,
    row?.purpose,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  return hay.some((v) => v.includes(needle) || needle.includes(v));
}

/** @param {Request} request @param {any} env */
export async function handleAgentsamVectorizeDescribe(request, env) {
  if (!isVectorizeDescribeAuthorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const tier = parseTier(url);
  const provider = parseProvider(url);
  const dimensions = parseDimensions(url);
  const purpose = parsePurpose(url);
  const namespace = parseNamespace(url);

  const includeCf =
    provider !== 'supabase_pgvector' && (tier === 'custom' || tier === 'all');
  const includeSupabase =
    provider !== 'cloudflare_vectorize' && (tier === 'supabase' || tier === 'all');

  try {
    const out = {
      ok: true,
      tier,
      rule: 'One index, one dimension, one model — indexing and query must use the same embedding model per lane.',
    };

    if (includeCf) {
      const index = await describeAgentsamVectorizeIndex(env);
      const embedding = await resolveAgentsamEmbeddingSpec(env);
      out.cloudflare = {
        binding: 'AGENTSAMVECTORIZE',
        index_name: index.indexName,
        dimensions: index.dimensions,
        metric: index.metric,
        describe_source: index.source,
        embedding_provider: embedding.provider,
        embedding_model: embedding.model,
      };
      if (env?.DB && (tier === 'all' || namespace)) {
        let sql = `SELECT id, binding_name, index_name, display_name, dimensions, metric, is_active, is_preferred
                   FROM vectorize_index_registry WHERE COALESCE(is_active, 1) = 1`;
        const binds = [];
        if (dimensions != null) {
          sql += ` AND dimensions = ?`;
          binds.push(dimensions);
        }
        sql += ` ORDER BY COALESCE(is_preferred, 0) DESC, display_name`;
        const rows = await env.DB.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }));
        out.cloudflare_indexes = (rows.results || []).filter((row) => matchesNamespace(row, namespace));
      }
    }

    if (includeSupabase) {
      let lanes = await loadPgvectorLanes(env, { dimensions, purpose });
      if (namespace) lanes = lanes.filter((lane) => matchesNamespace(lane, namespace));
      out.supabase_lanes = lanes;
      out.pgvector_lanes = lanes;
    }

    return jsonResponse(out);
  } catch (e) {
    return jsonResponse(
      { ok: false, error: String(e?.message || e) },
      500,
    );
  }
}
