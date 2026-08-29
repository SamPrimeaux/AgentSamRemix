/** Pure helpers for the Agent Sam connector catalog. */

export const AGENT_HUB_REGISTRY_KEYS = [
  'github',
  'cloudflare_oauth',
  'google_drive',
  'google_gmail',
  'gmail',
  'supabase_oauth',
  'mcp_servers',
  'openai',
  'anthropic',
  'resend',
  'cloudflare_r2',
  'stripe',
];

/**
 * @param {string} providerKey
 */
export function connectorKindForProvider(providerKey) {
  const pk = String(providerKey || '').trim().toLowerCase();
  if (pk === 'inneranimalmedia-mcp-server' || pk === 'iam_mcp_platform') return 'mcp_remote';
  if (pk === 'web_search' || pk === 'sandbox_agent') return 'capability';
  if (pk === 'mcp_servers') return 'mcp_custom';
  if (pk === 'stripe') return 'mcp_remote';
  return 'oauth_api';
}
