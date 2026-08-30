/**
 * Cmd+K deploy actions — workspace-agnostic; tied to live GitHub / Workers Builds, not hardcoded repos.
 */
export type DeployPaletteAction = 'workers_builds' | 'open_deploys';

export type DeployPaletteRow = {
  id: string;
  category: 'deploy' | 'command';
  title: string;
  subtitle: string;
  commandText?: string;
  deployAction?: DeployPaletteAction;
};

const DEPLOY_PALETTE_ROWS: DeployPaletteRow[] = [
  {
    id: 'deploy-workers-builds',
    category: 'deploy',
    title: 'Trigger Workers Builds deploy',
    subtitle: 'Synchronize — deploy active branch via workspace deploy hook',
    deployAction: 'workers_builds',
  },
  {
    id: 'deploy-wrangler',
    category: 'command',
    title: 'Deploy Worker (wrangler)',
    subtitle: 'wrangler deploy',
    commandText: 'wrangler deploy',
  },
  {
    id: 'deploy-wrangler-versions',
    category: 'command',
    title: 'Versions deploy',
    subtitle: 'wrangler versions deploy',
    commandText: 'wrangler versions deploy',
  },
  {
    id: 'deploy-npm-worker',
    category: 'command',
    title: 'AgentSam deploy worker',
    subtitle: 'Wrangler deploy only; reuse existing app/dist',
    commandText: 'bin/agentsam deploy worker',
  },
  {
    id: 'deploy-npm-frontend',
    category: 'command',
    title: 'AgentSam deploy fast',
    subtitle: 'Build app/ and deploy; skips typecheck',
    commandText: 'bin/agentsam deploy fast',
  },
  {
    id: 'deploy-npm-full',
    category: 'command',
    title: 'AgentSam deploy full',
    subtitle: 'Typecheck, build app/, then deploy',
    commandText: 'bin/agentsam deploy full',
  },
  {
    id: 'deploy-open-history',
    category: 'deploy',
    title: 'Open deploy history',
    subtitle: 'Analytics — recent Workers Builds',
    deployAction: 'open_deploys',
  },
];

export function filterDeployPaletteRows(searchTerm: string, limit = 12): DeployPaletteRow[] {
  const t = searchTerm.trim().toLowerCase();
  const rows = !t
    ? DEPLOY_PALETTE_ROWS
    : DEPLOY_PALETTE_ROWS.filter((r) => {
        const hay = `${r.title} ${r.subtitle} ${r.commandText || ''}`.toLowerCase();
        return hay.includes(t);
      });
  return rows.slice(0, limit);
}
