/**
 * agentsam_code_index_job.vector_backend receipt — project_ref + resolved pgvector tables.
 * Keep free of imports from code-indexer / deploy-code-index-queue (no cycles).
 *
 * project_ref here is the Supabase project ref (pgvector backend), not IAM project_id
 * (proj_* lives on agentsam_code_index_job.project_id).
 *
 * Table/model SSOT at runtime: resolveCodeIndexLaneConfig (D1 registry → arm → catalog).
 * Fixture constants below are for tests / legacy purge of OAI twins only.
 */

import {
  resolveCodeIndexLaneConfig,
  CODE_INDEX_LANE_FIXTURE_TABLES,
} from './code-index-lane-resolve.js';
import { resolveCodeIndexWriteConnection } from './code-index-write-pipe.js';

/** @deprecated Use resolveCodeIndexLaneConfig(env).tables — fixture only. */
export const CODE_INDEX_FILES_TABLE = CODE_INDEX_LANE_FIXTURE_TABLES.files;
/** @deprecated Use resolveCodeIndexLaneConfig(env).tables — fixture only. */
export const CODE_INDEX_CHUNKS_TABLE = CODE_INDEX_LANE_FIXTURE_TABLES.chunks;
/** @deprecated Use resolveCodeIndexLaneConfig(env).tables — fixture only. */
export const CODE_INDEX_SYMBOL_TABLE = CODE_INDEX_LANE_FIXTURE_TABLES.symbols;

export const CODE_INDEX_PG_TABLES = Object.freeze({
  files: CODE_INDEX_FILES_TABLE,
  chunks: CODE_INDEX_CHUNKS_TABLE,
  symbols: CODE_INDEX_SYMBOL_TABLE,
});

/** @deprecated aliases — fixture Gemini names. Prefer resolveCodeIndexLaneConfig. */
export const CODE_INDEX_FILES_TABLE_GEMINI = CODE_INDEX_FILES_TABLE;
export const CODE_INDEX_CHUNKS_TABLE_GEMINI = CODE_INDEX_CHUNKS_TABLE;
export const CODE_INDEX_SYMBOL_TABLE_GEMINI = CODE_INDEX_SYMBOL_TABLE;
export const CODE_INDEX_PG_TABLES_GEMINI_EMBEDDING_2_1536 = CODE_INDEX_PG_TABLES;

/** Legacy OpenAI twins — kept for purge/read of old rows; writers must not target these. */
export const CODE_INDEX_FILES_TABLE_OAI = 'agentsam_codebase_files_oai3large_1536';
export const CODE_INDEX_CHUNKS_TABLE_OAI = 'agentsam_codebase_chunks_oai3large_1536';
export const CODE_INDEX_SYMBOL_TABLE_OAI = 'agentsam_codebase_ast_symbols_oai3large_1536';

/**
 * Code-index law: Cloudflare Vectorize is NOT part of this product.
 * @param {any} [_env]
 * @returns {true}
 */
export function isCodeVectorizePaused(_env) {
  return true;
}

/**
 * Supabase project ref from a Postgres URL host/user (no hardcoded refs).
 * @param {unknown} connectionString
 * @returns {string|null}
 */
export function supabaseProjectRefFromHyperdriveConnectionString(connectionString) {
  const cs = connectionString != null ? String(connectionString).trim() : '';
  if (!cs) return null;
  let host = '';
  let user = '';
  try {
    const normalized = cs.replace(/^(postgres(?:ql)?):/i, 'http:');
    const u = new URL(normalized);
    host = String(u.hostname || '')
      .trim()
      .toLowerCase();
    user = decodeURIComponent(String(u.username || '').trim());
  } catch {
    return null;
  }
  const dbHost = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (dbHost?.[1]) return dbHost[1].toLowerCase();
  const bareHost = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
  if (bareHost?.[1] && bareHost[1] !== 'db') return bareHost[1].toLowerCase();
  const poolUser = user.match(/^postgres\.([a-z0-9]+)$/i);
  if (poolUser?.[1]) return poolUser[1].toLowerCase();
  return null;
}

/**
 * @param {any} env
 * @returns {string|null}
 */
export function resolveCodeIndexSupabaseProjectRef(env) {
  const fromHd = supabaseProjectRefFromHyperdriveConnectionString(
    env?.HYPERDRIVE?.connectionString,
  );
  if (fromHd) return fromHd;

  const fromVar =
    env?.SUPABASE_PROJECT_REF != null ? String(env.SUPABASE_PROJECT_REF).trim().toLowerCase() : '';
  if (fromVar && /^[a-z0-9]{10,}$/.test(fromVar)) return fromVar;

  const fromUrl =
    supabaseProjectRefFromHyperdriveConnectionString(env?.SUPABASE_DB_URL) ||
    supabaseProjectRefFromHyperdriveConnectionString(env?.SUPABASE_URL);
  if (fromUrl) return fromUrl;

  const supabaseUrl = env?.SUPABASE_URL != null ? String(env.SUPABASE_URL).trim() : '';
  if (supabaseUrl) {
    try {
      const host = new URL(supabaseUrl).hostname.toLowerCase();
      const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
      if (m?.[1]) return m[1].toLowerCase();
    } catch {
      /* ignore */
    }
  }

  return null;
}

/**
 * Honest agentsam_code_index_job.vector_backend JSON for product runs.
 * Resolves tables/model from D1 lane registry + code_index_embed arm.
 * @param {any} env
 * @returns {Promise<string>}
 */
export async function buildCodeIndexVectorBackendReceipt(env) {
  const projectRef = resolveCodeIndexSupabaseProjectRef(env);
  if (!projectRef) {
    throw new Error('code_index_vector_backend_project_ref_required');
  }
  const lane = await resolveCodeIndexLaneConfig(env);
  const write = resolveCodeIndexWriteConnection(env);
  return JSON.stringify({
    project_ref: projectRef,
    chunks_table: `agentsam.${lane.tables.chunks}`,
    symbols_table: `agentsam.${lane.tables.symbols}`,
    files_table: `agentsam.${lane.tables.files}`,
    vectorize_active: false,
    projection: 'hyperdrive_pgvector_retrieve_and_write',
    write_pipe: write.write_pipe,
    embed_model: lane.embed.model,
    routing_arm_id: lane.embed.armId,
    model_catalog_id: lane.embed.catalogId,
    dimensions: lane.dimensions,
  });
}
