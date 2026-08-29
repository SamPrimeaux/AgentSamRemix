/** Pure helpers for agent hub connectors catalog (no D1/auth imports — safe for unit tests). */

import { MCP_CANONICAL_CLIENT_ID } from '../api/mcp-oauth-shared.js';

export {
  AGENT_HUB_REGISTRY_KEYS,
  connectorKindForProvider,
} from '../../backend/integrations/connectors-hub-helpers.js';

/**
 * @param {string} providerKey
 * @param {string} [returnTo]
 */
export function connectUrlForAgentHub(providerKey, returnTo = '/dashboard/agent') {
  const pk = String(providerKey || '').trim().toLowerCase();
  const rt = encodeURIComponent(returnTo);
  if (pk === 'inneranimalmedia-mcp-server' || pk === 'iam_mcp_platform') {
    return `https://mcp.inneranimalmedia.com/api/oauth/authorize?client_id=${MCP_CANONICAL_CLIENT_ID}&return_to=${rt}`;
  }
  if (pk === 'github') return `/api/oauth/github/start?return_to=${rt}`;
  if (pk === 'google_drive') return `/api/oauth/google/start?connectDrive=1&return_to=${rt}`;
  if (pk === 'google_gmail' || pk === 'gmail') {
    return `/api/integrations/gmail/connect?return_to=${rt}`;
  }
  if (pk === 'cloudflare_oauth' || pk === 'cloudflare') {
    return `/api/oauth/cloudflare/start?return_to=${rt}`;
  }
  if (pk === 'supabase_oauth' || pk === 'supabase') {
    return `/api/oauth/supabase/start?return_to=${rt}`;
  }
  if (pk === 'stripe') return `/api/oauth/stripe/start?return_to=${rt}`;
  if (pk === 'mcp_servers') return `/dashboard/settings?section=integrations&focus=mcp_servers`;
  return `/api/integrations/${encodeURIComponent(pk)}/connect?return_to=${rt}`;
}
