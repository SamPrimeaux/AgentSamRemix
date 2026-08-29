import type { ConnectorCatalogRow } from '../../client-api/connectorsCatalog';
import type { ChatComposerSource } from '../../components/ChatAssistant/composer/types';
import {
  IAM_MCP_PLATFORM_SOURCE,
  WEB_SEARCH_SOURCE,
} from '../../components/ChatAssistant/composer/types';

export function connectorComposerSource(row: ConnectorCatalogRow): ChatComposerSource {
  const pk = row.provider_key.trim();
  if (pk === 'inneranimalmedia-mcp-server') {
    return { ...IAM_MCP_PLATFORM_SOURCE, label: row.title };
  }
  if (pk === 'web_search') {
    return { ...WEB_SEARCH_SOURCE };
  }
  return {
    id: `oauth:${pk}`,
    label: row.title,
    kind: 'oauth',
    providerKey: pk,
  };
}

export function isConnectorSessionEnabled(
  row: ConnectorCatalogRow,
  sessionKeys: Set<string>,
  activeSourceIds: Set<string>,
): boolean {
  const pk = row.provider_key.trim();
  if (sessionKeys.has(pk)) return true;
  const src = connectorComposerSource(row);
  return activeSourceIds.has(src.id);
}
