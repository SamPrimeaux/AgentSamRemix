import type { WorkflowGraphNode } from '../workflowTypes';
import { resolveIntegrationIconUrl } from '../../../src/lib/resolveIntegrationIconUrl';
import { apiNodeTypeToUi } from '../workflowTypes';

export type WorkflowNodeBrand = {
  iconSlug?: string;
  imageUrl: string | null;
  laneLabel: string;
  presentation: 'app' | 'brand';
};

const WORKFLOW_ICON_OVERRIDES: Record<string, string> = {
  cloudflare: 'cloudflare',
  cloudflare_oauth: 'cloudflare',
  github: 'github',
  google_drive: 'google_drive',
  gmail: 'gmail',
  google_gmail: 'gmail',
  supabase: 'supabase',
  agentsam: 'agentsam',
  mcp: 'mcp',
};

function metaObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function inferIconSlug(node: WorkflowGraphNode, workflowKey?: string): string | undefined {
  const meta = metaObject(node.metadata_json);
  const fromMeta = meta?.icon_slug != null ? String(meta.icon_slug).trim() : '';
  if (fromMeta) return fromMeta;

  const hay = `${node.handler_key || ''} ${node.title || ''} ${node.description || ''} ${workflowKey || ''}`.toLowerCase();
  if (hay.includes('github')) return 'github';
  if (hay.includes('cloudflare') || hay.includes('wrangler') || hay.includes('worker')) return 'cloudflare';
  if (hay.includes('gmail') || hay.includes('email')) return 'gmail';
  if (hay.includes('drive') || hay.includes('report') || hay.includes('docs')) return 'google_drive';
  if (hay.includes('supabase')) return 'supabase';
  if (hay.includes('meshy')) return 'agentsam';
  return undefined;
}

function laneLabelForNode(node: WorkflowGraphNode): string {
  const meta = metaObject(node.metadata_json);
  if (meta?.lane_label) return String(meta.lane_label);
  if (node.description?.trim()) return node.description.trim();

  const ui = apiNodeTypeToUi(node.node_type);
  switch (ui) {
    case 'trigger':
      return 'Trigger';
    case 'output':
      return 'Export';
    case 'terminal':
      return 'Deploy';
    case 'webhook':
      return 'Notify';
    case 'db_query':
      return 'Record';
    case 'approval_gate':
      return 'Approval';
    case 'mcp_tool':
      return 'Tool';
    case 'script':
      return 'Script';
    case 'process':
      return 'Connect';
    default:
      return 'Process';
  }
}

/** Real app icon + human lane label for mobile workflow spine. */
export function resolveWorkflowNodeBrand(
  node: WorkflowGraphNode,
  workflowKey?: string,
): WorkflowNodeBrand {
  const meta = metaObject(node.metadata_json);
  const iconSlug = inferIconSlug(node, workflowKey);
  const customUrl = meta?.icon_url != null ? String(meta.icon_url).trim() : '';
  const slugKey = iconSlug ? WORKFLOW_ICON_OVERRIDES[iconSlug] || iconSlug : undefined;
  const imageUrl =
    customUrl ||
    (slugKey ? resolveIntegrationIconUrl(slugKey, null, slugKey) : null);

  return {
    iconSlug: slugKey,
    imageUrl,
    laneLabel: laneLabelForNode(node),
    presentation: customUrl || !slugKey ? 'app' : 'brand',
  };
}

export const STARTER_WORKFLOW_KEYS = new Set(['cf_deploy_starter', 'github_repo_starter']);

export function isStarterWorkflow(workflowKey?: string | null): boolean {
  return STARTER_WORKFLOW_KEYS.has(String(workflowKey || '').trim());
}

export function starterIconSlug(workflowKey?: string | null): string | undefined {
  const key = String(workflowKey || '').trim();
  if (key === 'cf_deploy_starter') return 'cloudflare';
  if (key === 'github_repo_starter') return 'github';
  return undefined;
}
