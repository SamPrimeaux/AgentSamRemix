/**
 * Composer-attached sources (MCP, OAuth apps, web search) — persisted per user/workspace.
 */

export type ChatComposerSourceKind = 'mcp' | 'oauth' | 'web_search' | 'sandbox_agent';

export type ChatComposerSource = {
  id: string;
  label: string;
  kind: ChatComposerSourceKind;
  /** integration_registry.provider_key when kind === oauth */
  providerKey?: string;
};

export const IAM_MCP_PLATFORM_SOURCE_ID = 'inneranimalmedia-mcp-server';

export const IAM_MCP_PLATFORM_SOURCE: ChatComposerSource = {
  id: IAM_MCP_PLATFORM_SOURCE_ID,
  label: 'inneranimalmedia-mcp-server',
  kind: 'mcp',
};

export const WEB_SEARCH_SOURCE_ID = 'web_search';

export const WEB_SEARCH_SOURCE: ChatComposerSource = {
  id: WEB_SEARCH_SOURCE_ID,
  label: 'Web search',
  kind: 'web_search',
};

export const SANDBOX_AGENT_SOURCE_ID = 'sandbox_agent';

/** User-enabled remote Linux sandbox lane (Google Antigravity) — composer toggle only. */
export const SANDBOX_AGENT_SOURCE: ChatComposerSource = {
  id: SANDBOX_AGENT_SOURCE_ID,
  label: 'Remote sandbox',
  kind: 'sandbox_agent',
};
