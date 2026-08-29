/**
 * Load agentsam_skill bodies from R2 (inneranimalmedia-autorag/skills/…).
 * D1 holds registry metadata only; markdown lives in AUTORAG bucket.
 */

function parseMetadata(row) {
  try {
    const raw = row?.metadata_json;
    if (!raw) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

function skillR2Key(row, meta) {
  const fp = String(row?.file_path || meta?.r2_skill_key || '').trim().replace(/^\/+/, '');
  if (!fp) return '';
  return fp.startsWith('skills/') ? fp : `skills/${fp}`;
}

/**
 * @param {object} env
 * @param {object} row agentsam_skill row
 * @returns {Promise<object>} row with content_markdown hydrated when strategy is r2
 */
export async function hydrateSkillRowFromR2(env, row) {
  if (!row) return row;
  const strategy = String(row.retrieval_strategy || 'db').toLowerCase();
  if (strategy !== 'r2') return row;

  const meta = parseMetadata(row);
  const key = skillR2Key(row, meta);
  if (!key) return row;

  const binding = env.AUTORAG_BUCKET;
  if (!binding?.get) {
    console.warn('[agentsam-skill-r2] AUTORAG_BUCKET binding missing for', row.id);
    return row;
  }

  try {
    const obj = await binding.get(key);
    if (!obj) {
      console.warn('[agentsam-skill-r2] missing object', key);
      return row;
    }
    const text = await obj.text();
    if (!text?.trim()) return row;
    return { ...row, content_markdown: text };
  } catch (e) {
    console.warn('[agentsam-skill-r2] fetch failed', key, e?.message ?? e);
    return row;
  }
}

/**
 * @param {object} env
 * @param {object[]} rows
 * @returns {Promise<object[]>}
 */
export async function hydrateSkillsFromR2(env, rows) {
  if (!rows?.length) return rows || [];
  return Promise.all(rows.map((row) => hydrateSkillRowFromR2(env, row)));
}
