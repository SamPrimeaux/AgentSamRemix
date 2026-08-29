/**
 * Default tenant security shield rules used during identity provisioning.
 */
const DEFAULT_TENANT_SHIELD_RULES = [
  {
    rule_type: 'key_expiry_warning',
    severity: 'high',
    config_json: { days_before: 14 },
    notify_channels: ['dashboard', 'email'],
  },
  {
    rule_type: 'rotation_due',
    severity: 'medium',
    config_json: { days: 90 },
    notify_channels: ['dashboard'],
  },
  {
    rule_type: 'untested_key_age',
    severity: 'medium',
    config_json: { days: 30 },
    notify_channels: ['dashboard'],
  },
  {
    rule_type: 'null_value_registered',
    severity: 'high',
    config_json: {},
    notify_channels: ['dashboard', 'email'],
  },
  {
    rule_type: 'test_failure',
    severity: 'high',
    config_json: {},
    notify_channels: ['dashboard', 'email'],
  },
];

/**
 * Build idempotent default shield-rule statements for one tenant.
 *
 * @param {*} env
 * @param {string} tenantId
 * @returns {import('@cloudflare/workers-types').D1PreparedStatement[]}
 */
export function buildDefaultShieldRuleStatements(env, tenantId) {
  if (!env?.DB || !tenantId) return [];
  return DEFAULT_TENANT_SHIELD_RULES.map((rule) =>
    env.DB.prepare(
      `INSERT INTO security_shield_rules (id, tenant_id, user_id, rule_type, severity, config_json, notify_channels)
       SELECT
         'ssr_' || lower(hex(randomblob(8))),
         ?,
         NULL,
         ?,
         ?,
         ?,
         ?
       WHERE NOT EXISTS (
         SELECT 1 FROM security_shield_rules sr
         WHERE sr.tenant_id = ? AND sr.rule_type = ? AND sr.user_id IS NULL
       )`,
    ).bind(
      tenantId,
      rule.rule_type,
      rule.severity,
      JSON.stringify(rule.config_json),
      JSON.stringify(rule.notify_channels),
      tenantId,
      rule.rule_type,
    ),
  );
}
