/** App shell static maps / greeting (Wave 2 E1). */
import { Monitor, Globe, HardDrive, MessageSquare, Package, Database } from 'lucide-react';

export const PRODUCT_NAME = 'Agent Sam';

export function buildAgentSamGreeting(_workspaceDisplayLine?: string): string {
  // Neutral greeting — explorer / sticky project must not invent "Looking at …" context.
  return `Hi! I'm ${PRODUCT_NAME}. What should we work on?`;
}

export const QUICK_COMMANDS = [
  { icon: Monitor, label: 'Local PTY', cmd: 'echo "Use the Local dock / localpty lane"', desc: 'ExecOS local lane' },
  { icon: Globe, label: 'Production SSH', cmd: 'ssh production-iam', desc: 'Mainstage Access' },
  { icon: HardDrive, label: 'Sandbox SSH', cmd: 'ssh sandbox-d1', desc: 'Experiment D1' },
  { icon: MessageSquare, label: 'Clear Chat', cmd: 'clear', desc: 'Reset Agent Session' },
  { icon: Package, label: 'Build Project', cmd: 'npm run build', desc: 'Production Bundle' },
  { icon: Database, label: 'Sync DB', cmd: 'npx prisma db pull', desc: 'D1 Schema Sync' },
];

export const SETTINGS_SLUG_MAP: Record<string, string> = {
  general: 'General',
  agents: 'Agents',
  'ai-models': 'AI Models',
  tools: 'Tools & MCP',
  rules: 'Rules & Skills',
  workspace: 'Workspace',
  design: 'Brand & Design',
  hooks: 'Hooks',
  github: 'GitHub',
  cicd: 'CI/CD',
  network: 'Network',
  themes: 'Themes',
  storage: 'Storage',
  security: 'Security',
  billing: 'Plan & Usage',
  notifications: 'Notifications',
  docs: 'Docs',
  integrations: 'Integrations',
};
