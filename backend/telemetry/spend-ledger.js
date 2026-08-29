/**
 * spend_ledger provider normalization + row insert.
 */

/**
 * Standardizes provider names for the spend ledger CHECK constraint.
 * @param {unknown} provider
 * @returns {string}
 */
export function spendLedgerProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'workers_ai') return 'cloudflare_workers_ai';
  const allowed = new Set([
    'anthropic',
    'openai',
    'cursor',
    'cloudflare_workers_ai',
    'google',
    'deepseek',
    'cloudflare',
    'stripe',
    'shopify',
    'vercel',
    'supabase',
    'resend',
    'other',
  ]);
  // spend_ledger has a locked provider CHECK; unknown future providers retain
  // their canonical model_key while using the safe fallback bucket.
  return allowed.has(normalized) ? normalized : 'other';
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   provider: unknown,
 *   amountUsd: number,
 *   modelKey: string,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   sessionId?: string|null,
 *   refId: string,
 * }} fields
 */
export async function recordSpend(env, fields) {
  if (!env?.DB) return null;
  const amountUsd = Number(fields.amountUsd) || 0;
  if (amountUsd <= 0) return null;
  const mid = fields.tenantId != null ? String(fields.tenantId).trim() : '';
  const ws = fields.workspaceId != null ? String(fields.workspaceId).trim() : '';
  if (!mid || !ws) return null;

  const lid = 'sl_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16).toLowerCase();
  const spFixed = spendLedgerProvider(String(fields.provider || 'unknown'));
  await env.DB.prepare(
    `INSERT INTO spend_ledger (id, tenant_id, workspace_id, brand_id, provider, source, occurred_at, amount_usd, model_key, tokens_in, tokens_out, session_tag, project_id, ref_table, ref_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      lid,
      mid,
      ws,
      'inneranimalmedia',
      spFixed,
      'api_direct',
      Math.floor(Date.now() / 1000),
      amountUsd,
      fields.modelKey,
      fields.inputTokens,
      fields.outputTokens,
      fields.sessionId || 'unknown',
      'proj_inneranimalmedia_main_prod_013',
      'agentsam_usage_events',
      fields.refId,
    )
    .run();
  return lid;
}
