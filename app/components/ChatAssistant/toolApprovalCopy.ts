/**
 * Human-readable copy for inline tool approval cards (ChatGPT-style pre-flight).
 */

import type { ToolApprovalPayload } from './types';

export type ToolApprovalRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export function formatToolApprovalTitle(toolName: string, description?: string): string {
  const raw = String(toolName || '').trim();
  if (/^spawn_lane_extension$/i.test(raw)) {
    return 'Extend spawn lane budget?';
  }
  const d0 = String(description || '')
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (d0 && d0.length >= 4 && d0.length <= 120) return d0;
  if (raw) {
    const t = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (/terminal|shell|pty/i.test(t)) return 'Run shell command on your platform terminal?';
    if (/^run\b/i.test(t)) return t.length > 72 ? t.slice(0, 70) + '…' : t;
    return t.length > 72 ? t.slice(0, 70) + '…' : t;
  }
  return d0 || 'Allow this action?';
}

export function normalizeToolApprovalRisk(level?: string): ToolApprovalRiskLevel {
  const r = String(level || 'medium').toLowerCase();
  if (r === 'critical' || r === 'high' || r === 'medium' || r === 'low') return r;
  return 'medium';
}

export function toolApprovalRiskStyles(level: ToolApprovalRiskLevel): { pill: string; ring: string } {
  switch (level) {
    case 'critical':
      return {
        pill: 'bg-red-500/15 text-red-300 border-red-400/30',
        ring: 'ring-red-400/25',
      };
    case 'high':
      return {
        pill: 'bg-amber-500/12 text-amber-200 border-amber-400/28',
        ring: 'ring-amber-400/20',
      };
    case 'medium':
      return {
        pill: 'bg-yellow-500/10 text-yellow-200/90 border-yellow-400/22',
        ring: 'ring-yellow-400/15',
      };
    default:
      return {
        pill: 'bg-emerald-500/10 text-emerald-200/90 border-emerald-400/22',
        ring: 'ring-emerald-400/12',
      };
  }
}

/** Extract owner/repo@branch (+ path) from tool parameters for GitHub approvals. */
export function formatGithubApprovalTarget(
  params?: Record<string, unknown> | null,
): { repo: string; branch: string | null; path: string | null; label: string } | null {
  if (!params || typeof params !== 'object') return null;
  const repo = String(
    params.repo ?? params.repository ?? params.repository_full_name ?? params.github_repo ?? '',
  ).trim();
  if (!repo.includes('/')) return null;
  const branch = String(params.branch ?? params.ref ?? params.head ?? '').trim() || null;
  const path = String(params.path ?? params.github_path ?? '').trim() || null;
  const label = branch ? `${repo}@${branch}` : `${repo}@(branch unset)`;
  return { repo, branch, path, label };
}

function formatGithubApprovalPreviewFromParams(params: Record<string, unknown>): string | null {
  const target = formatGithubApprovalTarget(params);
  if (!target) return null;
  const lines = [target.label];
  if (target.path) lines.push(`path: ${target.path}`);
  const find =
    params.find != null ? String(params.find) : params.old_str != null ? String(params.old_str) : '';
  const replace =
    params.replace != null
      ? String(params.replace)
      : params.new_str != null
        ? String(params.new_str)
        : '';
  if (find) {
    const f = find.length > 160 ? `${find.slice(0, 160)}…` : find;
    const r = replace.length > 160 ? `${replace.slice(0, 160)}…` : replace;
    lines.push(`find: ${f}`);
    lines.push(`replace: ${r}`);
  }
  return lines.join('\n');
}

function looksLikeBarePathPreview(preview: string): boolean {
  const first = String(preview || '').trim().split('\n')[0] || '';
  if (!first) return true;
  if (first.includes('@') && first.includes('/')) return false;
  if (/^repo:\s*/i.test(first)) return false;
  // Single path line without owner/repo@branch.
  return !/\S+\/\S+@/.test(first);
}

/** Prefer explicit preview; else derive command/SQL / GitHub target / diff from tool parameters. */
export function resolveToolApprovalPreview(tool: ToolApprovalPayload): string {
  const p = tool.parameters;
  const githubFromParams =
    p && typeof p === 'object' ? formatGithubApprovalPreviewFromParams(p) : null;
  const explicit = String(tool.preview || '').trim();
  if (explicit) {
    // Server used to emit path-only for GitHub patches — rebuild when params carry repo.
    if (githubFromParams && looksLikeBarePathPreview(explicit)) return githubFromParams;
    return explicit;
  }
  if (githubFromParams) return githubFromParams;
  if (!p || typeof p !== 'object') return '';
  const rec = p as Record<string, unknown>;
  const diffish =
    rec.diff ?? rec.patch ?? rec.unified_diff ?? rec.unifiedDiff ?? rec.diff_text ?? rec.diffText;
  if (diffish != null && String(diffish).trim()) return String(diffish).trim();
  const cmd =
    rec.command ??
    rec.cmd ??
    rec.shell_command ??
    rec.shell ??
    rec.query ??
    rec.sql;
  if (cmd != null && String(cmd).trim()) return String(cmd).trim();
  const path = rec.path ?? rec.cwd ?? rec.working_directory;
  if (path != null && String(path).trim()) {
    const base = String(path).trim();
    if (cmd != null) return `cd ${base} && ${String(cmd).trim()}`;
    return base;
  }
  try {
    return JSON.stringify(rec, null, 2).slice(0, 4000);
  } catch {
    return '';
  }
}

export function defaultIntegrationLabel(tool: ToolApprovalPayload): string {
  const github = formatGithubApprovalTarget(tool.parameters);
  if (github) return github.label;
  const s = String(tool.server_display_name || '').trim();
  if (s) return s;
  if (tool.plan_terminal) return 'Plan terminal';
  if (/^spawn_lane_extension$/i.test(String(tool.name || ''))) return 'Spawn budget';
  return 'Agent Sam';
}

export function defaultLaneFootnote(tool: ToolApprovalPayload): string | null {
  if (/^spawn_lane_extension$/i.test(String(tool.name || ''))) {
    return 'Approve extends the cap; deny resumes under the current cap';
  }
  const github = formatGithubApprovalTarget(tool.parameters);
  if (github?.path) return github.path;
  const lane = String(tool.connection_resolution || '').trim();
  if (!lane) return null;
  if (lane === 'superadmin_operator_workspace') {
    return 'Platform operator lane · localpty';
  }
  if (lane.includes('byok') || lane.includes('tunnel')) {
    return 'Customer workspace · tunnel required';
  }
  return lane.replace(/_/g, ' ');
}
