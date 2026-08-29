/**
 * Best-effort agentsam_model_catalog sync after user BYOK save.
 * Only flips show_in_picker on existing catalog rows — never inserts junk from provider lists
 * and never writes model inventory into agentsam_ai.
 */
/**
 * @param {any} env
 * @param {string} provider
 * @param {string} apiKey
 * @param {{ tenantId?: string | null, createdBy?: string | null }} [meta]
 */
export async function syncProviderModels(env, provider, apiKey, meta = {}) {
  if (!env?.DB || !apiKey) return;
  const p = String(provider || '').trim();
  void meta;
  try {
    let models = [];
    if (p === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      const data = await res.json().catch(() => ({}));
      const arr = data?.data || data?.models || [];
      models = (Array.isArray(arr) ? arr : []).map((m) => ({
        key: m.id || m.name || '',
      }));
    } else if (p === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json().catch(() => ({}));
      models = (data?.data || []).map((m) => ({
        key: m.id || '',
      }));
    } else if (p === 'google_ai') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`,
      );
      const data = await res.json().catch(() => ({}));
      models = (data?.models || []).map((m) => ({
        key: (m.name || '').replace(/^models\//, ''),
      }));
    } else {
      return;
    }
    for (const m of models) {
      if (!m.key) continue;
      await env.DB.prepare(
        `UPDATE agentsam_model_catalog
         SET show_in_picker = 1, updated_at = unixepoch()
         WHERE model_key = ?`,
      )
        .bind(m.key)
        .run()
        .catch(() => {});
    }
  } catch (e) {
    console.warn('[model-sync] syncProviderModels', p, e?.message || e);
  }
}
