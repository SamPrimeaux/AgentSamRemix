const ACTIVITY_LABELS: Record<string, string> = {
  files: 'Explorer',
  search: 'Search',
  git: 'Source Control',
  debug: 'Debug',
  mcps: 'Tools & MCP',
  actions: 'Deploy',
  drive: 'Cloud',
  database: 'Database',
};

/** Short breadcrumb for the mobile floating back control (not the top header). */
export function mobileNavBackLabel(args: {
  agentChatOpen: boolean;
  activeActivity: string | null;
  pathname: string;
}): string | null {
  if (args.agentChatOpen) return 'Agent';
  if (args.activeActivity) {
    return ACTIVITY_LABELS[args.activeActivity] ?? 'Panel';
  }
  const p = args.pathname;
  if (p.startsWith('/dashboard/settings')) return 'Settings';
  if (p.startsWith('/dashboard/agent')) return 'Agent';
  return null;
}
