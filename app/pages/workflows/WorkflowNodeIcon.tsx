import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Zap,
  Bot,
  Wrench,
  Terminal,
  Database,
  ShieldAlert,
  GitBranch,
  Webhook,
  ClipboardCheck,
  CircleDot,
  Workflow,
  FileCode2,
  Cog,
} from 'lucide-react';
import type { WorkflowUiNodeType } from './workflowTypes';

const NODE_ICON: Record<WorkflowUiNodeType, { Icon: LucideIcon; accent: string }> = {
  trigger: { Icon: Zap, accent: 'var(--solar-amber, #f59e0b)' },
  agent: { Icon: Bot, accent: 'var(--solar-violet, #8b5cf6)' },
  mcp_tool: { Icon: Wrench, accent: '#3b82f6' },
  terminal: { Icon: Terminal, accent: '#f97316' },
  db_query: { Icon: Database, accent: '#6366f1' },
  script: { Icon: FileCode2, accent: '#eab308' },
  approval_gate: { Icon: ShieldAlert, accent: '#ec4899' },
  branch: { Icon: GitBranch, accent: '#a855f7' },
  webhook: { Icon: Webhook, accent: '#0ea5e9' },
  eval: { Icon: ClipboardCheck, accent: '#14b8a6' },
  process: { Icon: Cog, accent: '#64748b' },
  output: { Icon: CircleDot, accent: '#10b981' },
};

type Props = {
  type: WorkflowUiNodeType;
  size?: number;
  className?: string;
};

export function WorkflowNodeIcon({ type, size = 16, className = '' }: Props) {
  const meta = NODE_ICON[type] ?? { Icon: Workflow, accent: 'var(--solar-cyan)' };
  const { Icon, accent } = meta;
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      className={className}
      style={{ color: accent }}
      aria-hidden
    />
  );
}

export function nodeAccent(type: WorkflowUiNodeType): string {
  return (NODE_ICON[type] ?? NODE_ICON.agent).accent;
}
